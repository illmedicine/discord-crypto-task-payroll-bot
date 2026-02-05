const { SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const db = require('../utils/db');
const crypto = require('../utils/crypto');

// Helper: get image attachments from interaction
function getImageAttachments(interaction) {
  return interaction.options.getAttachment('image1') && interaction.options.getAttachment('image2') && interaction.options.getAttachment('image3')
    ? [interaction.options.getAttachment('image1'), interaction.options.getAttachment('image2'), interaction.options.getAttachment('image3')]
    : [];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event-create')
    .setDescription('Create a photo/video voting event with crypto rewards! (Owner only)')
    .addStringOption(opt => opt.setName('title').setDescription('Event title').setRequired(true))
    .addNumberOption(opt => opt.setName('prize').setDescription('Total prize pool (e.g. 1.5)').setRequired(true))
    .addIntegerOption(opt => opt.setName('slots').setDescription('Max participants').setRequired(true))
    .addStringOption(opt => opt.setName('description').setDescription('Event description').setRequired(false)),
    // Optional options after required
    .addStringOption(opt => opt.setName('description').setDescription('Event description').setRequired(false)),
  async execute(interaction) {
    // Only allow server owner
    if (interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({ content: 'Only the server owner can create events.', ephemeral: true });
    }
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description') || '';
    const prize = interaction.options.getNumber('prize');
    const slots = interaction.options.getInteger('slots');

    // Fetch recent messages in the channel for media attachments and Tumblr2Discord IDs
    const fetchedMessages = await interaction.channel.messages.fetch({ limit: 50 });
    const mediaOptions = [];
    fetchedMessages.forEach(msg => {
      // Check for attachments (images/videos)
      msg.attachments.forEach(att => {
        // Optionally filter by type (image/video)
        if (att.contentType && (att.contentType.startsWith('image/') || att.contentType.startsWith('video/'))) {
          // Check for Tumblr2Discord ID in message content
          let t2dId = null;
          const match = msg.content.match(/Tumblr2Discord ID: ([A-Za-z0-9_-]+)/);
          if (match) t2dId = match[1];
          mediaOptions.push({
            label: `${att.name || att.id}${t2dId ? ` (T2D: ${t2dId})` : ''}`,
            value: att.id,
            description: t2dId ? `Tumblr2Discord ID: ${t2dId}` : undefined,
            url: att.url,
            type: att.contentType
          });
        }
      });
    });

    if (mediaOptions.length < 3) {
      return interaction.reply({ content: 'Not enough images/videos found in this channel. Please post at least 3 media files first.', ephemeral: true });
    }

    // Prompt owner to select 3 images/videos for the event
    const selectMenu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('event_media_select')
        .setPlaceholder('Select 3 images/videos for the event')
        .setMinValues(3)
        .setMaxValues(3)
        .addOptions(mediaOptions.map(opt => ({ label: opt.label, value: opt.value, description: opt.description })))
    );
    await interaction.reply({ content: 'Select 3 images/videos for the event:', components: [selectMenu], ephemeral: true });
    // Wait for selection
    const filter = i => i.user.id === interaction.user.id && i.customId === 'event_media_select';
    const collected = await interaction.channel.awaitMessageComponent({ filter, time: 120000 });
    const selectedIds = collected.values;
    // Map selected IDs to media objects
    const selectedMedia = selectedIds.map(id => mediaOptions.find(opt => opt.value === id));

    // Prompt owner to select the winning image/video
    const winnerMenu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('event_winner_select')
        .setPlaceholder('Select the winning image/video (private)')
        .addOptions(selectedMedia.map((media, idx) => ({ label: `Media ${idx + 1}`, value: media.value, description: media.label })))
    );
    await collected.reply({ content: 'Select the winning image/video (this is private):', components: [winnerMenu], ephemeral: true });
    const winnerCollected = await interaction.channel.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id && i.customId === 'event_winner_select', time: 60000 });
    const winnerId = winnerCollected.values[0];

    // Create event in DB
    const eventId = await db.createVoteEvent(
      interaction.guild.id,
      interaction.channel.id,
      title,
      description,
      prize,
      'SOL',
      slots,
      slots,
      null,
      winnerId,
      interaction.user.id
    );
    // Store selected media in DB
    for (let i = 0; i < selectedMedia.length; i++) {
      await db.addVoteEventImage(eventId, selectedMedia[i].value, selectedMedia[i].url, i + 1);
    }
    // Announce event
    const eventMsg = await interaction.channel.send({
      content: `🗳️ **${title}**\n${description}\nPrize Pool: ${prize} SOL\nSlots: ${slots}\nReact below to join!`,
      files: selectedMedia.map(media => media.url),
    });
    await db.updateVoteEventMessageId(eventId, eventMsg.id);
    // Add join button
    const joinRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`event_join_${eventId}`).setLabel('Join Event').setStyle(ButtonStyle.Primary)
    );
    await eventMsg.edit({ components: [joinRow] });
  },
  },
};
