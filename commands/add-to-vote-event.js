const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const db = require('../utils/db');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Add to Vote Event')
    .setType(ApplicationCommandType.Message),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // Only allow server owner
      if (!interaction.guild) {
        return await interaction.editReply({
          content: '❌ This command must be used in a server channel (not a DM).',
          ephemeral: true
        });
      }
      let guild;
      if (typeof interaction.guild.fetch === 'function') {
        guild = await interaction.guild.fetch();
      } else {
        guild = interaction.guild;
      }
      if (!guild) {
        return await interaction.editReply({
          content: '❌ Unable to retrieve server information. Please try again in a server channel.',
          ephemeral: true
        });
      }
      if (interaction.user.id !== guild.ownerId) {
        return await interaction.editReply('❌ Only the server owner can add images to a vote event.');
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
        return await interaction.editReply('❌ No image attachments found in this message.');
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

      await interaction.editReply(`✅ Added ${images.length} image(s) to your vote event selection. Use /vote-event create to start the event.`);
    } catch (err) {
      console.error('Add to Vote Event error:', err);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('❌ An error occurred while adding the image(s) to your vote event selection.');
      } else {
        await interaction.reply({ content: '❌ An error occurred while adding the image(s) to your vote event selection.', ephemeral: true });
      }
    }
  }
};
