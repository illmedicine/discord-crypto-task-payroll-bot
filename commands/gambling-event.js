const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { encryptSecret } = require('../utils/encryption');
const db = require('../utils/db');
const crypto = require('../utils/crypto');
const { processGamblingEvent, HORSE_PRESETS } = require('../utils/gamblingEventProcessor');
const { getGuildWalletWithFallback } = require('../utils/walletSync');

// Build identifier for deployment verification
const GAMBLING_BUILD = '20260224b';
console.log(`[GamblingEvent] Module loaded (build: ${GAMBLING_BUILD})`);

// ---- Backend config (shared by all fallback functions) ----
const DCB_BACKEND_URL = process.env.DCB_BACKEND_URL || '';
const DCB_INTERNAL_SECRET = process.env.DCB_INTERNAL_SECRET || '';

// ---- Backend fallback: fetch user wallet from backend DB ----
async function fetchUserWalletFromBackend(discordId) {
  if (!DCB_BACKEND_URL) return null;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (DCB_INTERNAL_SECRET) headers['x-dcb-internal-secret'] = DCB_INTERNAL_SECRET;
    const url = `${DCB_BACKEND_URL.replace(/\/$/, '')}/api/internal/user-wallet-lookup/${discordId}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.solana_address) {
        console.log(`[GamblingEvent] Backend user-wallet fallback found address for ${discordId}: ${data.solana_address.slice(0, 8)}... hasKey=${!!data.wallet_secret}`);
        // Sync to local DB so future lookups work
        try { await db.addUser(discordId, data.username || 'unknown', data.solana_address); } catch (_) {}
        // Sync wallet_secret from backend if present (already encrypted with shared ENCRYPTION_KEY)
        if (data.wallet_secret && db.setUserWalletSecret) {
          try { await db.setUserWalletSecret(discordId, data.wallet_secret); } catch (_) {}
        }
        return { solana_address: data.solana_address, username: data.username, wallet_secret: data.wallet_secret || null };
      }
    }
  } catch (err) {
    console.warn(`[GamblingEvent] Backend user-wallet fallback error for ${discordId}:`, err?.message);
  }
  return null;
}

async function getUserWithFallback(discordId) {
  let userData = await db.getUser(discordId);
  // If local user has address AND wallet_secret, no need to check backend
  if (userData && userData.solana_address && userData.wallet_secret) return userData;
  // Local DB missing wallet or missing key — try backend
  const backendUser = await fetchUserWalletFromBackend(discordId);
  if (backendUser) {
    // Re-read from local DB after sync (to pick up any synced wallet_secret)
    const refreshed = await db.getUser(discordId);
    if (refreshed && refreshed.solana_address) return refreshed;
    return backendUser;
  }
  return userData; // null or missing address
}

// ---- Backend fallback: fetch gambling event from backend DB and cache locally ----

async function fetchGamblingEventFromBackend(eventId, attempt = 1) {
  if (!DCB_BACKEND_URL) {
    console.warn(`[GamblingEvent] Backend fallback SKIPPED for #${eventId} — DCB_BACKEND_URL not set`);
    return null;
  }

  // Try public endpoint first (no secret needed), then fall back to internal
  const urls = [
    `${DCB_BACKEND_URL.replace(/\/$/, '')}/api/public/gambling-event/${eventId}`,
    ...(DCB_INTERNAL_SECRET ? [`${DCB_BACKEND_URL.replace(/\/$/, '')}/api/internal/gambling-event/${eventId}`] : [])
  ];

  for (const url of urls) {
    try {
      console.log(`[GamblingEvent] Fetching event #${eventId} (attempt ${attempt}): ${url}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const headers = {};
      if (url.includes('/internal/') && DCB_INTERNAL_SECRET) {
        headers['x-dcb-internal-secret'] = DCB_INTERNAL_SECRET;
      }
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        console.warn(`[GamblingEvent] ${url} returned ${res.status} for event #${eventId}`);
        continue;
      }
      const data = await res.json();
      const { event, slots } = data;
      if (!event) {
        console.warn(`[GamblingEvent] ${url} returned OK but no event data for #${eventId}`);
        continue;
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
      console.error(`[GamblingEvent] Fetch error for #${eventId} at ${url}:`, err.message);
    }
  }

  // Retry once on failure
  if (attempt < 2) {
    await new Promise(r => setTimeout(r, 1000));
    return fetchGamblingEventFromBackend(eventId, attempt + 1);
  }
  return null;
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

  // Fourth fallback: if interaction.message had no embeds, try fetching the message via REST
  if (!event && interaction && interaction.message?.id && interaction.channelId) {
    try {
      console.log(`[GamblingEvent] Trying REST message fetch for channel=${interaction.channelId} msg=${interaction.message.id}`);
      const channel = await interaction.client.channels.fetch(interaction.channelId);
      if (channel) {
        const freshMsg = await channel.messages.fetch(interaction.message.id);
        if (freshMsg && freshMsg.embeds?.length > 0) {
          console.log(`[GamblingEvent] REST fetch got message with ${freshMsg.embeds.length} embeds`);
          // Create a fake interaction-like object with the fresh message
          const fakeInteraction = { message: freshMsg, guildId: interaction.guildId, channelId: interaction.channelId };
          event = await reconstructEventFromEmbed(fakeInteraction, eventId);
        } else {
          console.log(`[GamblingEvent] REST fetch msg has ${freshMsg?.embeds?.length || 0} embeds`);
        }
      }
    } catch (restErr) {
      console.error(`[GamblingEvent] REST message fetch failed:`, restErr.message);
    }
  }

  // Fifth (nuclear) fallback: create a minimal event from the interaction alone
  // This allows bets to be placed even if we can't parse the embed fully
  if (!event && interaction) {
    console.log(`[GamblingEvent] NUCLEAR FALLBACK: creating minimal event #${eventId} from interaction context`);
    try {
      const msg = interaction.message;
      // Count how many gamble_bet buttons exist to determine slot count
      let slotCount = 0;
      const nuclearSlots = [];
      if (msg?.components) {
        for (const row of msg.components) {
          for (const comp of (row.components || [])) {
            if (comp.customId?.startsWith(`gamble_bet_${eventId}_`)) {
              slotCount++;
              const sn = parseInt(comp.customId.split('_').pop());
              nuclearSlots.push({ slot_number: sn, label: comp.label || `Horse #${sn}`, color: '#888' });
            }
          }
        }
      }
      if (slotCount === 0) slotCount = 6; // default
      event = {
        id: eventId,
        guild_id: interaction.guildId,
        channel_id: interaction.channelId,
        message_id: msg?.id || null,
        title: `Event #${eventId}`,
        description: `Event #${eventId}`,
        mode: 'house',
        prize_amount: 0,
        currency: 'SOL',
        entry_fee: 0,
        min_players: 2,
        max_players: 20,
        current_players: 0,
        duration_minutes: null,
        num_slots: slotCount,
        winning_slot: null,
        created_by: null,
        status: 'active',
        ends_at: null,
        created_at: new Date().toISOString(),
        qualification_url: null
      };
      // Try to save
      try {
        await db.createGamblingEventFromSync(event, nuclearSlots);
        console.log(`[GamblingEvent] ✅ Nuclear fallback saved event #${eventId} with ${nuclearSlots.length} slots`);
      } catch (dbErr) {
        console.warn(`[GamblingEvent] Nuclear fallback DB save failed:`, dbErr.message);
      }
    } catch (nuclearErr) {
      console.error(`[GamblingEvent] Nuclear fallback failed:`, nuclearErr.message);
      event = null;
    }
  }

  if (!event) {
    const diag = {
      build: GAMBLING_BUILD,
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
    console.error(`[GamblingEvent] ❌ Event #${eventId} NOT FOUND even with nuclear fallback. Diagnostics:`, JSON.stringify(diag));
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
        .addIntegerOption(opt => opt.setName('max_players').setDescription('Max players').setRequired(true))
        .addStringOption(opt => opt.setName('title').setDescription('Event title (auto-generated if empty)').setRequired(false))
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
        .setDescription('View event details (horse races and poker)')
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
      let title = interaction.options.getString('title');
      let description = interaction.options.getString('description');
      const mode = interaction.options.getString('mode') || 'house';
      const prizeAmount = interaction.options.getNumber('prize_amount') || 0;
      const currency = interaction.options.getString('currency') || 'USD';
      const entryFee = interaction.options.getNumber('entry_fee') || 0;
      const minPlayers = interaction.options.getInteger('min_players') || 1;
      const maxPlayers = interaction.options.getInteger('max_players');
      const durationMinutes = interaction.options.getInteger('duration_minutes') || null;
      const numSlots = Math.min(Math.max(interaction.options.getInteger('num_slots') || 6, 2), 6);
      const qualificationUrl = interaction.options.getString('qualification_url') || null;

      // Auto-generate title & description from last event if not provided
      if (!title || !description) {
        const lastEvent = await db.dbGet('SELECT title, description FROM gambling_events WHERE guild_id = ? ORDER BY id DESC LIMIT 1', [interaction.guildId]);
        if (!title) {
          if (lastEvent?.title) {
            const m = lastEvent.title.match(/^(.+?)\s*#(\d+)\s*$/);
            title = m ? `${m[1]} #${Number(m[2]) + 1}` : `${lastEvent.title} #2`;
          } else {
            title = 'Illy-Kentucky Derby #1';
          }
        }
        if (!description) {
          description = lastEvent?.description || 'Pick your horse and place your bets!';
        }
      }

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

      // If not a horse race, check poker events
      if (!event || event.guild_id !== interaction.guildId) {
        const pokerEvent = await db.getPokerEvent(eventId);
        if (pokerEvent && pokerEvent.guild_id === interaction.guildId) {
          const players = await db.getPokerEventPlayers(eventId);

          const embed = new EmbedBuilder()
            .setColor('#9B59B6')
            .setTitle(`🎰 Poker Event #${pokerEvent.id}`)
            .setDescription(pokerEvent.description || pokerEvent.title)
            .addFields(
              { name: 'Mode', value: pokerEvent.mode === 'pot' ? 'Pot (entry fees pooled)' : 'Free Play', inline: true },
              { name: 'Buy-in', value: pokerEvent.buy_in ? `${pokerEvent.buy_in} ${pokerEvent.currency}` : 'Free', inline: true },
              { name: 'Blinds', value: `${pokerEvent.small_blind}/${pokerEvent.big_blind}`, inline: true },
              { name: 'Starting Chips', value: `${pokerEvent.starting_chips}`, inline: true },
              { name: 'Players', value: `${pokerEvent.current_players}/${pokerEvent.max_players}`, inline: true },
              { name: 'Status', value: pokerEvent.status, inline: true },
              { name: 'Turn Timer', value: `${pokerEvent.turn_timer}s`, inline: true },
              { name: 'Created', value: pokerEvent.created_at || 'Unknown', inline: true },
            )
            .setTimestamp();

          if (players.length > 0) {
            const playerList = players.map(p => {
              const status = p.payment_status === 'paid' ? '✅' : p.payment_status === 'payout_failed' ? '❌' : p.payment_status === 'committed' ? '💰' : '⏳';
              const payout = p.payout_amount ? ` → ${p.payout_amount} ${pokerEvent.currency}` : '';
              return `${status} <@${p.user_id}> (${p.final_chips} chips${payout})`;
            }).join('\n');
            embed.addFields({ name: `Players (${players.length})`, value: playerList.substring(0, 1024) });
          }

          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        return interaction.reply({ content: '❌ Event not found. Check the event ID and make sure it belongs to this server.', ephemeral: true });
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
      console.error(`[GamblingEvent] handleBetButton: Event #${eventId} not found after ALL fallbacks. msg=${hasMsg}, embeds=${embedCount}, title="${embedTitle}", rows=${compRows}`);
      return interaction.editReply({ content: `❌ Horse race event not found (build: ${GAMBLING_BUILD}).\n\`Debug: id=${eventId}, msg=${hasMsg}, embeds=${embedCount}, title="${embedTitle}", rows=${compRows}, backendUrl=${!!DCB_BACKEND_URL}\`` });
    }
    console.log(`[GamblingEvent] Event #${eventId} fetched: mode=${event.mode}, currency=${event.currency}, entry_fee=${event.entry_fee}, status=${event.status}`);
    if (event.status !== 'active') {
      return interaction.editReply({ content: '❌ This horse race is no longer active.' });
    }
    // Double-check fresh status from local DB to catch race conditions
    const freshCheck = await db.getGamblingEvent(eventId);
    if (freshCheck && freshCheck.status !== 'active') {
      console.log(`[GamblingEvent] Race condition caught: event #${eventId} status changed to ${freshCheck.status} during bet flow`);
      return interaction.editReply({ content: '❌ This horse race has already ended.' });
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

      // Check user has a wallet with private key connected (with backend fallback)
      const userData = await getUserWithFallback(interaction.user.id);
      if (!userData || !userData.solana_address) {
        const connectBtn = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`dcb_cw_gamble_${eventId}_${slotNumber}`)
            .setLabel('🔐 Connect Wallet')
            .setStyle(ButtonStyle.Primary)
        );
        return interaction.editReply({
          content: `🔐 **Wallet Required!**\n\nThis race requires a **${entryFee} ${event.currency}** entry fee.\n\n` +
            `Click **Connect Wallet** below to securely add your Phantom private key.\n` +
            `🔒 Your key is **AES-256 encrypted** — not even the bot owner can see it.`,
          components: [connectBtn]
        });
      }

      // Resolve private key: check users table first, then fall back to guild wallet if addresses match
      const earlyGuildWallet = await getGuildWalletWithFallback(interaction.guildId);
      let playerSecret = userData.wallet_secret || null;
      if (!playerSecret && earlyGuildWallet?.wallet_secret && userData.solana_address === earlyGuildWallet.wallet_address) {
        console.log(`[GamblingEvent] User ${interaction.user.id} address matches treasury — using guild wallet key`);
        playerSecret = earlyGuildWallet.wallet_secret;
      }
      if (!playerSecret) {
        const connectBtn = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`dcb_cw_gamble_${eventId}_${slotNumber}`)
            .setLabel('🔐 Connect Wallet')
            .setStyle(ButtonStyle.Primary)
        );
        return interaction.editReply({
          content: `🔐 **Private Key Required!**\n\nPot-mode horse races need your Solana private key to pay the entry fee.\n\n` +
            `Click **Connect Wallet** below to securely add your Phantom private key.\n` +
            `🔒 Your key is **AES-256 encrypted** — not even the bot owner can see it.\n\n` +
            `Your wallet address: \`${userData.solana_address}\``,
          components: [connectBtn]
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
    if (!event) return interaction.editReply({ content: `❌ Horse race event not found (build: ${GAMBLING_BUILD}, handler: confirm).`, embeds: [], components: [] });
    if (event.status !== 'active') return interaction.editReply({ content: '❌ This horse race is no longer active.', embeds: [], components: [] });
    // Fresh DB re-check to catch race conditions
    const freshCheck = await db.getGamblingEvent(eventId);
    if (freshCheck && freshCheck.status !== 'active') {
      console.log(`[GamblingConfirm] Race condition caught: event #${eventId} status=${freshCheck.status}`);
      return interaction.editReply({ content: '❌ This horse race has already ended.', embeds: [], components: [] });
    }
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

    // 1. Get user + wallet with private key (with backend fallback)
    const userData = await getUserWithFallback(interaction.user.id);

    // 2. Verify guild treasury wallet exists
    const guildWallet = await getGuildWalletWithFallback(interaction.guildId);
    if (!guildWallet || !guildWallet.wallet_address) {
      return interaction.editReply({
        content: '❌ Server treasury wallet not configured. Admin must set up a wallet first.',
        embeds: [], components: []
      });
    }

    // Resolve private key: users table first, then guild wallet fallback if addresses match
    let playerSecret = userData?.wallet_secret || null;
    if (!playerSecret && userData?.solana_address && guildWallet.wallet_secret && userData.solana_address === guildWallet.wallet_address) {
      console.log(`[GamblingConfirm] User ${interaction.user.id} address matches treasury — using guild wallet key`);
      playerSecret = guildWallet.wallet_secret;
    }
    if (!userData || !playerSecret) {
      return interaction.editReply({
        content: '❌ **Private Key Required!**\n\n🌐 **Recommended:** Add your key securely at the **DCB Event Manager** web app → Profile → 🔐 Wallet & Security\n🤖 **Or via Discord:** `/user-wallet connect private-key:YOUR_KEY`',
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
      playerSecret,
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

  // ---- Button handler: Connect Wallet (opens modal for private key entry) ----
  async handleConnectWalletButton(interaction) {
    // customId format: dcb_cw_gamble_{eventId}_{slotNumber}
    const parts = interaction.customId.split('_');
    const eventId = parts[3];
    const slotNumber = parts[4];

    const modal = new ModalBuilder()
      .setCustomId(`dcb_wm_gamble_${eventId}_${slotNumber}`)
      .setTitle('🔐 Connect Your Wallet');

    const keyInput = new TextInputBuilder()
      .setCustomId('private_key')
      .setLabel('Phantom Wallet Private Key (base58)')
      .setPlaceholder('Paste your private key from Phantom → Settings → Security → Export Private Key')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(40)
      .setMaxLength(120);

    modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
    await interaction.showModal(modal);
  },

  // ---- Modal handler: Process wallet private key submission ----
  async handleWalletModal(interaction) {
    // customId format: dcb_wm_gamble_{eventId}_{slotNumber}
    const parts = interaction.customId.split('_');
    const eventId = Number(parts[3]);
    const slotNumber = Number(parts[4]);

    await interaction.deferReply({ ephemeral: true });

    const privateKey = interaction.fields.getTextInputValue('private_key').trim().replace(/[^\x20-\x7E]/g, '');

    // 1. Validate key format
    let keypair;
    try {
      keypair = crypto.getKeypairFromSecret(privateKey);
    } catch (_) {}
    if (!keypair) {
      return interaction.editReply({
        content: '❌ **Invalid Private Key!**\n\n' +
          'The key you entered is not a valid Solana private key.\n' +
          'Make sure you\'re pasting your **private key** (not your wallet address).\n\n' +
          '💡 **In Phantom:** Settings → Security & Privacy → Export Private Key\n' +
          '💡 The key should be a long base58 string (≈88 characters)'
      });
    }

    const derivedAddress = keypair.publicKey.toBase58();
    console.log(`[GamblingEvent] Wallet connected via modal: user=${interaction.user.id}, addr=${derivedAddress.slice(0,8)}...`);

    // 2. Store address + encrypted private key
    await db.addUser(interaction.user.id, interaction.user.username, derivedAddress);
    await db.setUserWalletSecret(interaction.user.id, privateKey);

    // 3. Sync to backend
    try {
      const DCB_BACKEND_URL_VAL = process.env.DCB_BACKEND_URL || '';
      const DCB_INTERNAL_SECRET_VAL = process.env.DCB_INTERNAL_SECRET || '';
      if (DCB_BACKEND_URL_VAL && DCB_INTERNAL_SECRET_VAL) {
        const encryptedKey = encryptSecret(privateKey);
        await fetch(`${DCB_BACKEND_URL_VAL.replace(/\/$/, '')}/api/internal/user-wallet-key-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-dcb-internal-secret': DCB_INTERNAL_SECRET_VAL },
          body: JSON.stringify({ discordId: interaction.user.id, encryptedKey })
        });
        await fetch(`${DCB_BACKEND_URL_VAL.replace(/\/$/, '')}/api/internal/user-wallet-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-dcb-internal-secret': DCB_INTERNAL_SECRET_VAL },
          body: JSON.stringify({ discordId: interaction.user.id, solanaAddress: derivedAddress, username: interaction.user.username })
        });
        console.log(`[GamblingEvent] Backend wallet sync OK for ${interaction.user.id}`);
      }
    } catch (syncErr) {
      console.error('[GamblingEvent] Backend wallet sync error:', syncErr?.message);
    }

    // 4. Check if event is still active
    const event = await getGamblingEventWithFallback(eventId, interaction);
    if (!event || event.status !== 'active') {
      return interaction.editReply({
        content: '✅ **Wallet Connected!** 🔐\n\n' +
          `🏦 Address: \`${derivedAddress.slice(0,6)}...${derivedAddress.slice(-4)}\`\n` +
          `🔒 Private key encrypted & saved securely.\n\n` +
          `⚠️ This horse race is no longer active, but your wallet is ready for future events!`
      });
    }

    // Check if user already bet
    const existing = await db.getGamblingEventBet(eventId, interaction.user.id);
    if (existing) {
      return interaction.editReply({
        content: '✅ **Wallet Connected!** 🔐\n\n' +
          `🏦 Address: \`${derivedAddress.slice(0,6)}...${derivedAddress.slice(-4)}\`\n` +
          `🔒 Private key encrypted & saved securely.\n\n` +
          `You already have a bet placed in this race!`
      });
    }

    // 5. Check wallet balance
    const entryFee = event.entry_fee || 0;
    let solEntryFee = entryFee;
    let solPrice = null;
    let walletBalance = 0;
    try {
      walletBalance = await crypto.getBalance(derivedAddress);
      if (event.currency === 'USD') {
        solPrice = await crypto.getSolanaPrice();
        if (solPrice) solEntryFee = entryFee / solPrice;
      }
    } catch (balErr) {
      console.warn('[GamblingEvent] Modal balance check error:', balErr.message);
    }

    if (walletBalance < solEntryFee) {
      return interaction.editReply({
        content: '✅ **Wallet Connected!** 🔐\n\n' +
          `🏦 Address: \`${derivedAddress.slice(0,6)}...${derivedAddress.slice(-4)}\`\n` +
          `💰 Balance: **${walletBalance.toFixed(6)} SOL**\n\n` +
          `❌ **Insufficient funds** for the **${entryFee} ${event.currency}** entry fee.\n` +
          `📥 Fund your wallet: \`${derivedAddress}\`\n\n` +
          `Once funded, click the 🏇 horse button again to enter!`
      });
    }

    // 6. Balance is sufficient — show confirmation embed (seamless flow — no re-click needed)
    const slots = await db.getGamblingEventSlots(eventId);
    const chosenSlot = slots.find(s => s.slot_number === slotNumber);
    const horseName = chosenSlot?.label || `Horse #${slotNumber}`;

    let feeDisplay = `${entryFee} ${event.currency}`;
    let solEquivNote = '';
    if (event.currency === 'USD' && solPrice) {
      feeDisplay = `${entryFee} USD`;
      solEquivNote = `\n💱 ≈ **${solEntryFee.toFixed(6)} SOL** @ $${solPrice.toFixed(2)}/SOL`;
    }

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
      .setColor('#14F195')
      .setTitle('✅ Wallet Connected — Confirm Your Bet')
      .setDescription(
        `🔐 **Wallet saved securely!**\n\n` +
        `🏇 **Horse:** ${horseName}\n` +
        `💰 **Entry Fee:** ${feeDisplay}${solEquivNote}\n` +
        `🏦 **Paid to Treasury:** \`${treasuryAddr.slice(0,6)}...${treasuryAddr.slice(-4)}\`\n` +
        `💳 **From Your Wallet:** \`${derivedAddress.slice(0,6)}...${derivedAddress.slice(-4)}\` (${walletBalance.toFixed(4)} SOL)\n\n` +
        `By clicking **Confirm Bet & Pay**, the entry fee will be transferred from your wallet to the server treasury as escrow.\n\n` +
        `⚠️ Entry fees are non-refundable unless the race is cancelled.`
      )
      .setFooter({ text: 'DisCryptoBank • Horse Race Entry' })
      .setTimestamp();

    return interaction.editReply({ embeds: [confirmEmbed], components: [confirmButton] });
  },

  // ---- Button handler: qualify for a gambling event ----
  async handleQualifyButton(interaction) {
    const parts = interaction.customId.split('_');
    const eventId = parseInt(parts[2]);
    const userId = interaction.user.id;

    try {
      const event = await getGamblingEventWithFallback(eventId, interaction);
      if (!event) {
        return interaction.reply({ content: `❌ This horse race event no longer exists (build: ${GAMBLING_BUILD}).`, ephemeral: true });
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
