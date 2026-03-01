/**
 * /poker — DCB Poker Interactive Event
 *
 * Subcommands:
 *   create  — Open a new poker table in this channel
 *   join    — Join the table in this channel
 *   leave   — Leave the current table
 *   status  — Show current table status
 *
 * Also handles published poker events from the DCB Event Manager.
 * Supports crypto mode with SOL buy-ins and automated treasury payouts.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  createTable, addPlayer, removePlayer, startHand,
  playerAction, getValidActions,
} = require('../utils/pokerEngine');
const {
  buildTableEmbed, buildTableComponents, buildHoleCardEmbed,
} = require('../utils/pokerRenderer');

// Crypto/payment utilities (loaded lazily to avoid breaking if unavailable)
let crypto, walletSync, db;
try { crypto = require('../utils/crypto'); } catch (_) {}
try { walletSync = require('../utils/walletSync'); } catch (_) {}
try { db = require('../utils/db'); } catch (_) {}

// ─── In-memory table store ──────────────────────────────────────────────────
// Key: channelId → table (one table per channel)
const tables = new Map();

// Also index by table ID for button lookups
const tablesById = new Map();

// Index by eventId for published events
const tablesByEventId = new Map();

// Turn timers
const turnTimers = new Map();

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTableByChannel(channelId) {
  return tables.get(channelId) || null;
}

function getTableById(tableId) {
  return tablesById.get(tableId) || null;
}

function getTableByEventId(eventId) {
  return tablesByEventId.get(Number(eventId)) || null;
}

function destroyTable(table) {
  clearTurnTimer(table);
  tables.delete(table.channelId);
  tablesById.delete(table.id);
  if (table.eventId) tablesByEventId.delete(table.eventId);
}

/**
 * Process SOL payouts when a crypto-mode table closes.
 * Distributes 90% of total pot to players proportional to final chip stacks.
 * 10% house cut stays in treasury.
 */
async function processPokerPayouts(table, channel) {
  if (table.mode !== 'crypto' || !table.eventId || !table.buyIn) return;
  if (!crypto || !walletSync || !db) {
    console.error('[Poker] Cannot process payouts — crypto/db modules not loaded');
    return;
  }

  try {
    const guildWallet = await walletSync.getGuildWalletWithFallback(table.guildId);
    if (!guildWallet || !guildWallet.wallet_secret) {
      console.error('[Poker] No guild wallet for payouts');
      await channel.send({ content: '⚠️ Payouts could not be processed — no treasury wallet configured.' });
      return;
    }

    const totalBuyIns = table.seats.length * table.buyIn;
    const houseCut = totalBuyIns * 0.10;
    const payoutPool = totalBuyIns - houseCut;

    // Calculate total chips across all players
    const totalChips = table.seats.reduce((sum, s) => sum + (s.chips || 0), 0);
    if (totalChips <= 0) return;

    const payoutResults = [];

    for (const seat of table.seats) {
      if (!seat.chips || seat.chips <= 0) continue;

      const chipShare = seat.chips / totalChips;
      const payoutSol = chipShare * payoutPool;
      if (payoutSol < 0.000001) continue; // skip dust

      // Get player wallet
      const userData = db.getUser ? await db.getUser(seat.discordId) : null;
      const playerRecord = await db.get?.(
        'SELECT wallet_address FROM poker_event_players WHERE poker_event_id = ? AND user_id = ?',
        [table.eventId, seat.discordId]
      );
      const recipientAddr = playerRecord?.wallet_address || userData?.solana_address;

      if (!recipientAddr) {
        payoutResults.push({ user: seat.displayName, success: false, reason: 'No wallet' });
        continue;
      }

      // Send from treasury
      const keypair = crypto.getKeypairFromSecret(guildWallet.wallet_secret);
      if (!keypair) {
        payoutResults.push({ user: seat.displayName, success: false, reason: 'Invalid treasury key' });
        continue;
      }

      const result = await crypto.sendSolFrom(keypair, recipientAddr, payoutSol);
      if (result && result.success) {
        payoutResults.push({ user: seat.displayName, amount: payoutSol, success: true, tx: result.signature });
        // Update DB record
        if (db.run) {
          await db.run(
            'UPDATE poker_event_players SET final_chips = ?, payout_amount = ?, payment_status = ?, payout_tx_signature = ? WHERE poker_event_id = ? AND user_id = ?',
            [seat.chips, payoutSol, 'paid', result.signature || null, table.eventId, seat.discordId]
          ).catch(() => {});
        }
      } else {
        payoutResults.push({ user: seat.displayName, success: false, reason: result?.error || 'Transfer failed' });
        if (db.run) {
          await db.run(
            'UPDATE poker_event_players SET final_chips = ?, payment_status = ? WHERE poker_event_id = ? AND user_id = ?',
            [seat.chips, 'payout_failed', table.eventId, seat.discordId]
          ).catch(() => {});
        }
      }
    }

    // Update event status
    if (db.run) {
      await db.run('UPDATE poker_events SET status = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?', ['ended', table.eventId]).catch(() => {});
    }

    // Post payout summary
    const lines = payoutResults.map(r =>
      r.success
        ? `✅ **${r.user}**: ${r.amount.toFixed(4)} SOL → [tx](https://solscan.io/tx/${r.tx})`
        : `❌ **${r.user}**: ${r.reason}`
    );

    const payoutEmbed = new EmbedBuilder()
      .setColor('#27AE60')
      .setTitle('💰 Poker Payouts')
      .setDescription(
        `Total pool: **${totalBuyIns.toFixed(4)} SOL**\n` +
        `House cut (10%): **${houseCut.toFixed(4)} SOL**\n` +
        `Paid out: **${payoutPool.toFixed(4)} SOL**\n\n` +
        lines.join('\n')
      )
      .setFooter({ text: `Poker Event #${table.eventId}` })
      .setTimestamp();

    await channel.send({ embeds: [payoutEmbed] }).catch(() => {});
  } catch (err) {
    console.error('[Poker] Payout error:', err);
    await channel.send({ content: '⚠️ Error processing payouts. Contact an admin.' }).catch(() => {});
  }
}

/**
 * Collect SOL buy-in from a player when they join a crypto table.
 * Returns { success, error?, txSignature? }
 */
async function collectBuyIn(table, discordId) {
  if (table.mode !== 'crypto' || !table.buyIn || table.buyIn <= 0) return { success: true };
  if (!crypto || !walletSync || !db) return { success: false, error: 'Crypto modules unavailable' };

  try {
    const guildWallet = await walletSync.getGuildWalletWithFallback(table.guildId);
    if (!guildWallet || !guildWallet.wallet_address) {
      return { success: false, error: 'No treasury wallet configured for this server.' };
    }

    // Get user wallet
    const userData = db.getUser ? await db.getUser(discordId) : null;
    if (!userData || !userData.wallet_secret) {
      return { success: false, error: 'You need to connect a wallet first. Use `/user-wallet connect`' };
    }
    if (!userData.solana_address) {
      return { success: false, error: 'No wallet address found. Use `/user-wallet connect`' };
    }

    // Check balance
    const balance = await crypto.getBalance(userData.solana_address);
    if (balance < table.buyIn) {
      return {
        success: false,
        error: `Insufficient balance: **${balance.toFixed(4)} SOL** available, need **${table.buyIn} SOL**.`
      };
    }

    // Transfer from player to treasury
    const keypair = crypto.getKeypairFromSecret(userData.wallet_secret);
    if (!keypair) return { success: false, error: 'Invalid wallet key. Re-connect your wallet.' };

    const result = await crypto.sendSolFrom(keypair, guildWallet.wallet_address, table.buyIn);
    if (!result || !result.success) {
      return { success: false, error: result?.error || 'SOL transfer failed.' };
    }

    // Record in DB
    if (db.run) {
      await db.run(
        `INSERT OR REPLACE INTO poker_event_players (poker_event_id, guild_id, user_id, wallet_address, buy_in_amount, payment_status, entry_tx_signature)
         VALUES (?, ?, ?, ?, ?, 'committed', ?)`,
        [table.eventId, table.guildId, discordId, userData.solana_address, table.buyIn, result.signature || null]
      ).catch(() => {});

      // Update current_players count
      await db.run(
        'UPDATE poker_events SET current_players = (SELECT COUNT(*) FROM poker_event_players WHERE poker_event_id = ?) WHERE id = ?',
        [table.eventId, table.eventId]
      ).catch(() => {});
    }

    return { success: true, txSignature: result.signature };
  } catch (err) {
    console.error('[Poker] Buy-in error:', err);
    return { success: false, error: 'Payment error: ' + (err.message || 'Unknown') };
  }
}

async function updateTableMessage(table, channel) {
  const embed = buildTableEmbed(table);
  const components = buildTableComponents(table);

  try {
    if (table.messageId) {
      try {
        const msg = await channel.messages.fetch(table.messageId);
        await msg.edit({ embeds: [embed], components });
        return msg;
      } catch {
        // Message was deleted, send new one
      }
    }
    const msg = await channel.send({ embeds: [embed], components });
    table.messageId = msg.id;
    return msg;
  } catch (err) {
    console.error('[Poker] Failed to update table message:', err.message);
    return null;
  }
}

// ─── Turn Timer ─────────────────────────────────────────────────────────────

function clearTurnTimer(table) {
  const existing = turnTimers.get(table.id);
  if (existing) {
    clearTimeout(existing);
    turnTimers.delete(table.id);
  }
  table.turnDeadline = null;
}

function startTurnTimer(table, channel) {
  clearTurnTimer(table);
  if (table.phase === 'waiting' || table.phase === 'showdown' || table.phase === 'finished') return;
  if (table.currentPlayerIndex < 0) return;

  table.turnDeadline = Date.now() + table.turnTimer * 1000;

  const timer = setTimeout(async () => {
    turnTimers.delete(table.id);
    // Auto-fold or auto-check on timeout
    const seat = table.seats[table.currentPlayerIndex];
    if (!seat || seat.folded || seat.allIn) return;

    const toCall = table.currentBet - seat.bet;
    const action = toCall > 0 ? 'fold' : 'check';
    console.log(`[Poker] Turn timer expired for ${seat.displayName} — auto ${action}`);

    const result = playerAction(table, seat.discordId, action);
    seat.lastAction = `${action === 'fold' ? '🚫 Fold' : '✋ Check'} (timeout)`;

    try {
      await updateTableMessage(table, channel);
      if (result.phase === 'showdown' || result.phase === 'finished') {
        clearTurnTimer(table);
      } else if (table.phase !== 'waiting') {
        startTurnTimer(table, channel);
      }
    } catch (err) {
      console.error('[Poker] Error after timeout:', err.message);
    }
  }, table.turnTimer * 1000);

  turnTimers.set(table.id, timer);
}

// ─── Slash Command ──────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poker')
    .setDescription('🎰 DCB Poker — Texas Hold\'em right in Discord!')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a new poker table in this channel')
      .addIntegerOption(opt => opt
        .setName('buy-in')
        .setDescription('Starting chip amount (default: 1000)')
        .setMinValue(100)
        .setMaxValue(100000)
        .setRequired(false))
      .addIntegerOption(opt => opt
        .setName('big-blind')
        .setDescription('Big blind amount (default: 10)')
        .setMinValue(2)
        .setMaxValue(1000)
        .setRequired(false))
      .addIntegerOption(opt => opt
        .setName('small-blind')
        .setDescription('Small blind amount (default: 5)')
        .setMinValue(1)
        .setMaxValue(500)
        .setRequired(false))
      .addIntegerOption(opt => opt
        .setName('max-players')
        .setDescription('Max players at the table (2-8, default: 6)')
        .setMinValue(2)
        .setMaxValue(8)
        .setRequired(false))
      .addIntegerOption(opt => opt
        .setName('turn-timer')
        .setDescription('Seconds per turn (default: 30)')
        .setMinValue(10)
        .setMaxValue(120)
        .setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('join')
      .setDescription('Join the poker table in this channel'))
    .addSubcommand(sub => sub
      .setName('leave')
      .setDescription('Leave the poker table'))
    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('Show the current table status')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case 'create': return handleCreate(interaction);
      case 'join': return handleJoin(interaction);
      case 'leave': return handleLeave(interaction);
      case 'status': return handleStatus(interaction);
    }
  },

  // Exported handlers for button interactions (called from index.js)
  handlePokerButton,
  getTableByChannel,
  getTableById,
  getTableByEventId,

  // Expose tables for debugging
  tables,
  tablesById,
  tablesByEventId,
};

// ─── Subcommand Handlers ────────────────────────────────────────────────────

async function handleCreate(interaction) {
  const channelId = interaction.channelId;

  if (tables.has(channelId)) {
    return interaction.reply({
      content: '❌ There is already an active poker table in this channel. Use `/poker status` to see it.',
      ephemeral: true,
    });
  }

  const buyIn = interaction.options.getInteger('buy-in') || 1000;
  const bigBlind = interaction.options.getInteger('big-blind') || 10;
  const smallBlind = interaction.options.getInteger('small-blind') || Math.floor(bigBlind / 2) || 5;
  const maxPlayers = interaction.options.getInteger('max-players') || 6;
  const turnTimer = interaction.options.getInteger('turn-timer') || 30;

  const table = createTable({
    id: `poker_${channelId}_${Date.now()}`,
    guildId: interaction.guildId,
    channelId,
    hostId: interaction.user.id,
    startingBank: buyIn,
    bigBlind,
    smallBlind,
    maxPlayers,
    turnTimer,
  });

  // Auto-seat the creator
  addPlayer(table, interaction.user.id, interaction.user.username, interaction.user.displayName || interaction.user.username, interaction.user.displayAvatarURL?.({ size: 64 }));

  tables.set(channelId, table);
  tablesById.set(table.id, table);

  const embed = buildTableEmbed(table);
  const components = buildTableComponents(table);

  const msg = await interaction.reply({ embeds: [embed], components, fetchReply: true });
  table.messageId = msg.id;

  // Auto-cleanup after 30 minutes of inactivity
  scheduleCleanup(table);
}

async function handleJoin(interaction) {
  const table = getTableByChannel(interaction.channelId);
  if (!table) {
    return interaction.reply({ content: '❌ No poker table in this channel. Use `/poker create` to start one.', ephemeral: true });
  }

  const result = addPlayer(
    table,
    interaction.user.id,
    interaction.user.username,
    interaction.user.displayName || interaction.user.username,
    interaction.user.displayAvatarURL?.({ size: 64 }),
  );

  if (result.error) {
    return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
  }

  await interaction.reply({ content: `✅ **${interaction.user.displayName || interaction.user.username}** joined the table!`, ephemeral: false });
  await updateTableMessage(table, interaction.channel);
}

async function handleLeave(interaction) {
  const table = getTableByChannel(interaction.channelId);
  if (!table) {
    return interaction.reply({ content: '❌ No poker table in this channel.', ephemeral: true });
  }

  const result = removePlayer(table, interaction.user.id);
  if (result.error) {
    return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
  }

  await interaction.reply({ content: `👋 **${interaction.user.displayName || interaction.user.username}** left the table.`, ephemeral: false });

  if (table.seats.length === 0) {
    destroyTable(table);
    return;
  }

  await updateTableMessage(table, interaction.channel);
}

async function handleStatus(interaction) {
  const table = getTableByChannel(interaction.channelId);
  if (!table) {
    return interaction.reply({ content: '❌ No poker table in this channel. Use `/poker create` to start one.', ephemeral: true });
  }

  const embed = buildTableEmbed(table);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ─── Button Interaction Handler ─────────────────────────────────────────────

async function handlePokerButton(interaction) {
  const customId = interaction.customId;

  // Parse: poker_{action}_{tableIdOrEventId}[_{extra}]
  const parts = customId.split('_');
  // parts[0] = 'poker', parts[1] = action
  const action = parts[1];

  // Check if this is a published event button (poker_join_{eventId} or poker_status_{eventId})
  // Published event IDs are purely numeric
  const possibleEventId = parts.slice(2).join('_');
  const isEventButton = /^\d+$/.test(possibleEventId);

  let table;
  let tableId, extra;

  if (isEventButton) {
    const eventId = Number(possibleEventId);
    // Try to find existing in-memory table for this event
    table = getTableByEventId(eventId);

    if (!table && (action === 'join' || action === 'status')) {
      // No table yet — create one from the event record (lazy init on first join)
      if (action === 'join') {
        return handleEventJoin(interaction, eventId);
      } else {
        return interaction.reply({ content: '⏳ No one has joined yet. Click **Join Table** to be the first!', ephemeral: true });
      }
    }
    if (!table) {
      return interaction.reply({ content: '❌ This poker table no longer exists.', ephemeral: true });
    }
  } else {
    // In-memory slash-command created table
    if (['bet', 'raise'].includes(action)) {
      extra = parts[parts.length - 1];
      tableId = parts.slice(2, -1).join('_');
    } else {
      tableId = parts.slice(2).join('_');
    }
    table = getTableById(tableId);
    if (!table) {
      return interaction.reply({ content: '❌ This poker table no longer exists.', ephemeral: true });
    }
  }

  const userId = interaction.user.id;

  switch (action) {
    case 'join': {
      // For crypto tables, collect buy-in before adding player
      if (table.mode === 'crypto' && table.buyIn > 0) {
        await interaction.deferReply({ ephemeral: true });
        const buyInResult = await collectBuyIn(table, userId);
        if (!buyInResult.success) {
          return interaction.editReply({ content: `❌ ${buyInResult.error}` });
        }
      }

      const result = addPlayer(
        table, userId,
        interaction.user.username,
        interaction.user.displayName || interaction.user.username,
        interaction.user.displayAvatarURL?.({ size: 64 }),
      );
      if (result.error) {
        if (interaction.deferred) {
          return interaction.editReply({ content: `❌ ${result.error}` });
        }
        return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
      }

      const joinMsg = table.mode === 'crypto'
        ? `🪑 **${interaction.user.displayName || interaction.user.username}** joined the table! (${table.buyIn} ${table.currency} buy-in confirmed ✅)`
        : `🪑 **${interaction.user.displayName || interaction.user.username}** joined the table!`;

      if (interaction.deferred) {
        await interaction.editReply({ content: joinMsg });
      } else {
        await interaction.reply({ content: joinMsg });
      }
      await updateTableMessage(table, interaction.channel);
      break;
    }

    case 'leave': {
      const result = removePlayer(table, userId);
      if (result.error) {
        return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
      }
      await interaction.reply({ content: `👋 **${interaction.user.displayName || interaction.user.username}** left the table.` });
      if (table.seats.length === 0) {
        // Process payouts if crypto mode before destroying
        if (table.mode === 'crypto') {
          await processPokerPayouts(table, interaction.channel);
        }
        destroyTable(table);
        return;
      }
      await updateTableMessage(table, interaction.channel);
      break;
    }

    case 'start': {
      if (userId !== table.hostId) {
        return interaction.reply({ content: '❌ Only the table host can start the game.', ephemeral: true });
      }
      const result = startHand(table);
      if (result.error) {
        return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
      }
      await interaction.reply({ content: `🃏 **Hand #${table.handNumber}** — Dealing cards...` });

      // Send hole cards to each player via DM or ephemeral follow up
      await sendHoleCards(table, interaction.channel);
      await updateTableMessage(table, interaction.channel);
      startTurnTimer(table, interaction.channel);
      break;
    }

    case 'nexthand': {
      if (table.phase !== 'finished' && table.phase !== 'showdown') {
        return interaction.reply({ content: '❌ Current hand is still in progress.', ephemeral: true });
      }
      const result = startHand(table);
      if (result.error) {
        return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
      }
      await interaction.reply({ content: `🃏 **Hand #${table.handNumber}** — Dealing cards...` });
      await sendHoleCards(table, interaction.channel);
      await updateTableMessage(table, interaction.channel);
      startTurnTimer(table, interaction.channel);
      break;
    }

    case 'viewcards': {
      const seat = table.seats.find(s => s.discordId === userId);
      if (!seat || !seat.holeCards.length) {
        return interaction.reply({ content: '❌ You don\'t have cards. Join the table first.', ephemeral: true });
      }
      const embed = buildHoleCardEmbed(seat, table);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      break;
    }

    case 'fold':
    case 'check':
    case 'call':
    case 'allin': {
      return handleBettingAction(interaction, table, userId, action);
    }

    case 'bet':
    case 'raise': {
      const amount = parseInt(extra) || 0;
      return handleBettingAction(interaction, table, userId, action, amount);
    }

    case 'close': {
      // Host or admin closes the table — triggers final payouts
      if (userId !== table.hostId) {
        return interaction.reply({ content: '❌ Only the table host can close the table.', ephemeral: true });
      }
      await interaction.deferReply();
      // Process crypto payouts if applicable
      if (table.mode === 'crypto') {
        await processPokerPayouts(table, interaction.channel);
      }
      await interaction.editReply({ content: '🔒 **Table closed.** Thank you for playing!' });
      destroyTable(table);
      return;
    }

    default:
      return interaction.reply({ content: '❌ Unknown poker action.', ephemeral: true });
  }
}

/**
 * Handle first join to a published poker event — creates the in-memory table.
 */
async function handleEventJoin(interaction, eventId) {
  if (!db) {
    return interaction.reply({ content: '❌ Database unavailable.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  // Load event from DB
  const event = await db.get?.('SELECT * FROM poker_events WHERE id = ?', [eventId]);
  if (!event) {
    return interaction.editReply({ content: '❌ Poker event not found.' });
  }
  if (event.status !== 'active') {
    return interaction.editReply({ content: '❌ This poker event is no longer active.' });
  }

  // Check if table already exists for this channel
  if (tables.has(interaction.channelId)) {
    return interaction.editReply({ content: '❌ There is already a poker table in this channel.' });
  }

  const isCrypto = event.mode === 'pot' && event.buy_in > 0;

  // Create the in-memory table linked to the event
  const table = createTable({
    id: `poker_event_${eventId}_${Date.now()}`,
    guildId: event.guild_id,
    channelId: interaction.channelId,
    hostId: interaction.user.id,
    mode: isCrypto ? 'crypto' : 'casual',
    startingBank: event.starting_chips || 1000,
    bigBlind: event.big_blind || 10,
    smallBlind: event.small_blind || 5,
    maxPlayers: event.max_players || 6,
    turnTimer: event.turn_timer || 30,
    eventId: eventId,
    buyIn: isCrypto ? event.buy_in : 0,
    currency: event.currency || 'SOL',
  });

  // If crypto mode, collect buy-in first
  if (isCrypto) {
    const buyInResult = await collectBuyIn(table, interaction.user.id);
    if (!buyInResult.success) {
      return interaction.editReply({ content: `❌ ${buyInResult.error}` });
    }
  }

  // Add the first player
  addPlayer(
    table,
    interaction.user.id,
    interaction.user.username,
    interaction.user.displayName || interaction.user.username,
    interaction.user.displayAvatarURL?.({ size: 64 }),
  );

  // Register in all indices
  tables.set(interaction.channelId, table);
  tablesById.set(table.id, table);
  tablesByEventId.set(eventId, table);

  const embed = buildTableEmbed(table);
  const components = buildTableComponents(table);

  const msg = await interaction.channel.send({ embeds: [embed], components });
  table.messageId = msg.id;

  const joinMsg = isCrypto
    ? `✅ You joined **${event.title}**! (${event.buy_in} ${event.currency} buy-in confirmed)`
    : `✅ You joined **${event.title}**!`;

  await interaction.editReply({ content: joinMsg });

  scheduleCleanup(table);
}

async function handleBettingAction(interaction, table, userId, action, amount = 0) {
  const seatIndex = table.seats.findIndex(s => s.discordId === userId);
  if (seatIndex === -1) {
    return interaction.reply({ content: '❌ You are not at this table.', ephemeral: true });
  }

  if (table.currentPlayerIndex !== seatIndex) {
    return interaction.reply({ content: '❌ It is not your turn.', ephemeral: true });
  }

  const result = playerAction(table, userId, action, amount);
  if (result.error) {
    return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
  }

  clearTurnTimer(table);

  const seat = table.seats[seatIndex];
  await interaction.reply({
    content: `${seat.displayName}: **${seat.lastAction}**`,
  });

  await updateTableMessage(table, interaction.channel);

  if (result.phase === 'showdown' || result.phase === 'finished') {
    // Hand is over
    clearTurnTimer(table);
  } else if (table.phase !== 'waiting') {
    startTurnTimer(table, interaction.channel);
  }
}

// ─── Send Hole Cards ────────────────────────────────────────────────────────

async function sendHoleCards(table, channel) {
  for (const seat of table.seats) {
    if (seat.holeCards.length === 0) continue;
    try {
      const embed = buildHoleCardEmbed(seat, table);
      // Try to DM the player
      const member = await channel.guild.members.fetch(seat.discordId).catch(() => null);
      if (member) {
        await member.send({ embeds: [embed] }).catch(() => {
          // DMs may be disabled, they can use the View Cards button
          console.log(`[Poker] Could not DM hole cards to ${seat.displayName} — they can use View Cards button`);
        });
      }
    } catch (err) {
      console.log(`[Poker] Error sending hole cards to ${seat.discordId}:`, err.message);
    }
  }
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

const cleanupTimers = new Map();

function scheduleCleanup(table) {
  const existing = cleanupTimers.get(table.id);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    // Check if table has been active
    if (Date.now() - table.lastActivity > 30 * 60 * 1000) {
      console.log(`[Poker] Cleaning up inactive table ${table.id}`);
      destroyTable(table);
      cleanupTimers.delete(table.id);
    } else {
      // Reschedule
      scheduleCleanup(table);
    }
  }, 30 * 60 * 1000);

  cleanupTimers.set(table.id, timer);
}
