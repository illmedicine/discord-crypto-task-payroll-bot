const { SlashCommandBuilder } = require('discord.js');
const db = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event-stats')
    .setDescription('Show all open voting events and stats for this server'),
  async execute(interaction) {
    const events = await db.getActiveVoteEvents(interaction.guild.id);
    if (!events.length) {
      return interaction.reply({ content: 'There are no open voting events in this server.', ephemeral: true });
    }
    let msg = `🗳️ **Open Voting Events:**\n`;
    for (const event of events) {
      const participants = await db.getVoteEventParticipants(event.id);
      msg += `\n**#${event.id}: ${event.title}**\nSlots: ${participants.length}/${event.max_participants}\nPrize: ${event.prize_amount} ${event.currency}\nStatus: ${event.status}\n`;
    }
    return interaction.reply({ content: msg, ephemeral: false });
  },
};
