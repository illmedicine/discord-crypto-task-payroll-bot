const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../utils/db');
const { processGamblingEvent } = require('../utils/gamblingEventProcessor');

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

    const event = await db.getGamblingEvent(eventId);
    if (!event) {
      return interaction.reply({ content: '❌ Gambling event not found.', ephemeral: true });
    }
    if (event.status !== 'active') {
      return interaction.reply({ content: '❌ This gambling event is no longer active.', ephemeral: true });
    }
    if (event.current_players >= event.max_players) {
      return interaction.reply({ content: '❌ This event is full.', ephemeral: true });
    }

    // Check if user already bet
    const existing = await db.getGamblingEventBet(eventId, interaction.user.id);
    if (existing) {
      const slots = await db.getGamblingEventSlots(eventId);
      const chosen = slots.find(s => s.slot_number === existing.chosen_slot);
      return interaction.reply({
        content: `❌ You already placed a bet on **${chosen?.label || `Slot #${existing.chosen_slot}`}**. One bet per player!`,
        ephemeral: true
      });
    }

    // Check wallet if pot mode with entry fee
    if (event.mode === 'pot' && event.entry_fee > 0) {
      const userData = await db.getUser(interaction.user.id);
      if (!userData || !userData.solana_address) {
        return interaction.reply({
          content: '❌ You need to register a wallet first! Use `/wallet set` to add your Solana address.',
          ephemeral: true
        });
      }
    }

    const betAmount = event.mode === 'pot' ? (event.entry_fee || 0) : 0;

    await db.joinGamblingEvent(eventId, interaction.guildId, interaction.user.id, slotNumber, betAmount);

    const slots = await db.getGamblingEventSlots(eventId);
    const chosenSlot = slots.find(s => s.slot_number === slotNumber);
    const newCount = event.current_players + 1;

    await interaction.reply({
      content: `🎰 **Bet placed!** You bet on **${chosenSlot?.label || `Slot #${slotNumber}`}**.\nPlayers: ${newCount}/${event.max_players}`,
      ephemeral: true
    });

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

// ---- Helper: build embed ----
function createGamblingEventEmbed(eventId, title, description, mode, prizeAmount, currency, entryFee, currentPlayers, minPlayers, maxPlayers, durationMinutes, slots) {
  const modeLabel = mode === 'pot' ? '🏦 Pot Split' : '🏠 House-funded';
  const prizeInfo = mode === 'pot'
    ? `${entryFee} ${currency} entry → pot split`
    : `${prizeAmount} ${currency}`;

  const slotList = slots.map((s, i) => `${i + 1}. ${s.label}`).join('\n');

  const embed = new EmbedBuilder()
    .setColor('#E74C3C')
    .setTitle(`🎰 DCB Gambling Event: ${title}`)
    .setDescription(
      (description || 'Place your bets on a slot!') +
      '\n\n**How it works:**\n' +
      '1️⃣ Click a slot button to place your bet\n' +
      '2️⃣ The wheel spins when max players join or time runs out\n' +
      '3️⃣ If your slot wins — you get paid instantly! 💰'
    )
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
