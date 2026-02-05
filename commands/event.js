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
    .setDescription('Create a photo-based voting event with crypto rewards! (Owner only)')
    // All required options first
    .addStringOption(opt => opt.setName('title').setDescription('Event title').setRequired(true))
    .addNumberOption(opt => opt.setName('prize').setDescription('Total prize pool (e.g. 1.5)').setRequired(true))
    .addIntegerOption(opt => opt.setName('slots').setDescription('Max participants').setRequired(true))
    .addAttachmentOption(opt => opt.setName('image1').setDescription('First image').setRequired(true))
    .addAttachmentOption(opt => opt.setName('image2').setDescription('Second image').setRequired(true))
    .addAttachmentOption(opt => opt.setName('image3').setDescription('Third image').setRequired(true))
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
    const images = getImageAttachments(interaction);
    if (images.length !== 3) {
      return interaction.reply({ content: 'You must upload exactly 3 images.', ephemeral: true });
    }
    // Prompt owner to select the winning image privately
    const selectMenu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('event_winner_select')
        .setPlaceholder('Select the winning image (private)')
        .addOptions([
          { label: 'Image 1', value: '0' },
          { label: 'Image 2', value: '1' },
          { label: 'Image 3', value: '2' },
        ])
    );
    await interaction.reply({ content: 'Select the winning image (this is private):', components: [selectMenu], ephemeral: true });
    // Wait for selection
    const filter = i => i.user.id === interaction.user.id && i.customId === 'event_winner_select';
    const collected = await interaction.channel.awaitMessageComponent({ filter, time: 60000 });
    const winnerIdx = parseInt(collected.values[0], 10);
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
      images[winnerIdx].id,
      interaction.user.id
    );
    // Store images in DB
    for (let i = 0; i < images.length; i++) {
      await db.addVoteEventImage(eventId, images[i].id, images[i].url, i + 1);
    }
    // Announce event
    const eventMsg = await interaction.channel.send({
      content: `🗳️ **${title}**\n${description}\nPrize Pool: ${prize} SOL\nSlots: ${slots}\nReact below to join!`,
      files: images.map(img => img.url),
    });
    await db.updateVoteEventMessageId(eventId, eventMsg.id);
    // Add join button
    const joinRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`event_join_${eventId}`).setLabel('Join Event').setStyle(ButtonStyle.Primary)
    );
    await eventMsg.edit({ components: [joinRow] });
  },
};
