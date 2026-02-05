const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../utils/db');
const crypto = require('../utils/crypto');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('contest')
    .setDescription('Create and manage giveaway contests')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new giveaway contest')
        // All required options first
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Contest title')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('description')
            .setDescription('Contest description and requirements')
            .setRequired(true)
        )
        .addNumberOption(option =>
          option.setName('prize_amount')
            .setDescription('Total prize amount to distribute')
            .setRequired(true)
            .setMinValue(0.01)
        )
        .addStringOption(option =>
          option.setName('currency')
            .setDescription('Prize currency')
            .setRequired(true)
            .addChoices(
              { name: 'SOL', value: 'SOL' },
              { name: 'USD', value: 'USD' }
            )
        )
        .addIntegerOption(option =>
          option.setName('winners')
            .setDescription('Number of winners')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
        .addIntegerOption(option =>
          option.setName('max_entries')
            .setDescription('Maximum number of participants')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10000)
        )
        .addIntegerOption(option =>
          option.setName('duration_hours')
            .setDescription('Contest duration in hours')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(720)
        )
        .addStringOption(option =>
          option.setName('reference_url')
            .setDescription('URL participants must visit and screenshot for entry')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('View active contests in this server')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('info')
        .setDescription('View detailed info about a specific contest')
        .addIntegerOption(option =>
          option.setName('contest_id')
            .setDescription('Contest ID to view')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a contest and all entries (creator/admin only)')
        .addIntegerOption(option =>
          option.setName('contest_id')
            .setDescription('Contest ID to remove')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('reason')
            .setDescription('Reason for removing the contest')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove-participant')
        .setDescription('Remove a participant from a contest (creator/admin only)')
        .addIntegerOption(option =>
          option.setName('contest_id')
            .setDescription('Contest ID')
            .setRequired(true)
        )
        .addUserOption(option =>
          option.setName('user')
            .setDescription('User to remove from contest')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('reason')
            .setDescription('Reason for removal')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('rules')
        .setDescription('View contest rules and entry instructions')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('refresh')
        .setDescription('Refresh a contest message with updated info')
        .addIntegerOption(option =>
          option.setName('contest_id')
            .setDescription('Contest ID to refresh')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;

    // ==================== CREATE CONTEST ====================
    if (subcommand === 'create') {
      await interaction.deferReply({ ephemeral: false });

      try {
        // Check permissions - must be server owner
        const guild = await interaction.guild.fetch();
        if (interaction.user.id !== guild.ownerId) {
          return interaction.editReply({
            content: '❌ Only the server owner can create contests.'
          });
        }

        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const prizeAmount = interaction.options.getNumber('prize_amount');
        const currency = interaction.options.getString('currency');
        const numWinners = interaction.options.getInteger('winners');
        const maxEntries = interaction.options.getInteger('max_entries');
        const durationHours = interaction.options.getInteger('duration_hours');
        const referenceUrl = interaction.options.getString('reference_url');

        // Validate winners vs entries
        if (numWinners > maxEntries) {
          return interaction.editReply({
            content: '❌ Number of winners cannot exceed maximum entries.'
          });
        }

        // Calculate prize per winner
        const prizePerWinner = prizeAmount / numWinners;

        // Calculate end time
        const endsAt = new Date(Date.now() + (durationHours * 60 * 60 * 1000));

        // Create contest in database
        const contestId = await db.createContest(
          guildId,
          channelId,
          title,
          description,
          prizeAmount,
          currency,
          numWinners,
          maxEntries,
          durationHours,
          referenceUrl,
          interaction.user.id
        );

        // Create the contest embed
        const embed = createContestEmbed({
          id: contestId,
          title,
          description,
          prize_amount: prizeAmount,
          currency,
          num_winners: numWinners,
          max_entries: maxEntries,
          current_entries: 0,
          reference_url: referenceUrl,
          ends_at: endsAt.toISOString(),
          created_by: interaction.user.id,
          status: 'active'
        });

        // Create Enter Contest button
        const enterButton = new ButtonBuilder()
          .setCustomId(`contest_enter_${contestId}`)
          .setLabel('🎉 Enter Contest')
          .setStyle(ButtonStyle.Success);

        const buttonRow = new ActionRowBuilder().addComponents(enterButton);

        const reply = await interaction.editReply({
          embeds: [embed],
          components: [buttonRow]
        });

        // Store the message ID for future updates/refresh
        await db.updateContestMessageId(contestId, reply.id);

        // Schedule contest end (will be handled by a checker interval)
        console.log(`[Contest] Created contest #${contestId}, message ${reply.id}, ends at ${endsAt.toISOString()}`);

      } catch (error) {
        console.error('Contest create error:', error);
        return interaction.editReply({
          content: `❌ Error creating contest: ${error.message}`
        });
      }
    }

    // ==================== LIST CONTESTS ====================
    if (subcommand === 'list') {
      await interaction.deferReply({ ephemeral: false });

      try {
        const contests = await db.getActiveContests(guildId);

        if (!contests || contests.length === 0) {
          return interaction.editReply({
            content: '📋 No active contests in this server at the moment.'
          });
        }

        let contestList = '';
        for (const contest of contests) {
          const endTimestamp = Math.floor(new Date(contest.ends_at).getTime() / 1000);
          const spotsLeft = contest.max_entries - contest.current_entries;
          const prizePerWinner = (contest.prize_amount / contest.num_winners).toFixed(2);

          contestList += `**#${contest.id}** - ${contest.title}\n`;
          contestList += `🎁 Prize: ${contest.prize_amount} ${contest.currency} (${prizePerWinner} per winner)\n`;
          contestList += `👥 Entries: ${contest.current_entries}/${contest.max_entries} | 🏆 Winners: ${contest.num_winners}\n`;
          contestList += `⏱️ **Ends: <t:${endTimestamp}:R>** (at <t:${endTimestamp}:t>)\n`;
          contestList += `📎 [Reference URL](${contest.reference_url})\n\n`;
        }

        const embed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('🎉 Active Contests')
          .setDescription(contestList)
          .setFooter({ text: 'Use /contest info <id> for more details • Countdowns update live!' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Contest list error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }

    // ==================== CONTEST INFO ====================
    if (subcommand === 'info') {
      await interaction.deferReply({ ephemeral: false });

      try {
        const contestId = interaction.options.getInteger('contest_id');
        const contest = await db.getContest(contestId);

        if (!contest) {
          return interaction.editReply({
            content: `❌ Contest #${contestId} not found.`
          });
        }

        if (contest.guild_id !== guildId) {
          return interaction.editReply({
            content: '❌ This contest is not from this server.'
          });
        }

        const embed = createContestEmbed(contest);

        // Add enter button if contest is still active
        if (contest.status === 'active') {
          const enterButton = new ButtonBuilder()
            .setCustomId(`contest_enter_${contestId}`)
            .setLabel('🎉 Enter Contest')
            .setStyle(ButtonStyle.Success);

          const buttonRow = new ActionRowBuilder().addComponents(enterButton);
          return interaction.editReply({ embeds: [embed], components: [buttonRow] });
        }

        return interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Contest info error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }

    // ==================== REMOVE CONTEST ====================
    if (subcommand === 'remove') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const contestId = interaction.options.getInteger('contest_id');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        const contest = await db.getContest(contestId);

        if (!contest) {
          return interaction.editReply({
            content: `❌ Contest #${contestId} not found.`
          });
        }

        if (contest.guild_id !== guildId) {
          return interaction.editReply({
            content: '❌ This contest is not from this server.'
          });
        }

        // Check permission - must be contest creator or server admin
        const isCreator = contest.created_by === interaction.user.id;
        const isAdmin = interaction.member.permissions.has('ManageGuild');

        if (!isCreator && !isAdmin) {
          return interaction.editReply({
            content: '❌ Only the contest creator or server administrators can remove this contest.'
          });
        }

        // Get entries before deleting for notification
        const entries = await db.getContestEntries(contestId);

        // Delete contest
        await db.deleteContest(contestId);

        // Notify in channel
        const notificationEmbed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('⚠️ Contest Cancelled')
          .setDescription(`Contest #${contestId} "${contest.title}" has been cancelled.`)
          .addFields(
            { name: '📝 Reason', value: reason },
            { name: '👥 Affected Participants', value: `${entries.length} entries removed` },
            { name: '🎁 Prize', value: `${contest.prize_amount} ${contest.currency}` }
          )
          .setTimestamp();

        // Notify affected users
        if (entries.length > 0) {
          const mentions = entries.map(e => `<@${e.user_id}>`).join(', ');
          try {
            const channel = await interaction.client.channels.fetch(contest.channel_id);
            if (channel) {
              await channel.send({
                content: mentions,
                embeds: [notificationEmbed]
              });
            }
          } catch (e) {
            console.log('Could not send contest cancellation notification:', e.message);
          }
        }

        return interaction.editReply({
          content: `✅ Contest #${contestId} has been removed. ${entries.length} participant(s) were notified.`
        });

      } catch (error) {
        console.error('Contest remove error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }

    // ==================== REMOVE PARTICIPANT ====================
    if (subcommand === 'remove-participant') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const contestId = interaction.options.getInteger('contest_id');
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        const contest = await db.getContest(contestId);

        if (!contest) {
          return interaction.editReply({
            content: `❌ Contest #${contestId} not found.`
          });
        }

        if (contest.guild_id !== guildId) {
          return interaction.editReply({
            content: '❌ This contest is not from this server.'
          });
        }

        // Check permission
        const isCreator = contest.created_by === interaction.user.id;
        const isAdmin = interaction.member.permissions.has('ManageGuild');

        if (!isCreator && !isAdmin) {
          return interaction.editReply({
            content: '❌ Only the contest creator or server administrators can remove participants.'
          });
        }

        // Check if user is in contest
        const entry = await db.getContestEntry(contestId, targetUser.id);
        if (!entry) {
          return interaction.editReply({
            content: `❌ ${targetUser.username} is not a participant in contest #${contestId}.`
          });
        }

        // Remove participant
        await db.removeContestEntry(contestId, targetUser.id);

        // Notify in channel
        const notificationEmbed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('⚠️ Participant Removed from Contest')
          .addFields(
            { name: 'Contest', value: `#${contestId} - ${contest.title}` },
            { name: 'Removed User', value: `<@${targetUser.id}>` },
            { name: 'Reason', value: reason },
            { name: 'Removed By', value: `<@${interaction.user.id}>` }
          )
          .setTimestamp();

        try {
          const channel = await interaction.client.channels.fetch(contest.channel_id);
          if (channel) {
            await channel.send({
              content: `<@${targetUser.id}>`,
              embeds: [notificationEmbed]
            });
          }
        } catch (e) {
          console.log('Could not send removal notification:', e.message);
        }

        return interaction.editReply({
          content: `✅ Removed ${targetUser.username} from contest #${contestId}.`
        });

      } catch (error) {
        console.error('Remove participant error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }

    // ==================== RULES ====================
    if (subcommand === 'rules') {
      const rulesEmbed = new EmbedBuilder()
        .setColor('#14F195')
        .setTitle('📜 Contest Rules & Entry Instructions')
        .setDescription('Follow these steps to enter a contest:')
        .addFields(
          { 
            name: '1️⃣ Find an Active Contest', 
            value: 'Use `/contest list` to see all active contests in this server.' 
          },
          { 
            name: '2️⃣ Review Requirements', 
            value: 'Each contest has a reference URL you must visit. Read the contest description for specific requirements.' 
          },
          { 
            name: '3️⃣ Click "Enter Contest"', 
            value: 'Click the green "🎉 Enter Contest" button on the contest card.' 
          },
          { 
            name: '4️⃣ Submit Screenshot Proof', 
            value: 'You\'ll be prompted to upload a screenshot proving you visited the reference URL and completed the required action.' 
          },
          { 
            name: '5️⃣ Wallet Requirement', 
            value: 'You must have a DisCryptoBank wallet connected (`/user-wallet connect`) to receive prizes.' 
          },
          { 
            name: '⚠️ Important Rules', 
            value: '• One entry per Discord account\n• No alt accounts allowed\n• Invalid/fake screenshots will be rejected\n• Winners are selected randomly when contest ends\n• Prizes are distributed automatically to connected wallets' 
          },
          { 
            name: '🏆 Winner Selection', 
            value: 'When the contest timer ends, the bot randomly selects winner(s) from all valid entries. Winners are announced in the channel where the contest was created.' 
          },
          { 
            name: '💰 Prize Distribution', 
            value: 'Prizes are split evenly among winners. Example: $10 prize with 2 winners = $5 each.' 
          }
        )
        .setFooter({ text: 'Good luck! 🍀' })
        .setTimestamp();

      return interaction.reply({ embeds: [rulesEmbed], ephemeral: false });
    }

    // ==================== REFRESH ====================
    if (subcommand === 'refresh') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const contestId = interaction.options.getInteger('contest_id');
        const contest = await db.getContest(contestId);

        if (!contest) {
          return interaction.editReply({
            content: `❌ Contest #${contestId} not found.`
          });
        }

        if (contest.guild_id !== guildId) {
          return interaction.editReply({
            content: '❌ This contest is not from this server.'
          });
        }

        // Create updated embed
        const embed = createContestEmbed(contest);

        // Create Enter Contest button (only if still active)
        let components = [];
        if (contest.status === 'active') {
          const enterButton = new ButtonBuilder()
            .setCustomId(`contest_enter_${contestId}`)
            .setLabel('🎉 Enter Contest')
            .setStyle(ButtonStyle.Success);
          components = [new ActionRowBuilder().addComponents(enterButton)];
        }

        // Try to edit the original message if we have the message ID
        if (contest.message_id) {
          try {
            const channel = await interaction.client.channels.fetch(contest.channel_id);
            if (channel) {
              const message = await channel.messages.fetch(contest.message_id);
              await message.edit({
                embeds: [embed],
                components: components
              });
              return interaction.editReply({
                content: `✅ Contest #${contestId} message has been refreshed with updated countdown and entry count!`
              });
            }
          } catch (e) {
            console.log(`[Contest] Could not edit original message for contest #${contestId}:`, e.message);
          }
        }

        // If we couldn't edit original, post a new one and update the stored message ID
        const reply = await interaction.followUp({
          embeds: [embed],
          components: components,
          ephemeral: false
        });

        // Update the message ID in database
        await db.updateContestMessageId(contestId, reply.id);

        return interaction.editReply({
          content: `✅ Contest #${contestId} refreshed! (Posted as new message since original couldn't be found)`
        });

      } catch (error) {
        console.error('Contest refresh error:', error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`
        });
      }
    }
  },

  // Handle contest entry button
  handleEntryButton: async (interaction) => {
    const parts = interaction.customId.split('_');
    const contestId = parseInt(parts[2]);
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    try {
      // Get contest
      const contest = await db.getContest(contestId);

      if (!contest) {
        return interaction.reply({
          content: '❌ This contest no longer exists.',
          ephemeral: true
        });
      }

      if (contest.status !== 'active') {
        return interaction.reply({
          content: '❌ This contest has ended.',
          ephemeral: true
        });
      }

      // Check if contest is full
      if (contest.current_entries >= contest.max_entries) {
        return interaction.reply({
          content: '❌ This contest is full. No more entries available.',
          ephemeral: true
        });
      }

      // Check if already entered
      const existingEntry = await db.getContestEntry(contestId, userId);
      if (existingEntry) {
        return interaction.reply({
          content: '❌ You have already entered this contest. Only one entry per person is allowed.',
          ephemeral: true
        });
      }

      // Check if user has connected wallet
      const userData = await db.getUser(userId);
      if (!userData || !userData.solana_address) {
        return interaction.reply({
          content: '❌ **Wallet Required!**\n\nYou must connect your DisCryptoBank wallet before entering contests.\n\nUse `/user-wallet connect <your-solana-address>` to connect your wallet, then try again.',
          ephemeral: true
        });
      }

      // Show modal for screenshot submission
      const modal = new ModalBuilder()
        .setCustomId(`contest_entry_modal_${contestId}`)
        .setTitle('Contest Entry Verification');

      const screenshotInstructions = new TextInputBuilder()
        .setCustomId('screenshot_note')
        .setLabel('After this, upload screenshot as reply')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Type "ready" to continue')
        .setRequired(true)
        .setMaxLength(10);

      modal.addComponents(
        new ActionRowBuilder().addComponents(screenshotInstructions)
      );

      await interaction.showModal(modal);

    } catch (error) {
      console.error('Contest entry error:', error);
      return interaction.reply({
        content: `❌ Error: ${error.message}`,
        ephemeral: true
      });
    }
  },

  // Handle contest entry modal submission
  handleEntryModal: async (interaction) => {
    const parts = interaction.customId.split('_');
    const contestId = parseInt(parts[3]);
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    try {
      const contest = await db.getContest(contestId);

      if (!contest || contest.status !== 'active') {
        return interaction.reply({
          content: '❌ This contest is no longer available.',
          ephemeral: true
        });
      }

      // Create instruction embed for screenshot upload
      const instructionEmbed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('📸 Screenshot Verification Required')
        .setDescription(`To complete your entry for **${contest.title}**, please reply to this message with a screenshot.`)
        .addFields(
          { name: '📎 Reference URL', value: `[Click here to visit](${contest.reference_url})` },
          { name: '📋 Instructions', value: '1. Visit the reference URL above\n2. Take a screenshot showing proof of completion\n3. Reply to THIS message with your screenshot attached' },
          { name: '⏰ Time Limit', value: 'You have 5 minutes to submit your screenshot' }
        )
        .setFooter({ text: `Contest #${contestId}` })
        .setTimestamp();

      const response = await interaction.reply({
        embeds: [instructionEmbed],
        ephemeral: false,
        fetchReply: true
      });

      // Create message collector for screenshot
      const filter = (msg) => {
        return msg.author.id === userId && 
               msg.reference?.messageId === response.id &&
               msg.attachments.size > 0;
      };

      const collector = interaction.channel.createMessageCollector({
        filter,
        max: 1,
        time: 300000 // 5 minutes
      });

      collector.on('collect', async (msg) => {
        const attachment = msg.attachments.first();

        if (!attachment.contentType || !attachment.contentType.startsWith('image/')) {
          await msg.reply({
            content: '❌ Please upload an image file (PNG, JPG, etc.)',
            ephemeral: false
          });
          return;
        }

        // Verify contest still available
        const currentContest = await db.getContest(contestId);
        if (!currentContest || currentContest.status !== 'active') {
          await msg.reply({
            content: '❌ This contest has ended.',
            ephemeral: false
          });
          return;
        }

        if (currentContest.current_entries >= currentContest.max_entries) {
          await msg.reply({
            content: '❌ Sorry, the contest filled up while you were submitting.',
            ephemeral: false
          });
          return;
        }

        // Double-check not already entered
        const existingEntry = await db.getContestEntry(contestId, userId);
        if (existingEntry) {
          await msg.reply({
            content: '❌ You have already entered this contest.',
            ephemeral: false
          });
          return;
        }

        // Add entry
        await db.addContestEntry(contestId, guildId, userId, attachment.url);

        const successEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('✅ Contest Entry Confirmed!')
          .setDescription(`<@${userId}> has successfully entered **${currentContest.title}**!`)
          .addFields(
            { name: 'Contest', value: `#${contestId} - ${currentContest.title}`, inline: true },
            { name: 'Entry #', value: `${currentContest.current_entries + 1}/${currentContest.max_entries}`, inline: true },
            { name: '🏆 Prize Pool', value: `${currentContest.prize_amount} ${currentContest.currency}` },
            { name: '⏰ Drawing', value: `<t:${Math.floor(new Date(currentContest.ends_at).getTime() / 1000)}:R>` }
          )
          .setThumbnail(attachment.url)
          .setTimestamp();

        await msg.reply({ embeds: [successEmbed] });
      });

      collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
          interaction.followUp({
            content: `❌ <@${userId}> Contest entry timed out. Please click "Enter Contest" again to try.`,
            ephemeral: false
          }).catch(() => {});
        }
      });

    } catch (error) {
      console.error('Contest entry modal error:', error);
      return interaction.reply({
        content: `❌ Error: ${error.message}`,
        ephemeral: true
      });
    }
  }
};

// Helper function to create contest embed
function createContestEmbed(contest) {
  const spotsLeft = contest.max_entries - (contest.current_entries || 0);
  const prizePerWinner = (contest.prize_amount / contest.num_winners).toFixed(2);
  const endTimestamp = Math.floor(new Date(contest.ends_at).getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  const isExpired = endTimestamp <= now;

  const statusEmoji = contest.status === 'active' ? '🟢' : contest.status === 'ended' ? '🔴' : '⚪';
  const status = contest.status || 'active';

  // Calculate time remaining for display
  const timeRemaining = endTimestamp - now;
  let countdownDisplay;
  if (isExpired || timeRemaining <= 0) {
    countdownDisplay = '🔴 **ENDED**';
  } else {
    const days = Math.floor(timeRemaining / 86400);
    const hours = Math.floor((timeRemaining % 86400) / 3600);
    const minutes = Math.floor((timeRemaining % 3600) / 60);
    const seconds = timeRemaining % 60;
    
    if (days > 0) {
      countdownDisplay = `⏱️ **${days}d ${hours}h ${minutes}m**`;
    } else if (hours > 0) {
      countdownDisplay = `⏱️ **${hours}h ${minutes}m ${seconds}s**`;
    } else {
      countdownDisplay = `⏱️ **${minutes}m ${seconds}s**`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(status === 'active' && !isExpired ? '#FFD700' : '#808080')
    .setTitle(`🎉 Contest #${contest.id}: ${contest.title}`)
    .setDescription(`${contest.description}\n\n**⏰ TIME REMAINING: ${countdownDisplay}**\n*(Live countdown: <t:${endTimestamp}:R>)*`)
    .addFields(
      { name: '🎁 Total Prize', value: `${contest.prize_amount} ${contest.currency}`, inline: true },
      { name: '🏆 Winners', value: `${contest.num_winners}`, inline: true },
      { name: '💰 Per Winner', value: `${prizePerWinner} ${contest.currency}`, inline: true },
      { name: '👥 Entries', value: `${contest.current_entries || 0}/${contest.max_entries}`, inline: true },
      { name: '📍 Spots Left', value: `${spotsLeft}`, inline: true },
      { name: `${statusEmoji} Status`, value: status.toUpperCase(), inline: true },
      { name: '📎 Reference URL', value: `[Click to Visit](${contest.reference_url})` },
      { name: '🗓️ Ends At', value: `<t:${endTimestamp}:F>` },
      { name: '👤 Created By', value: `<@${contest.created_by}>` }
    )
    .setFooter({ text: 'Click "Enter Contest" to participate! • Countdown updates live ↑' })
    .setTimestamp();

  return embed;
}

// Helper function to get time remaining
function getTimeRemaining(endsAt) {
  const now = new Date();
  const end = new Date(endsAt);
  const diff = end - now;

  if (diff <= 0) return 'Ended';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  return `${hours}h ${minutes}m`;
}
