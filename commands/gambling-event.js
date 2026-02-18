const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../utils/db');
const crypto = require('../utils/crypto');
const { processGamblingEvent } = require('../utils/gamblingEventProcessor');
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

// Default roulette-style slot presets
const DEFAULT_SLOTS = [
  { label: '🔴 Red',    color: '#E74C3C' },
  { label: '⚫ Black',  color: '#2C3E50' },
  { label: '🟢 Green',  color: '#27AE60' },
  { label: '🔵 Blue',   color: '#3498DB' },
  { label: '🟡 Gold',   color: '#F1C40F' },
  { label: '🟣 Purple', color: '#9B59B6' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gambling-event')
    .setDescription('Create and manage roulette-style gambling events')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Create a new gambling event')
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
        .addIntegerOption(opt => opt.setName('min_players').setDescription('Min players to spin').setRequired(true))
        .addIntegerOption(opt => opt.setName('max_players').setDescription('Max players').setRequired(true))
        .addIntegerOption(opt => opt.setName('duration_minutes').setDescription('Duration in minutes').setRequired(false))
        .addIntegerOption(opt => opt.setName('num_slots').setDescription('Number of slots (2-6, default 6)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List active gambling events')
    )
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('View gambling event details')
        .addIntegerOption(opt => opt.setName('event_id').setDescription('Event ID').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a gambling event')
        .addIntegerOption(opt => opt.setName('event_id').setDescription('Event ID').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('process')
        .setDescription('Manually process (spin) a gambling event')
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
      const minPlayers = interaction.options.getInteger('min_players');
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
        return interaction.reply({ content: '🎰 No active gambling events in this server.', ephemeral: true });
      }
      const lines = events.map(e =>
        `**#${e.id}** — ${e.title} | ${e.current_players}/${e.max_players} players | ${e.mode} | ${e.status}`
      );
      return interaction.reply({ content: `🎰 **Active Gambling Events:**\n${lines.join('\n')}`, ephemeral: true });
    }

    if (sub === 'info') {
      const eventId = interaction.options.getInteger('event_id');
      const event = await db.getGamblingEvent(eventId);
      if (!event || event.guild_id !== interaction.guildId) {
        return interaction.reply({ content: '❌ Gambling event not found.', ephemeral: true });
      }
      const slots = await db.getGamblingEventSlots(eventId);
      const bets = await db.getGamblingEventBets(eventId);
      const slotList = slots.map(s => {
        const count = bets.filter(b => b.chosen_slot === s.slot_number).length;
        return `${s.label}: ${count} bet(s)`;
      }).join('\n');

      const embed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle(`🎰 Gambling Event #${event.id}`)
        .setDescription(event.description || event.title)
        .addFields(
          { name: 'Mode', value: event.mode === 'pot' ? 'Pot Split' : 'House-funded', inline: true },
          { name: 'Prize', value: event.mode === 'pot' ? `Pot: ${bets.reduce((s, b) => s + (b.bet_amount || 0), 0)} ${event.currency}` : `${event.prize_amount} ${event.currency}`, inline: true },
          { name: 'Players', value: `${event.current_players}/${event.max_players}`, inline: true },
          { name: 'Status', value: event.status, inline: true },
          { name: 'Bets by Slot', value: slotList || 'None' },
        )
        .setTimestamp();

      if (event.winning_slot) {
        const ws = slots.find(s => s.slot_number === event.winning_slot);
        embed.addFields({ name: '🏆 Winning Slot', value: `#${event.winning_slot} — ${ws?.label || '?'}` });
      }

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'remove') {
      const eventId = interaction.options.getInteger('event_id');
      const event = await db.getGamblingEvent(eventId);
      if (!event || event.guild_id !== interaction.guildId) {
        return interaction.reply({ content: '❌ Gambling event not found.', ephemeral: true });
      }

      // If active pot event with entry fees, trigger cancellation with refunds instead of hard delete
      const hasEntryFees = event.mode === 'pot' && (event.entry_fee || 0) > 0 && event.status === 'active';
      if (hasEntryFees) {
        const bets = await db.getGamblingEventBets(eventId);
        const committedBets = bets.filter(b => b.payment_status === 'committed');
        if (committedBets.length > 0) {
          await interaction.deferReply({ ephemeral: true });
          // Process as cancellation — will handle refunds
          await processGamblingEvent(eventId, interaction.client, 'cancelled_by_admin');
          return interaction.editReply({ content: `✅ Gambling event #${eventId} cancelled. Refunds are being processed for ${committedBets.length} participant(s).` });
        }
      }

      await db.deleteGamblingEvent(eventId);
      return interaction.reply({ content: `✅ Gambling event #${eventId} deleted.`, ephemeral: true });
    }

    if (sub === 'process') {
      const eventId = interaction.options.getInteger('event_id');
      const event = await db.getGamblingEvent(eventId);
      if (!event || event.guild_id !== interaction.guildId) {
        return interaction.reply({ content: '❌ Gambling event not found.', ephemeral: true });
      }
      if (event.status !== 'active') {
        return interaction.reply({ content: `❌ Event is already ${event.status}.`, ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      await processGamblingEvent(eventId, interaction.client, 'manual');
      return interaction.editReply({ content: `🎰 Gambling event #${eventId} has been processed!` });
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
      return interaction.editReply({ content: '❌ Gambling event not found.' });
    }
    console.log(`[GamblingEvent] Event #${eventId} fetched: mode=${event.mode}, currency=${event.currency}, entry_fee=${event.entry_fee}, status=${event.status}`);
    if (event.status !== 'active') {
      return interaction.editReply({ content: '❌ This gambling event is no longer active.' });
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
        content: `❌ You already placed a bet on **${chosen?.label || `Slot #${existing.chosen_slot}`}**. One bet per player!`
      });
    }

    const isPotMode = event.mode === 'pot';
    const entryFee = event.entry_fee || 0;
    const requiresPayment = isPotMode && entryFee > 0;
    let userWalletAddress = null;

    // ---- PREPAYMENT VALIDATION (pot mode with entry fee) ----
    if (requiresPayment) {
      // 1. Require connected wallet
      const userData = await db.getUser(interaction.user.id);
      if (!userData || !userData.solana_address) {
        return interaction.editReply({
          content: `❌ **Wallet Required!**\n\nThis event requires a **${entryFee} ${event.currency}** entry fee.\nYou must connect your Solana wallet first.\n\n➡️ Use \`/user-wallet connect address:YOUR_SOLANA_ADDRESS\`\n\nOnce connected, click the slot button again to enter.`
        });
      }
      userWalletAddress = userData.solana_address;

      // 2. Validate wallet address
      if (!crypto.isValidSolanaAddress(userWalletAddress)) {
        return interaction.editReply({
          content: '❌ Your connected wallet address is invalid. Please update it with `/user-wallet update`.'
        });
      }

      // 3. Verify guild treasury wallet exists (with backend sync fallback)
      const guildWallet = await getGuildWalletWithFallback(interaction.guildId);
      if (!guildWallet || !guildWallet.wallet_address) {
        return interaction.editReply({
          content: '❌ This server does not have a treasury wallet configured. Server owner must use `/wallet connect` or **DCB Event Manager** first.'
        });
      }

      // 4. Check on-chain balance (SOL only for now)
      if (event.currency === 'SOL') {
        try {
          const balance = await crypto.getBalance(userWalletAddress);
          if (balance < entryFee) {
            return interaction.editReply({
              content: `❌ **Insufficient Funds!**\n\n💰 Entry fee: **${entryFee} SOL**\n💳 Your wallet balance: **${balance.toFixed(4)} SOL**\n📉 Short by: **${(entryFee - balance).toFixed(4)} SOL**\n\nPlease fund your wallet and try again.\n\`${userWalletAddress}\``
            });
          }
        } catch (balanceErr) {
          console.warn('[GamblingEvent] Balance check error:', balanceErr.message);
          // Continue anyway — balance check is best-effort
        }
      }
    }

    const betAmount = requiresPayment ? entryFee : 0;
    const paymentStatus = requiresPayment ? 'committed' : 'none';

    console.log(`[GamblingEvent] About to joinGamblingEvent: eventId=${eventId}, slot=${slotNumber}, betAmount=${betAmount}, paymentStatus=${paymentStatus}, wallet=${userWalletAddress}`);
    await db.joinGamblingEvent(eventId, interaction.guildId, interaction.user.id, slotNumber, betAmount, paymentStatus, userWalletAddress);
    console.log(`[GamblingEvent] joinGamblingEvent succeeded for event #${eventId}`);

    // Sync bet to backend
    syncBetToBackend({ eventId, action: 'bet', userId: interaction.user.id, guildId: interaction.guildId, slotNumber, betAmount, paymentStatus, walletAddress: userWalletAddress });

    const slots = await db.getGamblingEventSlots(eventId);
    const chosenSlot = slots.find(s => s.slot_number === slotNumber);
    const newCount = event.current_players + 1;

    const confirmMsg = requiresPayment
      ? `🎰 **Bet placed!** You bet on **${chosenSlot?.label || `Slot #${slotNumber}`}**.\n💰 Entry fee: **${entryFee} ${event.currency}** committed from your wallet.\n👥 Players: ${newCount}/${event.max_players}\n\n⚠️ Your entry fee is committed. Payouts go to winners. Refunds issued if event is cancelled.`
      : `🎰 **Bet placed!** You bet on **${chosenSlot?.label || `Slot #${slotNumber}`}**.\n👥 Players: ${newCount}/${event.max_players}`;

    await interaction.editReply({ content: confirmMsg });

    // Announce milestone
    if (newCount === event.min_players) {
      try {
        const channel = await interaction.client.channels.fetch(event.channel_id);
        if (channel) {
          await channel.send({
            content: `🎰 **Gambling Event #${eventId}** — Minimum players reached! The wheel will spin when ${event.max_players} players join or time runs out. 🎲`
          });
        }
      } catch (_) {}
    }

    // Auto-process when full
    if (newCount >= event.max_players) {
      try {
        const channel = await interaction.client.channels.fetch(event.channel_id);
        if (channel) {
          await channel.send({ content: `🎰 **Gambling Event #${eventId}** is FULL! Spinning the wheel... 🎡` });
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

  const slotList = slots.map((s, i) => `${i + 1}. ${s.label}`).join('\n');

  // Build description with rules
  let desc = description || 'Place your bets on a slot!';
  desc += '\n\n**📋 How it works:**\n';
  desc += '1️⃣ Click a slot button below to place your bet\n';
  desc += '2️⃣ The wheel spins when max players join or time runs out\n';
  desc += '3️⃣ If your slot wins — you get paid! 💰\n';

  if (requiresPayment) {
    desc += `\n**💰 Entry Requirements:**\n`;
    desc += `• Entry fee: **${entryFee} ${currency}** per player\n`;
    desc += `• You MUST connect your wallet first: \`/user-wallet connect\`\n`;
    desc += `• Your wallet must have at least **${entryFee} ${currency}** available\n`;
    desc += `• Entry fee is committed when you place your bet\n`;

    desc += `\n**🏆 Prize Distribution:**\n`;
    desc += `• Total pot = all entry fees combined\n`;
    desc += `• **90%** of pot split evenly among winner(s)\n`;
    desc += `• **10%** retained by the house (server treasury)\n`;

    desc += `\n**🔄 Refund Policy:**\n`;
    desc += `• If event is cancelled (not enough players), all entries are refunded\n`;
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
  desc += `• One bet per player — no changes after entry\n`;
  desc += `• Winners determined by random provably-fair wheel spin\n`;
  desc += `• Payouts sent to your connected Solana wallet\n`;
  desc += `• By entering, you agree to these terms and accept the outcome\n`;
  desc += `• Must be 18+ to participate in wagering events`;

  const embed = new EmbedBuilder()
    .setColor('#E74C3C')
    .setTitle(`🎰 DCB Gambling Event: ${title}`)
    .setDescription(desc)
    .addFields(
      { name: '🎲 Mode', value: modeLabel, inline: true },
      { name: '🪑 Players', value: `${currentPlayers}/${maxPlayers}`, inline: true },
      { name: '✅ Min to Spin', value: `${minPlayers}`, inline: true },
      { name: '🎁 Prize', value: prizeInfo, inline: true },
      { name: '🎰 Slots', value: slotList || 'None' },
    )
    .setFooter({ text: `DisCryptoBank • Gamble #${eventId} • Provably Fair` })
    .setTimestamp();

  if (durationMinutes) {
    const endsAt = new Date(Date.now() + (durationMinutes * 60 * 1000));
    const ts = Math.floor(endsAt.getTime() / 1000);
    embed.addFields({ name: '⏱️ Ends', value: `<t:${ts}:R>`, inline: true });
  }

  return embed;
}

// ---- Helper: build slot buttons ----
function buildSlotButtons(eventId, slots) {
  const components = [];
  const buttons = slots.map((s, i) =>
    new ButtonBuilder()
      .setCustomId(`gamble_bet_${eventId}_${i + 1}`)
      .setLabel(s.label)
      .setStyle(ButtonStyle.Primary)
  );

  for (let i = 0; i < buttons.length; i += 5) {
    components.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
  }
  return components;
}
