const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../utils/db');
const crypto = require('../utils/crypto');
const { processGamblingEvent, HORSE_PRESETS } = require('../utils/gamblingEventProcessor');
const { getGuildWalletWithFallback } = require('../utils/walletSync');

// ---- Backend fallback: fetch gambling event from backend DB and cache locally ----
const DCB_BACKEND_URL = process.env.DCB_BACKEND_URL || '';
const DCB_INTERNAL_SECRET = process.env.DCB_INTERNAL_SECRET || '';

async function fetchGamblingEventFromBackend(eventId) {
  if (!DCB_BACKEND_URL || !DCB_INTERNAL_SECRET) return null;
  try {
    const url = `${DCB_BACKEND_URL.replace(/\/$/, '')}/api/internal/gambling-event/${eventId}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      headers: { 'x-dcb-internal-secret': DCB_INTERNAL_SECRET },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const { event, slots } = await res.json();
    if (!event) return null;

    // Cache into bot's local database
    try {
      await db.createGamblingEventFromSync(event, slots);
      console.log(`[GamblingEvent] Synced event #${eventId} from backend DB`);
    } catch (syncErr) {
      console.warn(`[GamblingEvent] Sync cache warning for #${eventId}:`, syncErr.message);
    }
    return event;
  } catch (err) {
    console.error(`[GamblingEvent] Backend fetch error for #${eventId}:`, err.message);
    return null;
  }
}

async function getGamblingEventWithFallback(eventId) {
  let event = await db.getGamblingEvent(eventId);
  // Always try backend to get authoritative state
  const backendEvent = await fetchGamblingEventFromBackend(eventId);
  if (backendEvent) {
    // Preserve the LOCAL player count (bot DB is authoritative for bets/joins
    // because they happen in the bot process and sync to backend is async)
    const localPlayers = event ? event.current_players : 0;
    event = backendEvent;
    event.current_players = Math.max(localPlayers, backendEvent.current_players || 0);
  }
  return event;
}

// Fire-and-forget sync of bet actions back to backend DB
function syncBetToBackend(body) {
  if (!DCB_BACKEND_URL || !DCB_INTERNAL_SECRET) return;
  const url = `${DCB_BACKEND_URL.replace(/\/$/, '')}/api/internal/gambling-event-sync`;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dcb-internal-secret': DCB_INTERNAL_SECRET },
    body: JSON.stringify(body)
  }).catch(err => console.error('[GamblingEvent] Backend sync error:', err.message));
}

// Default horse presets (mapped from HORSE_PRESETS in processor)
const DEFAULT_SLOTS = HORSE_PRESETS.map(h => ({
  label: `${h.emoji} ${h.name}`,
  color: h.color,
}));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gambling-event')
    .setDescription('Create and manage horse race gambling events')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Create a new horse race event')
        .addStringOption(opt => opt.setName('title').setDescription('Event title').setRequired(true))
        .addStringOption(opt => opt.setName('description').setDescription('Event description').setRequired(false))
        .addStringOption(opt =>
          opt.setName('mode').setDescription('Prize mode')
            .addChoices(
              { name: 'House-funded (owner sets prize)', value: 'house' },
              { name: 'Pot split (entry fees pooled)', value: 'pot' }
            )
            .setRequired(false)
        )
        .addNumberOption(opt => opt.setName('prize_amount').setDescription('Prize pool (house mode)').setRequired(false))
        .addStringOption(opt => opt.setName('currency').setDescription('Currency (SOL/USD)').setRequired(false))
        .addNumberOption(opt => opt.setName('entry_fee').setDescription('Entry fee per player (pot mode)').setRequired(false))
        .addIntegerOption(opt => opt.setName('min_players').setDescription('Min players to race (default 1)').setMinValue(1).setRequired(false))
        .addIntegerOption(opt => opt.setName('max_players').setDescription('Max players').setRequired(true))
        .addIntegerOption(opt => opt.setName('duration_minutes').setDescription('Duration in minutes').setRequired(false))
        .addIntegerOption(opt => opt.setName('num_slots').setDescription('Number of horses (2-6, default 6)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List active horse race events')
    )
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('View horse race event details')
        .addIntegerOption(opt => opt.setName('event_id').setDescription('Event ID').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a horse race event')
        .addIntegerOption(opt => opt.setName('event_id').setDescription('Event ID').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('process')
        .setDescription('Manually start (race) a horse race event')
        .addIntegerOption(opt => opt.setName('event_id').setDescription('Event ID').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description') || '';
      const mode = interaction.options.getString('mode') || 'house';
      const prizeAmount = interaction.options.getNumber('prize_amount') || 0;
      const currency = interaction.options.getString('currency') || 'SOL';
      const entryFee = interaction.options.getNumber('entry_fee') || 0;
      const minPlayers = interaction.options.getInteger('min_players') || 1;
      const maxPlayers = interaction.options.getInteger('max_players');
      const durationMinutes = interaction.options.getInteger('duration_minutes') || null;
      const numSlots = Math.min(Math.max(interaction.options.getInteger('num_slots') || 6, 2), 6);

      const eventId = await db.createGamblingEvent(
        interaction.guildId, interaction.channelId,
        title, description, mode, prizeAmount, currency, entryFee,
        minPlayers, maxPlayers, durationMinutes, numSlots, interaction.user.id
      );

      // Add default slots
      const slotsToUse = DEFAULT_SLOTS.slice(0, numSlots);
      for (let i = 0; i < slotsToUse.length; i++) {
        await db.addGamblingEventSlot(eventId, i + 1, slotsToUse[i].label, slotsToUse[i].color);
      }

      // Build embed
      const embed = createGamblingEventEmbed(eventId, title, description, mode, prizeAmount, currency, entryFee, 0, minPlayers, maxPlayers, durationMinutes, slotsToUse);

      // Build slot buttons
      const components = buildSlotButtons(eventId, slotsToUse);

      const msg = await interaction.reply({ embeds: [embed], components, fetchReply: true });
      await db.updateGamblingEventMessageId(eventId, msg.id);

      return;
    }

    if (sub === 'list') {
      const events = await db.getActiveGamblingEvents(interaction.guildId);
      if (events.length === 0) {
        return interaction.reply({ content: '� No active horse race events in this server.', ephemeral: true });
      }
      const lines = events.map(e =>
        `**#${e.id}** — ${e.title} | ${e.current_players}/${e.max_players} riders | ${e.mode} | ${e.status}`
      );
      return interaction.reply({ content: `🏇 **Active Horse Race Events:**\n${lines.join('\n')}`, ephemeral: true });
    }

    if (sub === 'info') {
      const eventId = interaction.options.getInteger('event_id');
      const event = await db.getGamblingEvent(eventId);
      if (!event || event.guild_id !== interaction.guildId) {
        return interaction.reply({ content: '❌ Horse race event not found.', ephemeral: true });
      }
      const slots = await db.getGamblingEventSlots(eventId);
      const bets = await db.getGamblingEventBets(eventId);
      const slotList = slots.map(s => {
        const count = bets.filter(b => b.chosen_slot === s.slot_number).length;
        return `${s.label}: ${count} bet(s)`;
      }).join('\n');

      const embed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle(`🏇 Horse Race #${event.id}`)
        .setDescription(event.description || event.title)
        .addFields(
          { name: 'Mode', value: event.mode === 'pot' ? 'Pot Split' : 'House-funded', inline: true },
          { name: 'Prize', value: event.mode === 'pot' ? `Pot: ${bets.reduce((s, b) => s + (b.bet_amount || 0), 0)} ${event.currency}` : `${event.prize_amount} ${event.currency}`, inline: true },
          { name: 'Riders', value: `${event.current_players}/${event.max_players}`, inline: true },
          { name: 'Status', value: event.status, inline: true },
          { name: 'Bets by Horse', value: slotList || 'None' },
        )
        .setTimestamp();

      if (event.winning_slot) {
        const ws = slots.find(s => s.slot_number === event.winning_slot);
        embed.addFields({ name: '🏆 Winning Horse', value: `#${event.winning_slot} — ${ws?.label || '?'}` });
      }

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'remove') {
      const eventId = interaction.options.getInteger('event_id');
      const event = await db.getGamblingEvent(eventId);
      if (!event || event.guild_id !== interaction.guildId) {
        return interaction.reply({ content: '❌ Horse race event not found.', ephemeral: true });
      }

      // If active pot event with entry fees, trigger cancellation with refunds instead of hard delete
      const hasEntryFees = event.mode === 'pot' && (event.entry_fee || 0) > 0 && event.status === 'active';
      if (hasEntryFees) {
        const bets = await db.getGamblingEventBets(eventId);
        const committedBets = bets.filter(b => b.payment_status === 'committed');
        if (committedBets.length > 0) {
          await interaction.deferReply({ ephemeral: true });
          await processGamblingEvent(eventId, interaction.client, 'cancelled_by_admin');
          return interaction.editReply({ content: `✅ Horse race #${eventId} cancelled. Refunds are being processed for ${committedBets.length} rider(s).` });
        }
      }

      await db.deleteGamblingEvent(eventId);
      return interaction.reply({ content: `✅ Horse race #${eventId} deleted.`, ephemeral: true });
    }

    if (sub === 'process') {
      const eventId = interaction.options.getInteger('event_id');
      const event = await db.getGamblingEvent(eventId);
      if (!event || event.guild_id !== interaction.guildId) {
        return interaction.reply({ content: '❌ Horse race event not found.', ephemeral: true });
      }
      if (event.status !== 'active') {
        return interaction.reply({ content: `❌ Event is already ${event.status}.`, ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      await processGamblingEvent(eventId, interaction.client, 'manual');
      return interaction.editReply({ content: `🏇 Horse race #${eventId} is off! Watch the race in the channel! 🏁` });
    }
  },

  // ---- Button handler: place a bet ----
  async handleBetButton(interaction) {
    // customId format: gamble_bet_{eventId}_{slotNumber}
    const parts = interaction.customId.split('_');
    const eventId = Number(parts[2]);
    const slotNumber = Number(parts[3]);

    console.log(`[GamblingEvent] handleBetButton called: eventId=${eventId}, slot=${slotNumber}, user=${interaction.user.id}`);

    // NOTE: deferReply is now called by index.js before this handler runs

    const event = await getGamblingEventWithFallback(eventId);
    if (!event) {
      console.log(`[GamblingEvent] Event #${eventId} not found in local or backend DB`);
      return interaction.editReply({ content: '❌ Horse race event not found.' });
    }
    console.log(`[GamblingEvent] Event #${eventId} fetched: mode=${event.mode}, currency=${event.currency}, entry_fee=${event.entry_fee}, status=${event.status}`);
    if (event.status !== 'active') {
      return interaction.editReply({ content: '❌ This horse race is no longer active.' });
    }
    if (event.current_players >= event.max_players) {
      return interaction.editReply({ content: '❌ This event is full.' });
    }

    // Check if user already bet
    const existing = await db.getGamblingEventBet(eventId, interaction.user.id);
    if (existing) {
      const slots = await db.getGamblingEventSlots(eventId);
      const chosen = slots.find(s => s.slot_number === existing.chosen_slot);
      return interaction.editReply({
        content: `❌ You already picked **${chosen?.label || `Horse #${existing.chosen_slot}`}**. One bet per rider!`
      });
    }

    const isPotMode = event.mode === 'pot';
    const entryFee = event.entry_fee || 0;
    const requiresPayment = isPotMode && entryFee > 0;

    if (requiresPayment) {
      // ---- POT MODE: Show confirmation box with "Confirm & Pay" button ----
      const slots = await db.getGamblingEventSlots(eventId);
      const chosenSlot = slots.find(s => s.slot_number === slotNumber);
      const horseName = chosenSlot?.label || `Horse #${slotNumber}`;

      // Build fee display
      let feeDisplay = `${entryFee} ${event.currency}`;
      let solEquivNote = '';
      if (event.currency === 'USD') {
        const solPrice = await crypto.getSolanaPrice();
        if (solPrice) {
          const solEquiv = entryFee / solPrice;
          feeDisplay = `${entryFee} USD`;
          solEquivNote = `\n💱 ≈ **${solEquiv.toFixed(6)} SOL** @ $${solPrice.toFixed(2)}/SOL`;
        }
      }

      // Get treasury address for display
      const guildWallet = await getGuildWalletWithFallback(interaction.guildId);
      const treasuryAddr = guildWallet?.wallet_address || '(not configured)';

      const confirmButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`gamble_confirm_${eventId}_${slotNumber}`)
          .setLabel('💰 Confirm Bet & Pay Entry Fee')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`gamble_cancel_${eventId}_${slotNumber}`)
          .setLabel('❌ Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      const confirmEmbed = new EmbedBuilder()
        .setColor('#F1C40F')
        .setTitle('🏇 Confirm Your Bet')
        .setDescription(
          `You're about to enter **Horse Race #${eventId}**\n\n` +
          `🐴 **Horse:** ${horseName}\n` +
          `💰 **Entry Fee:** ${feeDisplay}${solEquivNote}\n` +
          `🏦 **Treasury:** \`${treasuryAddr.slice(0,6)}...${treasuryAddr.slice(-4)}\`\n\n` +
          `By clicking **Confirm Bet & Pay**, your entry fee will be committed from your connected wallet to the server treasury.\n\n` +
          `⚠️ Entry fees are non-refundable unless the race is cancelled.`
        )
        .setFooter({ text: 'DisCryptoBank • Horse Race Entry' })
        .setTimestamp();

      return interaction.editReply({ embeds: [confirmEmbed], components: [confirmButton] });
    }

    // ---- NON-POT MODE: Instant bet (no entry fee) ----
    await db.joinGamblingEvent(eventId, interaction.guildId, interaction.user.id, slotNumber, 0, 'none', null);
    syncBetToBackend({ eventId, action: 'bet', userId: interaction.user.id, guildId: interaction.guildId, slotNumber, betAmount: 0, paymentStatus: 'none', walletAddress: null });

    const slots = await db.getGamblingEventSlots(eventId);
    const chosenSlot = slots.find(s => s.slot_number === slotNumber);
    const newCount = event.current_players + 1;

    const confirmMsg = `🏇 **Bet placed!** You picked **${chosenSlot?.label || `Horse #${slotNumber}`}**.\n👥 Riders: ${newCount}/${event.max_players}`;
    await interaction.editReply({ content: confirmMsg });

    // ---- Update embed + auto-process (shared logic) ----
    await this._updateEmbedAndAutoProcess(interaction, event, eventId, slots, newCount);
  },

  // ---- Button handler: confirm bet & pay entry fee (pot mode step 2) ----
  async handleConfirmBet(interaction) {
    // customId format: gamble_confirm_{eventId}_{slotNumber}
    const parts = interaction.customId.split('_');
    const eventId = Number(parts[2]);
    const slotNumber = Number(parts[3]);

    console.log(`[GamblingConfirm] Confirm bet: eventId=${eventId}, slot=${slotNumber}, user=${interaction.user.id}`);

    const event = await getGamblingEventWithFallback(eventId);
    if (!event) return interaction.editReply({ content: '❌ Horse race event not found.', embeds: [], components: [] });
    if (event.status !== 'active') return interaction.editReply({ content: '❌ This horse race is no longer active.', embeds: [], components: [] });
    if (event.current_players >= event.max_players) return interaction.editReply({ content: '❌ This event is full.', embeds: [], components: [] });

    // Check if user already bet (double-click guard)
    const existing = await db.getGamblingEventBet(eventId, interaction.user.id);
    if (existing) {
      const slots = await db.getGamblingEventSlots(eventId);
      const chosen = slots.find(s => s.slot_number === existing.chosen_slot);
      return interaction.editReply({
        content: `❌ You already picked **${chosen?.label || `Horse #${existing.chosen_slot}`}**. One bet per rider!`,
        embeds: [], components: []
      });
    }

    const entryFee = event.entry_fee || 0;

    // 1. Require connected wallet
    const userData = await db.getUser(interaction.user.id);
    if (!userData || !userData.solana_address) {
      return interaction.editReply({
        content: `❌ **Wallet Required!**\n\nUse \`/user-wallet connect address:YOUR_SOLANA_ADDRESS\` first.`,
        embeds: [], components: []
      });
    }
    const userWalletAddress = userData.solana_address;

    // 2. Validate wallet address
    if (!crypto.isValidSolanaAddress(userWalletAddress)) {
      return interaction.editReply({
        content: '❌ Your connected wallet address is invalid. Update with `/user-wallet update`.',
        embeds: [], components: []
      });
    }

    // 3. Verify guild treasury wallet exists
    const guildWallet = await getGuildWalletWithFallback(interaction.guildId);
    if (!guildWallet || !guildWallet.wallet_address) {
      return interaction.editReply({
        content: '❌ Server treasury wallet not configured. Admin must set up a wallet first.',
        embeds: [], components: []
      });
    }

    // 4. Check on-chain balance
    let balanceDisplay = '';
    if (event.currency === 'SOL') {
      try {
        const balance = await crypto.getBalance(userWalletAddress);
        if (balance < entryFee) {
          return interaction.editReply({
            content: `❌ **Insufficient Funds!**\n\n💰 Entry fee: **${entryFee} SOL**\n💳 Your balance: **${balance.toFixed(4)} SOL**\n📉 Short by: **${(entryFee - balance).toFixed(4)} SOL**\n\nFund your wallet and try again.`,
            embeds: [], components: []
          });
        }
        balanceDisplay = `\n💳 Wallet balance: **${balance.toFixed(4)} SOL**`;
      } catch (balanceErr) {
        console.warn('[GamblingConfirm] Balance check error:', balanceErr.message);
      }
    } else if (event.currency === 'USD') {
      // For USD, check SOL equivalent
      try {
        const solPrice = await crypto.getSolanaPrice();
        if (solPrice) {
          const solNeeded = entryFee / solPrice;
          const balance = await crypto.getBalance(userWalletAddress);
          if (balance < solNeeded) {
            return interaction.editReply({
              content: `❌ **Insufficient Funds!**\n\n💰 Entry fee: **${entryFee} USD** (≈ ${solNeeded.toFixed(6)} SOL)\n💳 Your balance: **${balance.toFixed(4)} SOL**\n\nFund your wallet and try again.`,
              embeds: [], components: []
            });
          }
          balanceDisplay = `\n💳 Wallet balance: **${balance.toFixed(4)} SOL** ✓`;
        }
      } catch (balanceErr) {
        console.warn('[GamblingConfirm] USD balance check error:', balanceErr.message);
      }
    }

    // 5. Commit the bet — entry fee tracked in virtual pot, treasury pays winners
    const betAmount = entryFee;
    const paymentStatus = 'committed';

    await db.joinGamblingEvent(eventId, interaction.guildId, interaction.user.id, slotNumber, betAmount, paymentStatus, userWalletAddress);
    console.log(`[GamblingConfirm] ✅ Bet committed: event #${eventId}, slot ${slotNumber}, user ${interaction.user.id}, amount ${betAmount} ${event.currency}`);

    syncBetToBackend({ eventId, action: 'bet', userId: interaction.user.id, guildId: interaction.guildId, slotNumber, betAmount, paymentStatus, walletAddress: userWalletAddress });

    const slots = await db.getGamblingEventSlots(eventId);
    const chosenSlot = slots.find(s => s.slot_number === slotNumber);
    const newCount = event.current_players + 1;

    // Build fee display
    let feeDisplay = `${entryFee} ${event.currency}`;
    if (event.currency === 'USD') {
      const solPrice = await crypto.getSolanaPrice();
      if (solPrice) {
        feeDisplay = `${entryFee} USD (≈ ${(entryFee / solPrice).toFixed(6)} SOL)`;
      }
    }

    const successEmbed = new EmbedBuilder()
      .setColor('#27AE60')
      .setTitle('✅ Bet Confirmed & Entry Fee Paid!')
      .setDescription(
        `🏇 **Horse:** ${chosenSlot?.label || `Horse #${slotNumber}`}\n` +
        `💰 **Entry Fee:** ${feeDisplay}\n` +
        `🏦 **Paid to:** \`${guildWallet.wallet_address.slice(0,6)}...${guildWallet.wallet_address.slice(-4)}\`${balanceDisplay}\n` +
        `👥 **Riders:** ${newCount}/${event.max_players}\n\n` +
        `🍀 Good luck! Winners receive payouts directly to their connected wallet.`
      )
      .setFooter({ text: `DisCryptoBank • Horse Race #${eventId}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed], components: [] });

    // ---- Update embed + auto-process ----
    await this._updateEmbedAndAutoProcess(interaction, event, eventId, slots, newCount);
  },

  // ---- Button handler: cancel bet (from confirmation box) ----
  async handleCancelBet(interaction) {
    return interaction.editReply({
      content: '❌ Bet cancelled. You can pick a horse any time before the race starts!',
      embeds: [], components: []
    });
  },

  // ---- Shared: update embed + auto-process when full ----
  async _updateEmbedAndAutoProcess(interaction, event, eventId, slots, newCount) {
    try {
      if (event.message_id && event.channel_id) {
        const channel = await interaction.client.channels.fetch(event.channel_id);
        if (channel) {
          const originalMsg = await channel.messages.fetch(event.message_id);
          if (originalMsg) {
            const updatedEmbed = createGamblingEventEmbed(
              eventId, event.title, event.description, event.mode,
              event.prize_amount, event.currency, event.entry_fee,
              newCount, event.min_players, event.max_players,
              null, // duration doesn't matter for rebuild — timestamp already set
              slots.map(s => ({ label: s.label, color: s.color }))
            );
            // Preserve original timestamp field if present
            const existingTimerField = originalMsg.embeds[0]?.fields?.find(f => f.name === '⏱️ Ends');
            if (existingTimerField) {
              updatedEmbed.addFields({ name: '⏱️ Ends', value: existingTimerField.value, inline: true });
            }
            await originalMsg.edit({ embeds: [updatedEmbed], components: originalMsg.components });
          }
        }
      }
    } catch (embedErr) {
      console.warn(`[GamblingEvent] Failed to update embed for event #${eventId}:`, embedErr.message);
    }

    // Announce milestone (skip if min is 1, that's the first bet — not noteworthy)
    if (event.min_players > 1 && newCount === event.min_players) {
      try {
        const channel = await interaction.client.channels.fetch(event.channel_id);
        if (channel) {
          await channel.send({
            content: `� **Horse Race #${eventId}** — Minimum riders reached! The race will start when ${event.max_players} riders join or time runs out. 🏁`
          });
        }
      } catch (_) {}
    }

    // Auto-process when full
    if (newCount >= event.max_players) {
      try {
        const channel = await interaction.client.channels.fetch(event.channel_id);
        if (channel) {
          await channel.send({ content: `🏇 **Horse Race #${eventId}** — All riders in! The race is starting... 🏁` });
        }
      } catch (_) {}
      await processGamblingEvent(eventId, interaction.client, 'full');
    }
  },
};

// ---- Helper: build embed with rules & T&Cs ----
function createGamblingEventEmbed(eventId, title, description, mode, prizeAmount, currency, entryFee, currentPlayers, minPlayers, maxPlayers, durationMinutes, slots) {
  const modeLabel = mode === 'pot' ? '🏦 Pot Split' : '🏠 House-funded';
  const isPotMode = mode === 'pot';
  const requiresPayment = isPotMode && entryFee > 0;

  const prizeInfo = isPotMode
    ? `${entryFee} ${currency} entry → pot split (90% to winners)`
    : `${prizeAmount} ${currency}`;

  const horseList = slots.map((s, i) => `${i + 1}. 🏇 ${s.label}`).join('\n');

  // Build description with horse race rules
  let desc = description || 'Pick your horse and bet on the winner!';
  desc += '\n\n**📋 How it works:**\n';
  desc += '1️⃣ Click a horse button below to place your bet\n';
  desc += '2️⃣ The race starts when max riders join or time runs out\n';
  desc += '3️⃣ Watch the horses race down the track in real-time! 🏁\n';
  desc += '4️⃣ If your horse wins — you get paid! 💰\n';

  if (requiresPayment) {
    desc += `\n**💰 Entry Requirements:**\n`;
    desc += `• Entry fee: **${entryFee} ${currency}** per rider\n`;
    desc += `• You MUST connect your wallet first: \`/user-wallet connect\`\n`;
    desc += `• Your wallet must have at least **${entryFee} ${currency}** available\n`;
    desc += `• Click a horse → confirm & pay → you're in! 🏇\n`;

    desc += `\n**🏆 Prize Distribution:**\n`;
    desc += `• Total pot = all entry fees combined\n`;
    desc += `• **90%** of pot split evenly among winner(s)\n`;
    desc += `• **10%** retained by the house (server treasury)\n`;

    desc += `\n**🔄 Refund Policy:**\n`;
    desc += `• If the race is cancelled, all entries are refunded\n`;
    desc += `• Solo rider? You race against the house! 🏠\n`;
    desc += `• Refunds are sent to your connected wallet address\n`;
  } else {
    desc += `\n**🏆 Prize Distribution:**\n`;
    if (isPotMode) {
      desc += `• **90%** of pot split evenly among winner(s)\n`;
      desc += `• **10%** retained by the house (server treasury)\n`;
    } else {
      desc += `• Prize: **${prizeAmount} ${currency}** funded by the house\n`;
      desc += `• Full prize amount goes to the winner(s)\n`;
    }
  }

  desc += `\n**📜 Rules & Terms:**\n`;
  desc += `• One horse per rider — no changes after entry\n`;
  desc += `• Winner determined by provably-fair random race\n`;
  desc += `• Payouts sent to your connected Solana wallet\n`;
  desc += `• Solo entry = race against the house (your horse must win to collect) 🏠\n`;
  desc += `• By entering, you agree to these terms and accept the outcome\n`;
  desc += `• Must be 18+ to participate in wagering events`;

  const embed = new EmbedBuilder()
    .setColor('#E74C3C')
    .setTitle(`🏇 DCB Horse Race: ${title}`)
    .setDescription(desc)
    .addFields(
      { name: '🎲 Mode', value: modeLabel, inline: true },
      { name: '🪑 Riders', value: `${currentPlayers}/${maxPlayers}`, inline: true },
      { name: '✅ Min to Race', value: minPlayers <= 1 ? '1 (vs House 🏠)' : `${minPlayers}`, inline: true },
      { name: '🎁 Prize', value: prizeInfo, inline: true },
      { name: '🏇 Horses', value: horseList || 'None' },
    )
    .setFooter({ text: `DisCryptoBank • Horse Race #${eventId} • Provably Fair` })
    .setTimestamp();

  if (durationMinutes) {
    const endsAt = new Date(Date.now() + (durationMinutes * 60 * 1000));
    const ts = Math.floor(endsAt.getTime() / 1000);
    embed.addFields({ name: '⏱️ Ends', value: `<t:${ts}:R>`, inline: true });
  }

  return embed;
}

// ---- Helper: build horse buttons ----
function buildSlotButtons(eventId, slots) {
  const components = [];
  const buttons = slots.map((s, i) =>
    new ButtonBuilder()
      .setCustomId(`gamble_bet_${eventId}_${i + 1}`)
      .setLabel(`🏇 ${s.label}`)
      .setStyle(ButtonStyle.Primary)
  );

  for (let i = 0; i < buttons.length; i += 5) {
    components.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
  }
  return components;
}
