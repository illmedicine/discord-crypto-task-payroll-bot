const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const db = require('../utils/db');
const crypto = require('../utils/crypto');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vote-event')
    .setDescription('Create and manage voting events')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new voting event (Server Owner only)')
        // All required options first
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Event title')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('description')
            .setDescription('Event description')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option.setName('min_participants')
            .setDescription('Minimum participants to start event')
            .setRequired(true)
            .setMinValue(2)
            .setMaxValue(100)
        )
        .addIntegerOption(option =>
          option.setName('max_participants')
            .setDescription('Maximum participants allowed')
            .setRequired(true)
            .setMinValue(2)
            .setMaxValue(1000)
        )
        .addAttachmentOption(option =>
          option.setName('image1')
            .setDescription('First image for voting')
            .setRequired(true)
        )
        .addAttachmentOption(option =>
          option.setName('image2')
            .setDescription('Second image for voting')
            .setRequired(true)
        )
        // Optional options after required
        .addNumberOption(option =>
          option.setName('prize_amount')
            .setDescription('Prize amount to split among winners (optional)')
            .setRequired(false)
            .setMinValue(0.01)
        )
        .addStringOption(option =>
          option.setName('currency')
            .setDescription('Prize currency')
            .setRequired(false)
            .addChoices(
              { name: 'SOL', value: 'SOL' },
              { name: 'USD', value: 'USD' }
            )
        )
        .addIntegerOption(option =>
          option.setName('duration_minutes')
            .setDescription('Event duration in minutes (optional)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(10080)
        )
        .addAttachmentOption(option =>
          option.setName('image3')
            .setDescription('Third image for voting')
            .setRequired(false)
        )
        .addAttachmentOption(option =>
          option.setName('image4')
            .setDescription('Fourth image for voting')
            .setRequired(false)
        )
        .addAttachmentOption(option =>
          option.setName('image5')
            .setDescription('Fifth image for voting')
            .setRequired(false)
        )
        .addStringOption(option =>
          option.setName('favorite_image_id')
            .setDescription('Your private favorite image ID (kept hidden from participants)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('View active vote events in this server')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('info')
        .setDescription('View detailed info about a specific vote event')
        .addIntegerOption(option =>
          option.setName('event_id')
            .setDescription('Vote event ID to view')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a vote event (Server Owner only)')
        .addIntegerOption(option =>
          option.setName('event_id')
            .setDescription('Vote event ID to remove')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('reason')
            .setDescription('Reason for removing the event')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;

    // ==================== CREATE VOTE EVENT ====================
    if (subcommand === 'create') {
      await interaction.deferReply({ ephemeral: false });

      try {
        // Check permissions - must be server owner
        const guild = await interaction.guild.fetch();
        if (interaction.user.id !== guild.ownerId) {
          return interaction.editReply({
            content: '❌ Only the server owner can create vote events.'
          });
        }

        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const minParticipants = interaction.options.getInteger('min_participants');
        const maxParticipants = interaction.options.getInteger('max_participants');
        const prizeAmount = interaction.options.getNumber('prize_amount');
        const currency = interaction.options.getString('currency') || 'USD';
        const durationMinutes = interaction.options.getInteger('duration_minutes');
        const ownerFavoriteImageId = interaction.options.getString('favorite_image_id');

        // Validate min/max
        if (minParticipants > maxParticipants) {
          return interaction.editReply({
            content: '❌ Minimum participants cannot exceed maximum participants.'
          });
        }

        // Collect images

        const images = [];
        for (let i = 1; i <= 5; i++) {
          const attachment = interaction.options.getAttachment(`image${i}`);
          if (attachment) {
            // Validate it's an image
            if (!attachment.contentType || !attachment.contentType.startsWith('image/')) {
              return interaction.editReply({
                content: `❌ Attachment ${i} must be an image file.`
              });
            }
            images.push({
              url: attachment.url,
              order: i
            });
          }
        }
        // Add images selected via context menu (global.voteEventSelections)
        let orderOffset = images.length;
        if (global.voteEventSelections && global.voteEventSelections[interaction.user.id]) {
          global.voteEventSelections[interaction.user.id].forEach((img, idx) => {
            images.push({
              url: img.url,
              order: orderOffset + idx + 1
            });
          });
          // Clear after use
          delete global.voteEventSelections[interaction.user.id];
        }
        if (images.length < 2) {
          return interaction.editReply({
            content: '❌ At least 2 images are required for a vote event.'
          });
        }

        // Generate image IDs with timestamp and random component to avoid duplicates
        const timestamp = Date.now();
        const imageIds = [];
        for (let i = 0; i < images.length; i++) {
          const imageId = `IMG-${timestamp}-${Math.random().toString(36).substr(2, 9)}-${i + 1}`;
          imageIds.push(imageId);
          images[i].id = imageId;
        }

        // Validate favorite image ID if provided
        if (ownerFavoriteImageId && !imageIds.includes(ownerFavoriteImageId)) {
          return interaction.editReply({
            content: `❌ Invalid favorite image ID. Valid IDs are: ${imageIds.join(', ')}`
          });
        }

        // Create vote event in database
        const eventId = await db.createVoteEvent(
          guildId,
          channelId,
          title,
          description,
          prizeAmount,
          currency,
          minParticipants,
          maxParticipants,
          durationMinutes,
          ownerFavoriteImageId,
          interaction.user.id
        );

        // Add images to database
        for (const img of images) {
          await db.addVoteEventImage(eventId, img.id, img.url, img.order);
        }

        // Calculate end time if duration is set
        const endsAt = durationMinutes ? new Date(Date.now() + (durationMinutes * 60 * 1000)) : null;

        // Create the vote event embed
        const embed = await createVoteEventEmbed({
          id: eventId,
          title,
          description,
          prize_amount: prizeAmount || 0,
          currency,
          min_participants: minParticipants,
          max_participants: maxParticipants,
          current_participants: 0,
          ends_at: endsAt ? endsAt.toISOString() : null,
          created_by: interaction.user.id,
          status: 'active'
        }, images);

        // Create Join button and vote select menu
        const joinButton = new ButtonBuilder()
          .setCustomId(`vote_event_join_${eventId}`)
          .setLabel('🎫 Join Event')
          .setStyle(ButtonStyle.Success);

        const buttonRow = new ActionRowBuilder().addComponents(joinButton);

        // Create vote select menu
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`vote_event_vote_${eventId}`)
          .setPlaceholder('Select your favorite image to vote')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            images.map(img => new StringSelectMenuOptionBuilder()
              .setLabel(`Image ${img.order}`)
              .setValue(img.id)
              .setDescription(`Vote for Image ${img.order}`)
            )
          );

        const selectRow = new ActionRowBuilder().addComponents(selectMenu);

        const reply = await interaction.editReply({
          embeds: [embed],
          components: [buttonRow, selectRow]
        });

        // Store the message ID for future updates
        await db.updateVoteEventMessageId(eventId, reply.id);

        console.log(`[VoteEvent] Created vote event #${eventId}, message ${reply.id}${endsAt ? `, ends at ${endsAt.toISOString()}` : ''}`);

        // Send ephemeral message to owner showing image IDs
        const idsEmbed = new EmbedBuilder()
          .setColor('#9B59B6')
          .setTitle('🔒 Vote Event Created - Image IDs (Private)')
          .setDescription('Here are the image IDs for your reference. These are hidden from participants.')
          .addFields(
            images.map(img => ({ name: `Image ${img.order}`, value: `ID: \`${img.id}\`` }))
          )
          .setFooter({ text: 'Only you can see this message' })
          .setTimestamp();

        await interaction.followUp({
          embeds: [idsEmbed],
          ephemeral: true
        });

      } catch (error) {
        console.error('Vote event create error:', error);
        return interaction.editReply({
          content: `❌ Error creating vote event: ${error.message}`
        });
      }
    }

    // ==================== LIST VOTE EVENTS ====================
    if (subcommand === 'list') {
      await interaction.deferReply({ ephemeral: false });

      try {
        const voteEvents = await db.getActiveVoteEvents(guildId);

        if (!voteEvents || voteEvents.length === 0) {
          return interaction.editReply({
            content: '📋 No active vote events in this server at the moment.'
          });
        }

        let eventList = '';
        for (const event of voteEvents) {
          const endTimestamp = event.ends_at ? Math.floor(new Date(event.ends_at).getTime() / 1000) : null;
          const spotsLeft = event.max_participants - event.current_participants;
          const votesNeeded = event.min_participants - event.current_participants;

          eventList += `**#${event.id}** - ${event.title}\n`;
          if (event.prize_amount > 0) {
            eventList += `🎁 Prize: ${event.prize_amount} ${event.currency}\n`;
          }
          eventList += `👥 Participants: ${event.current_participants}/${event.max_participants}`;
          if (votesNeeded > 0) {
            eventList += ` (Need ${votesNeeded} more to start)`;
          }
          eventList += '\n';
          if (endTimestamp) {
            eventList += `⏱️ **Ends: <t:${endTimestamp}:R>**\n`;
          }
          eventList += '\n';
        }

        const embed = new EmbedBuilder()
          .setColor('#9B59B6')
          .setTitle('🗳️ Active Vote Events')
          .setDescription(eventList)
          .setFooter({ text: 'Use /vote-event info <id> for more details' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Vote event list error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }

    // ==================== VOTE EVENT INFO ====================
    if (subcommand === 'info') {
      await interaction.deferReply({ ephemeral: false });

      try {
        const eventId = interaction.options.getInteger('event_id');
        const event = await db.getVoteEvent(eventId);

        if (!event) {
          return interaction.editReply({
            content: `❌ Vote event #${eventId} not found.`
          });
        }

        if (event.guild_id !== guildId) {
          return interaction.editReply({
            content: '❌ This vote event is not from this server.'
          });
        }

        const images = await db.getVoteEventImages(eventId);
        const embed = await createVoteEventEmbed(event, images);

        // Add join button and vote menu if event is still active
        if (event.status === 'active') {
          const joinButton = new ButtonBuilder()
            .setCustomId(`vote_event_join_${eventId}`)
            .setLabel('🎫 Join Event')
            .setStyle(ButtonStyle.Success);

          const buttonRow = new ActionRowBuilder().addComponents(joinButton);

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`vote_event_vote_${eventId}`)
            .setPlaceholder('Select your favorite image to vote')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
              images.map(img => new StringSelectMenuOptionBuilder()
                .setLabel(`Image ${img.upload_order}`)
                .setValue(img.image_id)
                .setDescription(`Vote for Image ${img.upload_order}`)
              )
            );

          const selectRow = new ActionRowBuilder().addComponents(selectMenu);

          return interaction.editReply({ embeds: [embed], components: [buttonRow, selectRow] });
        }

        return interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Vote event info error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }

    // ==================== REMOVE VOTE EVENT ====================
    if (subcommand === 'remove') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const eventId = interaction.options.getInteger('event_id');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        const event = await db.getVoteEvent(eventId);

        if (!event) {
          return interaction.editReply({
            content: `❌ Vote event #${eventId} not found.`
          });
        }

        if (event.guild_id !== guildId) {
          return interaction.editReply({
            content: '❌ This vote event is not from this server.'
          });
        }

        // Check permission - must be server owner
        const guild = await interaction.guild.fetch();
        if (interaction.user.id !== guild.ownerId) {
          return interaction.editReply({
            content: '❌ Only the server owner can remove vote events.'
          });
        }

        // Get participants before deleting for notification
        const participants = await db.getVoteEventParticipants(eventId);

        // Delete vote event
        await db.deleteVoteEvent(eventId);

        // Notify in channel
        const notificationEmbed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('⚠️ Vote Event Cancelled')
          .setDescription(`Vote Event #${eventId} "${event.title}" has been cancelled.`)
          .addFields(
            { name: '📝 Reason', value: reason },
            { name: '👥 Affected Participants', value: `${participants.length} participants removed` }
          )
          .setTimestamp();

        // Notify affected users
        let notificationSent = false;
        if (participants.length > 0) {
          const mentions = participants.map(p => `<@${p.user_id}>`).join(', ');
          try {
            const channel = await interaction.client.channels.fetch(event.channel_id);
            if (channel) {
              await channel.send({
                content: mentions,
                embeds: [notificationEmbed]
              });
              notificationSent = true;
            }
          } catch (e) {
            console.log('Could not send vote event cancellation notification:', e.message);
          }
        }

        const responseMessage = notificationSent 
          ? `✅ Vote event #${eventId} has been removed. ${participants.length} participant(s) were notified.`
          : `✅ Vote event #${eventId} has been removed. ⚠️ Could not notify ${participants.length} participant(s) - please announce manually.`;
        
        return interaction.editReply({
          content: responseMessage
        });

      } catch (error) {
        console.error('Vote event remove error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }
  },

  // Handle join button
  handleJoinButton: async (interaction) => {
    const parts = interaction.customId.split('_');
    const eventId = parseInt(parts[3]);
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    try {
      // Get vote event
      const event = await db.getVoteEvent(eventId);

      if (!event) {
        return interaction.reply({
          content: '❌ This vote event no longer exists.',
          ephemeral: true
        });
      }

      if (event.status !== 'active') {
        return interaction.reply({
          content: '❌ This vote event has ended.',
          ephemeral: true
        });
      }

      // Check if event is full
      if (event.current_participants >= event.max_participants) {
        return interaction.reply({
          content: '❌ This vote event is full. No more participants allowed.',
          ephemeral: true
        });
      }

      // Check if already joined
      const existingParticipant = await db.getVoteEventParticipant(eventId, userId);
      if (existingParticipant) {
        return interaction.reply({
          content: '❌ You have already joined this vote event.',
          ephemeral: true
        });
      }

      // Check if user has connected wallet
      const userData = await db.getUser(userId);
      if (!userData || !userData.solana_address) {
        return interaction.reply({
          content: '❌ **Wallet Required!**\n\nYou must connect your DisCryptoBank wallet before joining vote events.\n\nUse `/user-wallet connect <your-solana-address>` to connect your wallet, then try again.',
          ephemeral: true
        });
      }

      // Join the event
      await db.joinVoteEvent(eventId, guildId, userId);

      const successEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Successfully Joined Vote Event!')
        .setDescription(`<@${userId}> has joined **${event.title}**!`)
        .addFields(
          { name: 'Event', value: `#${eventId} - ${event.title}`, inline: true },
          { name: 'Participants', value: `${event.current_participants + 1}/${event.max_participants}`, inline: true }
        )
        .setFooter({ text: 'Use the dropdown menu below to cast your vote' })
        .setTimestamp();

      await interaction.reply({ embeds: [successEmbed], ephemeral: false });

    } catch (error) {
      console.error('Vote event join error:', error);
      return interaction.reply({
        content: `❌ Error: ${error.message}`,
        ephemeral: true
      });
    }
  },

  // Handle vote submission
  handleVoteSubmit: async (interaction) => {
    const parts = interaction.customId.split('_');
    const eventId = parseInt(parts[3]);
    const userId = interaction.user.id;
    const votedImageId = interaction.values[0];

    try {
      // Get vote event
      const event = await db.getVoteEvent(eventId);

      if (!event) {
        return interaction.reply({
          content: '❌ This vote event no longer exists.',
          ephemeral: true
        });
      }

      if (event.status !== 'active') {
        return interaction.reply({
          content: '❌ This vote event has ended.',
          ephemeral: true
        });
      }

      // Check if user is a participant
      const participant = await db.getVoteEventParticipant(eventId, userId);
      if (!participant) {
        return interaction.reply({
          content: '❌ You must join the event before voting. Click "🎫 Join Event" first.',
          ephemeral: true
        });
      }

      // Check if already voted
      if (participant.voted_image_id) {
        return interaction.reply({
          content: `❌ You have already voted for Image ID: ${participant.voted_image_id}. You cannot change your vote.`,
          ephemeral: true
        });
      }

      // Validate image ID
      const images = await db.getVoteEventImages(eventId);
      const validImageIds = images.map(img => img.image_id);
      if (!validImageIds.includes(votedImageId)) {
        return interaction.reply({
          content: '❌ Invalid image selection.',
          ephemeral: true
        });
      }

      // Submit vote
      await db.submitVote(eventId, userId, votedImageId);

      // Get the image number for display
      const votedImage = images.find(img => img.image_id === votedImageId);
      const imageNumber = votedImage ? votedImage.upload_order : '?';

      const successEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Vote Recorded!')
        .setDescription(`<@${userId}> has voted for **Image ${imageNumber}**!`)
        .addFields(
          { name: 'Event', value: `#${eventId} - ${event.title}`, inline: true },
          { name: 'Your Vote', value: `Image ${imageNumber}`, inline: true }
        )
        .setFooter({ text: 'Your vote is final and cannot be changed' })
        .setTimestamp();

      await interaction.reply({ embeds: [successEmbed], ephemeral: false });

    } catch (error) {
      console.error('Vote submission error:', error);
      return interaction.reply({
        content: `❌ Error: ${error.message}`,
        ephemeral: true
      });
    }
  }
};

// Helper function to create vote event embed
async function createVoteEventEmbed(event, images) {
  const participants = event.current_participants || 0;
  const spotsLeft = event.max_participants - participants;
  const votesNeeded = Math.max(0, event.min_participants - participants);
  
  const embed = new EmbedBuilder()
    .setColor('#9B59B6')
    .setTitle(`🗳️ ${event.title}`)
    .setDescription(event.description || 'Vote for your favorite image!')
    .addFields(
      { name: '📊 Participants', value: `${participants}/${event.max_participants}`, inline: true },
      { name: '🎯 Min to Start', value: `${event.min_participants}`, inline: true },
      { name: '📍 Status', value: votesNeeded > 0 ? `⏳ Need ${votesNeeded} more` : '✅ Ready', inline: true }
    );

  if (event.prize_amount && event.prize_amount > 0) {
    embed.addFields({ name: '🎁 Prize Pool', value: `${event.prize_amount} ${event.currency} (split among winners)` });
  }

  if (event.ends_at) {
    const endTimestamp = Math.floor(new Date(event.ends_at).getTime() / 1000);
    embed.addFields({ name: '⏱️ Ends', value: `<t:${endTimestamp}:R> (at <t:${endTimestamp}:t>)` });
  }

  embed.addFields({ name: '📋 How to Participate', value: '1. Click "🎫 Join Event" to join\n2. Use the dropdown menu to vote for your favorite image\n3. Wait for results when event ends' });

  // Add images
  if (images && images.length > 0) {
    let imageDesc = '\n**Images:**\n';
    for (const img of images) {
      imageDesc += `**Image ${img.upload_order}** - [View Image](${img.image_url})\n`;
    }
    embed.setDescription((embed.data.description || '') + imageDesc);
    
    // Set the first image as thumbnail
    embed.setThumbnail(images[0].image_url);
  }

  embed.setFooter({ text: `Vote Event #${event.id} • Created by Server Owner` })
    .setTimestamp(new Date(event.created_at));

  return embed;
}
