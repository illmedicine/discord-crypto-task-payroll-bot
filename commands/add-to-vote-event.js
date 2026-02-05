const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const db = require('../utils/db');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Add to Vote Event')
    .setType(ApplicationCommandType.Message),

  async execute(interaction) {
    // Only allow server owner
    const guild = await interaction.guild.fetch();
    if (interaction.user.id !== guild.ownerId) {
      return interaction.reply({ content: '❌ Only the server owner can add images to a vote event.', ephemeral: true });
    }

    // Only allow messages with image attachments
    const message = await interaction.channel.messages.fetch(interaction.targetId);
    const images = [];
    if (message.attachments && message.attachments.size > 0) {
      message.attachments.forEach(att => {
        if (att.contentType && att.contentType.startsWith('image/')) {
          images.push({ url: att.url, id: att.id });
        }
      });
    }
    if (images.length === 0) {
      return interaction.reply({ content: '❌ No image attachments found in this message.', ephemeral: true });
    }

    // Store selected images in a temp DB table or in-memory (for demo: use global)
    if (!global.voteEventSelections) global.voteEventSelections = {};
    if (!global.voteEventSelections[interaction.user.id]) global.voteEventSelections[interaction.user.id] = [];
    images.forEach(img => {
      // Prevent duplicates
      if (!global.voteEventSelections[interaction.user.id].some(i => i.url === img.url)) {
        global.voteEventSelections[interaction.user.id].push(img);
      }
    });

    await interaction.reply({ content: `✅ Added ${images.length} image(s) to your vote event selection. Use /vote-event create to start the event.`, ephemeral: true });
  }
};
