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

      // Check for active vote events in this channel
      const activeEvents = (await db.getActiveVoteEvents(interaction.guildId)).filter(ev => ev.channel_id === interaction.channelId);

      if (activeEvents.length === 0) {
        // No event: store image and prompt user to run /vote-event create
        if (!global.voteEventSelections) global.voteEventSelections = {};
        global.voteEventSelections[interaction.user.id] = images;
        await interaction.editReply({
          content: `✅ No active vote event found in this channel. The selected image has been saved as slot 1. Please run /vote-event create to start a new event.`,
          ephemeral: true
        });
        return;
      }

      // If events exist, present a select menu to choose which event to add the image to
      const { StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
      const menu = new StringSelectMenuBuilder()
        .setCustomId('add_image_to_vote_event')
        .setPlaceholder('Select a vote event to add this image')
        .addOptions(activeEvents.map(ev => ({
          label: ev.title || `Event #${ev.id}`,
          value: String(ev.id)
        })));
      const row = new ActionRowBuilder().addComponents(menu);
      // Store image in global for follow-up
      if (!global.voteEventSelections) global.voteEventSelections = {};
      global.voteEventSelections[interaction.user.id] = images;
      await interaction.editReply({
        content: `Select which vote event to add the image to:`,
        components: [row],
        ephemeral: true
      });
      // The select menu interaction will be handled in the interactionCreate event in your main bot file
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
