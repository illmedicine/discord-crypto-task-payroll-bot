const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../utils/db');
const crypto = require('../utils/crypto');
const { processGamblingEvent, HORSE_PRESETS } = require('../utils/gamblingEventProcessor');
const { getGuildWalletWithFallback } = require('../utils/walletSync');

// ---- Backend fallback: fetch gambling event from backend DB and cache locally ----
const DCB_BACKEND_URL = process.env.DCB_BACKEND_URL || '';
const DCB_INTERNAL_SECRET = process.env.DCB_INTERNAL_SECRET || '';

async function fetchGamblingEventFromBackend(eventId, attempt = 1) {
  if (!DCB_BACKEND_URL || !DCB_INTERNAL_SECRET) {
    console.warn(`[GamblingEvent] Backend fallback SKIPPED for #${eventId} — DCB_BACKEND_URL=${!!DCB_BACKEND_URL}, DCB_INTERNAL_SECRET=${!!DCB_INTERNAL_SECRET}`);
    return null;
  }
  try {
    const url = `${DCB_BACKEND_URL.replace(/\/$/, '')}/api/internal/gambling-event/${eventId}`;
    console.log(`[GamblingEvent] Fetching event #${eventId} from backend (attempt ${attempt}): ${url}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: { 'x-dcb-internal-secret': DCB_INTERNAL_SECRET },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[GamblingEvent] Backend returned ${res.status} for event #${eventId}`);
      // Retry once on 5xx errors
      if (res.status >= 500 && attempt < 2) {
        await new Promise(r => setTimeout(r, 1000));
        return fetchGamblingEventFromBackend(eventId, attempt + 1);
      }
      return null;
    }
    const data = await res.json();
    const { event, slots } = data;
    if (!event) {
      console.warn(`[GamblingEvent] Backend returned OK but no event data for #${eventId}`);
      return null;
    }

    console.log(`[GamblingEvent] ✅ Got event #${eventId} from backend: title="${event.title}", status=${event.status}`);

    // Cache into bot's local database
    try {
      await db.createGamblingEventFromSync(event, slots);
      console.log(`[GamblingEvent] ✅ Cached event #${eventId} into local DB`);
    } catch (syncErr) {
      console.warn(`[GamblingEvent] Sync cache warning for #${eventId}:`, syncErr.message);
    }
    return event;
  } catch (err) {
    console.error(`[GamblingEvent] Backend fetch error for #${eventId} (attempt ${attempt}):`, err.message);
    // Retry once on network errors
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 1000));
      return fetchGamblingEventFromBackend(eventId, attempt + 1);
    }
    return null;
  }
}

async function getGamblingEventWithFallback(eventId, interaction = null) {
  let event = await db.getGamblingEvent(eventId);
  console.log(`[GamblingEvent] Local DB lookup for #${eventId}: ${event ? `found (status=${event.status})` : 'NOT FOUND'}`);

  // Always try backend to get authoritative state
  const backendEvent = await fetchGamblingEventFromBackend(eventId);
  if (backendEvent) {
    // Preserve the LOCAL player count (bot DB is authoritative for bets/joins
    // because they happen in the bot process and sync to backend is async)
    const localPlayers = event ? event.current_players : 0;
    event = backendEvent;
    event.current_players = Math.max(localPlayers, backendEvent.current_players || 0);
  }

  // Third fallback: reconstruct from the Discord message embed
  if (!event && interaction) {
    console.log(`[GamblingEvent] Trying embed reconstruction for #${eventId}...`);
    try {
      event = await reconstructEventFromEmbed(interaction, eventId);
    } catch (embedErr) {
      console.error(`[GamblingEvent] Embed reconstruction threw:`, embedErr);
    }
  }

  if (!event) {
    const diag = {
      localDb: 'miss',
      backendUrl: !!DCB_BACKEND_URL,
      backendSecret: !!DCB_INTERNAL_SECRET,
      backendResult: backendEvent ? 'found' : 'miss',
      hasInteraction: !!interaction,
      hasMessage: !!interaction?.message,
      hasEmbeds: interaction?.message?.embeds?.length || 0,
      embedTitle: interaction?.message?.embeds?.[0]?.title || 'none',
      componentRows: interaction?.message?.components?.length || 0,
    };
    console.error(`[GamblingEvent] ❌ Event #${eventId} NOT FOUND anywhere. Diagnostics:`, JSON.stringify(diag));
  }
  return event;
}

// Last-resort fallback: reconstruct event from the Discord message embed
async function reconstructEventFromEmbed(interaction, eventId) {
  try {
    const msg = interaction.message;
    if (!msg) { console.log('[GamblingEvent] No interaction.message for embed reconstruction'); return null; }
    const embed = msg.embeds?.[0];
    if (!embed) { console.log(`[GamblingEvent] No embed found on message (embeds.length=${msg.embeds?.length}, hasComponents=${!!msg.components?.length})`); return null; }
    
    // Log raw embed data for debugging
    console.log(`[GamblingEvent] Embed data: title="${embed.title}", fields=${embed.fields?.length || 0}, desc.length=${embed.description?.length || 0}`);
    if (embed.fields) {
      for (const f of embed.fields) {
        console.log(`[GamblingEvent]   field: name="${f.name}", value="${String(f.value).slice(0, 50)}"`);
      }
    }

    console.log(`[GamblingEvent] Reconstructing event #${eventId} from embed: "${embed.title}"`);

    // Parse title: "🎰 DCB Gambling Event: {title}"
    const title = embed.title?.replace(/^.*?DCB Gambling Event:\s*/, '').trim() || `Event #${eventId}`;

    // Parse mode from "🎲 Mode" field
    const modeField = embed.fields?.find(f => f.name.includes('Mode'));
    const mode = modeField?.value?.includes('Pot') ? 'pot' : 'house';

    // Parse players from "🪑 Players" field: "0/10"
    const playersField = embed.fields?.find(f => f.name.includes('Players'));
    let currentPlayers = 0, maxPlayers = 10;
    if (playersField?.value) {
      const m = playersField.value.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) { currentPlayers = parseInt(m[1]); maxPlayers = parseInt(m[2]); }
    }

    // Parse min players from "✅ Min to Spin" field
    const minField = embed.fields?.find(f => f.name.includes('Min'));
    const minPlayers = minField?.value ? parseInt(minField.value) || 2 : 2;

    // Parse entry fee + currency from description
    let entryFee = 0, currency = 'SOL', prizeAmount = 0;
    const desc = embed.description || '';
    const feeMatch = desc.match(/Entry fee:\s*\*\*(\d+(?:\.\d+)?)\s+(\w+)\*\*/i);
    if (feeMatch) { entryFee = parseFloat(feeMatch[1]); currency = feeMatch[2]; }

    // Parse prize from Prize Pool field
    const prizeField = embed.fields?.find(f => f.name.includes('Prize'));
    if (prizeField?.value) {
      const pm = prizeField.value.match(/(\d+(?:\.\d+)?)\s+(\w+)/);
      if (pm) { prizeAmount = parseFloat(pm[1]); if (!feeMatch) currency = pm[2]; }
    }

    // Parse ends_at from "⏱️ Ends" field (Discord timestamp: <t:1234567890:R>)
    const endsField = embed.fields?.find(f => f.name.includes('Ends'));
    let endsAt = null;
    if (endsField?.value) {
      const tsMatch = endsField.value.match(/<t:(\d+)/);
      if (tsMatch) endsAt = new Date(parseInt(tsMatch[1]) * 1000).toISOString();
    }

    // Extract slots from button components on the message
    const slots = [];
    console.log(`[GamblingEvent] Message has ${msg.components?.length || 0} component rows`);
    for (const row of (msg.components || [])) {
      console.log(`[GamblingEvent]   Row has ${row.components?.length || 0} components`);
      for (const comp of (row.components || [])) {
        console.log(`[GamblingEvent]     Component: customId="${comp.customId}", label="${comp.label}", type=${comp.type}`);
        if (comp.customId?.startsWith(`gamble_bet_${eventId}_`)) {
          const slotNum = parseInt(comp.customId.split('_').pop());
          slots.push({ slot_number: slotNum, label: comp.label || `Horse #${slotNum}`, color: '#888' });
        }
      }
    }

    const event = {
      id: eventId,
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      message_id: msg.id,
      title,
      description: title,
      mode,
      prize_amount: prizeAmount,
      currency,
      entry_fee: entryFee,
      min_players: minPlayers,
      max_players: maxPlayers,
      current_players: currentPlayers,
      duration_minutes: null,
      num_slots: slots.length || 6,
      winning_slot: null,
      created_by: null,
      status: 'active',
      ends_at: endsAt,
      created_at: new Date().toISOString(),
      qualification_url: null
    };

    // Save to local DB so subsequent lookups work
    try {
      await db.createGamblingEventFromSync(event, slots);
      console.log(`[GamblingEvent] ✅ Reconstructed event #${eventId} from embed: title="${title}", mode=${mode}, fee=${entryFee} ${currency}, players=${currentPlayers}/${maxPlayers}, slots=${slots.length}`);
    } catch (dbErr) {
      console.error(`[GamblingEvent] ⚠️ DB save after reconstruction failed for #${eventId}:`, dbErr.message);
      // Still return the event even if DB save fails — it's in memory
    }

    return event;
  } catch (err) {
    console.error(`[GamblingEvent] Embed reconstruction failed for #${eventId}:`, err.message);
    return null;
  }
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
        .addStringOption(opt => opt.setName('qualification_url').setDescription('URL users must visit to qualify (optional)').setRequired(false))
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
      const qualificationUrl = interaction.options.getString('qualification_url') || null;

      const eventId = await db.createGamblingEvent(
        interaction.guildId, interaction.channelId,
        title, description, mode, prizeAmount, currency, entryFee,
        minPlayers, maxPlayers, durationMinutes, numSlots, interaction.user.id, qualificationUrl
      );

      // Add default slots
      const slotsToUse = DEFAULT_SLOTS.slice(0, numSlots);
      for (let i = 0; i < slotsToUse.length; i++) {
        await db.addGamblingEventSlot(eventId, i + 1, slotsToUse[i].label, slotsToUse[i].color);
      }

      // Build embed
      const embed = createGamblingEventEmbed(eventId, title, description, mode, prizeAmount, currency, entryFee, 0, minPlayers, maxPlayers, durationMinutes, slotsToUse, qualificationUrl);

      // Build slot buttons (with optional qualify button)
      const components = buildSlotButtons(eventId, slotsToUse, qualificationUrl);

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

    const event = await getGamblingEventWithFallback(eventId, interaction);
    if (!event) {
      const hasMsg = !!interaction.message;
      const embedCount = interaction.message?.embeds?.length || 0;
      const embedTitle = interaction.message?.embeds?.[0]?.title || 'none';
      const compRows = interaction.message?.components?.length || 0;
      console.log(`[GamblingEvent] Event #${eventId} not found. msg=${hasMsg}, embeds=${embedCount}, title="${embedTitle}", rows=${compRows}`);
      return interaction.editReply({ content: `❌ Horse race event not found.\n\`Debug: id=${eventId}, msg=${hasMsg}, embeds=${embedCount}, title="${embedTitle}", backendUrl=${!!DCB_BACKEND_URL}\`` });
    }
    console.log(`[GamblingEvent] Event #${eventId} fetched: mode=${event.mode}, currency=${event.currency}, entry_fee=${event.entry_fee}, status=${event.status}`);
    if (event.status !== 'active') {
      return interaction.editReply({ content: '❌ This horse race is no longer active.' });
    }
    if (event.current_players >= event.max_players) {
      return interaction.editReply({ content: '❌ This event is full.' });
    }

    // Qualification gate: if event requires qualification, check it
    if (event.qualification_url) {
      const qual = await db.getGamblingEventQualification(eventId, interaction.user.id);
      if (!qual) {
        return interaction.editReply({
          content: '❌ **Qualification Required!**\n\nYou must qualify before placing a bet.\nClick the **✅ Qualify** button on the event post to get started.'
        });
      }
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

      // Check user has a wallet with private key connected
      const userData = await db.getUser(interaction.user.id);
      if (!userData || !userData.solana_address) {
        return interaction.editReply({
          content: `❌ **Wallet Required!**\n\nThis race requires a **${entryFee} ${event.currency}** entry fee.\n\n➡️ Use \`/user-wallet connect private-key:YOUR_PRIVATE_KEY\` to connect your wallet.\n\nYour address will be auto-derived from the key.`
        });
      }

      // Require private key for pot mode
      if (!userData.wallet_secret) {
        return interaction.editReply({
          content: `❌ **Private Key Required!**\n\nPot-mode horse races require your Solana private key to pay the entry fee.\n\n` +
            `🔑 Use \`/user-wallet connect private-key:YOUR_PRIVATE_KEY\` to save your key.\n\n` +
            `Your wallet address: \`${userData.solana_address}\``
        });
      }

      // Check wallet balance
      let walletBalance = 0;
      let solEntryFee = entryFee;
      let solPrice = null;
      try {
        walletBalance = await crypto.getBalance(userData.solana_address);
        if (event.currency === 'USD') {
          solPrice = await crypto.getSolanaPrice();
          if (solPrice) {
            solEntryFee = entryFee / solPrice;
          }
        }
      } catch (balErr) {
        console.warn('[GamblingEvent] Balance check error:', balErr.message);
      }

      if (walletBalance < solEntryFee) {
        return interaction.editReply({
          content: `❌ **Insufficient Wallet Funds!**\n\n` +
            `💰 Entry fee: **${entryFee} ${event.currency}**${solPrice ? ` (≈ ${solEntryFee.toFixed(6)} SOL)` : ''}\n` +
            `🏦 Wallet balance: **${walletBalance.toFixed(6)} SOL**\n` +
            `📉 Short by: **${(solEntryFee - walletBalance).toFixed(6)} SOL**\n\n` +
            `📥 Fund your wallet: \`${userData.solana_address}\``
        });
      }

      // Build fee display
      let feeDisplay = `${entryFee} ${event.currency}`;
      let solEquivNote = '';
      if (event.currency === 'USD' && solPrice) {
        feeDisplay = `${entryFee} USD`;
        solEquivNote = `\n💱 ≈ **${solEntryFee.toFixed(6)} SOL** @ $${solPrice.toFixed(2)}/SOL`;
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
          `🏦 **Paid to Treasury:** \`${treasuryAddr.slice(0,6)}...${treasuryAddr.slice(-4)}\`\n` +
          `💳 **From Your Wallet:** \`${userData.solana_address.slice(0,6)}...${userData.solana_address.slice(-4)}\` (${walletBalance.toFixed(4)} SOL)\n\n` +
          `By clicking **Confirm Bet & Pay**, the entry fee will be transferred from your wallet to the server treasury as escrow.\n\n` +
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

    const event = await getGamblingEventWithFallback(eventId, interaction);
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

    // 1. Get user + wallet with private key
    const userData = await db.getUser(interaction.user.id);
    if (!userData || !userData.wallet_secret) {
      return interaction.editReply({
        content: '❌ **Private Key Required!** Use `/user-wallet connect private-key:YOUR_KEY` to save your key, then try again.',
        embeds: [], components: []
      });
    }

    // 2. Verify guild treasury wallet exists
    const guildWallet = await getGuildWalletWithFallback(interaction.guildId);
    if (!guildWallet || !guildWallet.wallet_address) {
      return interaction.editReply({
        content: '❌ Server treasury wallet not configured. Admin must set up a wallet first.',
        embeds: [], components: []
      });
    }

    // 3. Calculate SOL amount to transfer
    let solAmount = entryFee;
    let solPrice = null;
    if (event.currency === 'USD') {
      solPrice = await crypto.getSolanaPrice();
      if (!solPrice) {
        return interaction.editReply({
          content: '❌ Unable to fetch SOL price for USD conversion. Try again in a moment.',
          embeds: [], components: []
        });
      }
      solAmount = entryFee / solPrice;
    }

    // 4. Check wallet balance
    let walletBalance = 0;
    try {
      walletBalance = await crypto.getBalance(userData.solana_address);
    } catch (_) {}

    // Need enough for entry fee + ~0.000005 SOL tx fee
    const txFeeBuffer = 0.00001;
    if (walletBalance < solAmount + txFeeBuffer) {
      return interaction.editReply({
        content: `❌ **Insufficient Wallet Funds!**\n\n` +
          `💰 Entry fee: **${solAmount.toFixed(6)} SOL**${solPrice ? ` (${entryFee} USD)` : ''}\n` +
          `🏦 Wallet balance: **${walletBalance.toFixed(6)} SOL**\n` +
          `📉 Short by: **${(solAmount + txFeeBuffer - walletBalance).toFixed(6)} SOL**\n\n` +
          `📥 Fund your wallet: \`${userData.solana_address}\``,
        embeds: [], components: []
      });
    }

    // 5. Execute the actual SOL transfer: user's wallet → treasury
    console.log(`[GamblingConfirm] Transferring ${solAmount.toFixed(6)} SOL from ${userData.solana_address.slice(0,8)}... to ${guildWallet.wallet_address.slice(0,8)}...`);

    const transferResult = await crypto.sendSolFrom(
      userData.wallet_secret,
      guildWallet.wallet_address,
      solAmount
    );

    if (!transferResult.success) {
      console.error(`[GamblingConfirm] ❌ Transfer failed for user ${interaction.user.id} on event #${eventId}:`, transferResult.error);
      return interaction.editReply({
        content: `❌ **Payment Failed!**\n\n${transferResult.error}\n\nYour funds are safe in your wallet. Please try again.`,
        embeds: [], components: []
      });
    }

    console.log(`[GamblingConfirm] ✅ Transfer successful: ${transferResult.signature}`);

    // 6. Save bet as committed with tx signature
    const betAmount = entryFee;
    const userWalletAddress = userData.solana_address;

    await db.joinGamblingEvent(eventId, interaction.guildId, interaction.user.id, slotNumber, betAmount, 'committed', userWalletAddress);
    // Store the entry tx signature
    await db.updateGamblingBetPayment(eventId, interaction.user.id, 'committed', 'entry', transferResult.signature);
    console.log(`[GamblingConfirm] ✅ Bet committed: event #${eventId}, slot ${slotNumber}, user ${interaction.user.id}, amount ${betAmount} ${event.currency}, tx=${transferResult.signature}`);

    syncBetToBackend({ eventId, action: 'bet', userId: interaction.user.id, guildId: interaction.guildId, slotNumber, betAmount, paymentStatus: 'committed', walletAddress: userWalletAddress, entryTxSignature: transferResult.signature });

    // Record the transaction in history
    try {
      await db.recordTransaction(interaction.guildId, userData.solana_address, guildWallet.wallet_address, solAmount, transferResult.signature);
    } catch (_) {}

    const slots = await db.getGamblingEventSlots(eventId);
    const chosenSlot = slots.find(s => s.slot_number === slotNumber);
    const newCount = event.current_players + 1;

    // Build fee display
    let feeDisplay = `${solAmount.toFixed(6)} SOL`;
    if (event.currency === 'USD' && solPrice) {
      feeDisplay = `${entryFee} USD (${solAmount.toFixed(6)} SOL)`;
    }

    const successEmbed = new EmbedBuilder()
      .setColor('#27AE60')
      .setTitle('✅ Bet Confirmed & Entry Fee Paid!')
      .setDescription(
        `🏇 **Horse:** ${chosenSlot?.label || `Horse #${slotNumber}`}\n` +
        `💰 **Entry Fee:** ${feeDisplay}\n` +
        `🏦 **Paid to Treasury:** \`${guildWallet.wallet_address.slice(0,6)}...${guildWallet.wallet_address.slice(-4)}\`\n` +
        `🔗 [View Transaction](https://solscan.io/tx/${transferResult.signature})\n` +
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

  // ---- Button handler: qualify for a gambling event ----
  async handleQualifyButton(interaction) {
    const parts = interaction.customId.split('_');
    const eventId = parseInt(parts[2]);
    const userId = interaction.user.id;

    try {
      const event = await getGamblingEventWithFallback(eventId, interaction);
      if (!event) {
        return interaction.reply({ content: '❌ This horse race event no longer exists.', ephemeral: true });
      }
      if (event.status !== 'active') {
        return interaction.reply({ content: '❌ This horse race has ended.', ephemeral: true });
      }
      if (!event.qualification_url) {
        return interaction.reply({ content: '❌ This event does not require qualification. Click a horse button directly.', ephemeral: true });
      }

      // Check if already qualified
      const existingQual = await db.getGamblingEventQualification(eventId, userId);
      if (existingQual) {
        return interaction.reply({ content: '✅ You are already qualified for this race! Click a horse button to place your bet.', ephemeral: true });
      }

      // Check if event is full
      if (event.current_players >= event.max_players) {
        return interaction.reply({ content: '❌ This horse race is full. No more riders allowed.', ephemeral: true });
      }

      const qualEmbed = new EmbedBuilder()
        .setColor('#3498DB')
        .setTitle('🔗 Qualification Required')
        .setDescription(
          `To qualify for **${event.title}**, you must:\n\n` +
          `1️⃣ **Click the button below** to open the qualification page\n` +
          `2️⃣ **Take a screenshot** proving you visited the page\n` +
          `3️⃣ **Upload your screenshot** in this channel within 5 minutes\n\n` +
          `⏱️ You have **5 minutes** to upload your screenshot.`
        )
        .setFooter({ text: `Horse Race #${eventId} • Qualification Step` })
        .setTimestamp();

      const urlButton = new ButtonBuilder()
        .setLabel('🔗 Open Qualification Page')
        .setStyle(ButtonStyle.Link)
        .setURL(event.qualification_url);

      const qualRow = new ActionRowBuilder().addComponents(urlButton);

      await interaction.reply({ embeds: [qualEmbed], components: [qualRow], ephemeral: true });

      // Collect the user's next message in the same channel with an image attachment
      const channel = interaction.channel;
      if (!channel) return;

      const filter = (msg) => {
        if (msg.author.id !== userId) return false;
        if (msg.attachments.size === 0) return false;
        return msg.attachments.some(att => att.contentType && att.contentType.startsWith('image/'));
      };

      try {
        const collected = await channel.awaitMessages({ filter, max: 1, time: 300000, errors: ['time'] });
        const msg = collected.first();
        const screenshotAttachment = msg.attachments.find(att => att.contentType && att.contentType.startsWith('image/'));

        if (!screenshotAttachment) {
          await interaction.followUp({ content: '❌ No valid screenshot image found. Please click **✅ Qualify** again and upload an image.', ephemeral: true });
          return;
        }

        // Save qualification with temporary URL first
        await db.addGamblingEventQualification(eventId, userId, interaction.user.username, screenshotAttachment.url);

        const successEmbed = new EmbedBuilder()
          .setColor('#2ECC71')
          .setTitle('✅ Qualification Complete!')
          .setDescription(
            `<@${userId}> has been qualified for **${event.title}**!\n\n` +
            `You can now click a horse button to place your bet. 🏇`
          )
          .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
          .setFooter({ text: `Horse Race #${eventId}` })
          .setTimestamp();

        const { AttachmentBuilder } = require('discord.js');
        const screenshotFile = new AttachmentBuilder(screenshotAttachment.url, { name: 'proof.png' });
        successEmbed.setImage('attachment://proof.png');

        const replyMsg = await msg.reply({ embeds: [successEmbed], files: [screenshotFile] });

        // Grab the persistent attachment URL from the bot's reply
        let persistentUrl = screenshotAttachment.url;
        try {
          if (replyMsg.attachments && replyMsg.attachments.size > 0) {
            persistentUrl = replyMsg.attachments.first().url;
          }
        } catch (_) {}

        // Update DB with persistent URL and sync to backend
        await db.addGamblingEventQualification(eventId, userId, interaction.user.username, persistentUrl);
        syncBetToBackend({ eventId, action: 'qualify', userId, screenshotUrl: persistentUrl });

        // Try to delete the user's screenshot message to keep channel clean
        try { await msg.delete(); } catch (_) {}

      } catch (timeoutErr) {
        await interaction.followUp({ content: '⏱️ Qualification timed out. Click **✅ Qualify** again to restart.', ephemeral: true });
      }

    } catch (error) {
      console.error('Gambling event qualify error:', error);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: `❌ Error: ${error.message}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
      }
    }
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
              slots.map(s => ({ label: s.label, color: s.color })),
              event.qualification_url
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
function createGamblingEventEmbed(eventId, title, description, mode, prizeAmount, currency, entryFee, currentPlayers, minPlayers, maxPlayers, durationMinutes, slots, qualificationUrl) {
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
    desc += `• Connect your wallet: \`/user-wallet connect\`\n`;
    desc += `• Fund your betting wallet: \`/user-wallet deposit\`\n`;
    desc += `• Click a horse → confirm & pay → entry fee sent to treasury as escrow 🏇\n`;

    desc += `\n**🏆 Prize Distribution:**\n`;
    desc += `• Total pot = all entry fees held in treasury escrow\n`;
    desc += `• **90%** of pot paid to winner(s) from treasury\n`;
    desc += `• **10%** retained by the house (server treasury)\n`;

    desc += `\n**🔄 Refund Policy:**\n`;
    desc += `• If the race is cancelled, all entries are refunded from treasury\n`;
    desc += `• Solo rider? You race against the house! 🏠\n`;
    desc += `• Refunds sent to your connected payout wallet\n`;
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

  if (qualificationUrl) {
    embed.addFields({ name: '🔗 Qualification Required', value: `[Visit this link](${qualificationUrl}) then click **✅ Qualify**` });
  }

  return embed;
}

// ---- Helper: build horse buttons ----
function buildSlotButtons(eventId, slots, qualificationUrl) {
  const components = [];

  // Add qualify button row if qualification_url is set
  if (qualificationUrl) {
    const qualifyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`gamble_qualify_${eventId}`)
        .setLabel('✅ Qualify')
        .setStyle(ButtonStyle.Success)
    );
    components.push(qualifyRow);
  }

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
