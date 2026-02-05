const { SlashCommandBuilder } = require('discord.js');
const db = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event-remove')
    .setDescription('Remove a voting event (Owner only)')
    .addIntegerOption(opt => opt.setName('event_id').setDescription('Event ID to remove').setRequired(true)),
  async execute(interaction) {
    if (interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({ content: 'Only the server owner can remove events.', ephemeral: true });
    }
    const eventId = interaction.options.getInteger('event_id');
    const event = await db.getVoteEvent(eventId);
    if (!event || event.guild_id !== interaction.guild.id) {
      return interaction.reply({ content: 'Event not found or not in this server.', ephemeral: true });
    }
    await db.deleteVoteEvent(eventId);
    return interaction.reply({ content: `Event #${eventId} has been removed.`, ephemeral: false });
  },
};
