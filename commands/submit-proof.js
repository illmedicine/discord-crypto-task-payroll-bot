const { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('submit-proof')
    .setDescription('Submit proof of task completion with screenshot and verification URL')
    .addIntegerOption(option =>
      option.setName('assignment_id')
        .setDescription('Your task assignment ID')
        .setRequired(true)
    ),

  async execute(interaction) {
    const assignmentId = interaction.options.getInteger('assignment_id');
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    // Verify assignment exists and belongs to user
    // Create an embed with instructions
    const instructionEmbed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('📸 Submit Task Proof')
      .setDescription('Follow these steps to submit your proof:')
      .addFields(
        { name: 'Step 1: Upload Screenshot', value: 'Reply to this message with your screenshot image (paste directly or upload file)' },
        { name: 'Step 2: Verify Task Completion', value: 'Click the button below to enter your verification URL' },
        { name: 'Tips', value: '• You can paste images directly into Discord\n• Screenshot must show clear evidence of task completion\n• Verification URL must match the task requirement' }
      )
      .setTimestamp();

    const verifyButton = new ButtonBuilder()
      .setCustomId(`proof_verification_${assignmentId}_${userId}`)
      .setLabel('Enter Verification URL')
      .setStyle(ButtonStyle.Primary);

    const buttonRow = new ActionRowBuilder().addComponents(verifyButton);

    const responseMsg = await interaction.reply({
      embeds: [instructionEmbed],
      components: [buttonRow],
      ephemeral: false
    });

    // Store the assignment ID and user ID in the message for image collection
    const imageCollectorFilter = (msg) => msg.author.id === userId && msg.reference?.messageId === responseMsg.id;
    const imageCollector = interaction.channel.createMessageCollector({
      filter: imageCollectorFilter,
      max: 1,
      maxProcessed: 1
    });

    let screenshotUrl = null;

    imageCollector.on('collect', async (msg) => {
      if (msg.attachments.size > 0) {
        const attachment = msg.attachments.first();
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
          screenshotUrl = attachment.url;
          
          // Acknowledge the screenshot
          const confirmEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Screenshot Received')
            .setDescription('Your screenshot has been captured. Now click the button above to enter your verification URL.')
            .setImage(screenshotUrl);

          await msg.reply({ embeds: [confirmEmbed] });
        } else {
          await msg.reply({
            content: '❌ Please upload an image file (PNG, JPG, etc.)',
            ephemeral: true
          });
        }
      } else {
        await msg.reply({
          content: '❌ No image found. Please attach an image to your message.',
          ephemeral: true
        });
      }
    });

    imageCollector.on('end', () => {
      // Collector ended without receiving image
      if (!screenshotUrl) {
        console.log(`No screenshot uploaded for assignment ${assignmentId}`);
      }
    });

    // Store screenshot URL and assignment ID for button handler
    global.proofSubmissions = global.proofSubmissions || {};
    global.proofSubmissions[`${assignmentId}_${userId}`] = { screenshotUrl: null };

    // Return the handler for the button
    return { screenshotUrl, assignmentId, userId, guildId };
  },

  // Handle button click for verification URL
  handleVerificationButton: async (interaction, client) => {
    const parts = interaction.customId.split('_');
    const assignmentId = parseInt(parts[2]);
    const userId = parts[3];

    if (interaction.user.id !== userId) {
      return interaction.reply({
        content: '❌ You can only submit proof for your own assignments.',
        ephemeral: true
      });
    }

    // Get the parent message to check for screenshots
    const parentMsg = interaction.message;
    let screenshotUrl = null;

    // Search recent messages in the channel for screenshot from this user
    try {
      const messages = await parentMsg.channel.messages.fetch({ limit: 10 });
      for (const [msgId, msg] of messages) {
        if (msg.author.id === userId && msg.attachments.size > 0) {
          const attachment = msg.attachments.first();
          if (attachment.contentType && attachment.contentType.startsWith('image/')) {
            screenshotUrl = attachment.url;
            break;
          }
        }
      }
    } catch (e) {
      console.error('Error fetching messages:', e);
    }

    if (!screenshotUrl) {
      return interaction.reply({
        content: '❌ No screenshot found. Please upload your screenshot as a reply to the original message first.',
        ephemeral: true
      });
    }

    // Create modal for verification URL
    const modal = new ModalBuilder()
      .setCustomId(`proof_modal_${assignmentId}_${userId}`)
      .setTitle('Task Proof Verification');

    const verificationInput = new TextInputBuilder()
      .setCustomId('verification_url')
      .setLabel('Verification URL')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('https://example.com/verification')
      .setRequired(true)
      .setMinLength(10);

    const notesInput = new TextInputBuilder()
      .setCustomId('notes')
      .setLabel('Additional Notes (Optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Explain your proof or provide context...')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(verificationInput),
      new ActionRowBuilder().addComponents(notesInput)
    );

    // Store screenshot URL temporarily
    if (!global.proofData) global.proofData = {};
    global.proofData[`${assignmentId}_${userId}`] = { screenshotUrl };

    await interaction.showModal(modal);
  },

  // Handle modal submission
  handleModal: async (interaction) => {
    if (!interaction.customId.startsWith('proof_modal_')) return;

    const parts = interaction.customId.split('_');
    const assignmentId = parseInt(parts[2]);
    const userId = parts[3];

    if (interaction.user.id !== userId) {
      return interaction.reply({
        content: '❌ You can only submit proof for your own assignments.',
        ephemeral: true
      });
    }

    const guildId = interaction.guildId;
    const verificationUrl = interaction.fields.getTextInputValue('verification_url');
    const notes = interaction.fields.getTextInputValue('notes') || '';

    // Get screenshot from temporary storage
    const proofData = global.proofData?.[`${assignmentId}_${userId}`] || {};
    const screenshotUrl = proofData.screenshotUrl;

    if (!screenshotUrl) {
      return interaction.reply({
        content: '❌ Screenshot not found. Please upload the screenshot first.',
        ephemeral: true
      });
    }

    try {
      // Submit proof to database
      const proofId = await db.submitProof(
        assignmentId,
        guildId,
        userId,
        screenshotUrl,
        verificationUrl,
        notes
      );

      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Proof Submitted Successfully!')
        .setDescription('Your task proof has been submitted for review by the approval team.')
        .addFields(
          { name: 'Assignment ID', value: `#${assignmentId}`, inline: true },
          { name: 'Proof ID', value: `#${proofId}`, inline: true },
          { name: 'Screenshot', value: `[View](${screenshotUrl})` },
          { name: 'Verification URL', value: `[View](${verificationUrl})` },
          ...(notes ? [{ name: 'Notes', value: notes }] : []),
          { name: 'Status', value: '⏳ Awaiting Approval' },
          { name: 'Next Step', value: 'An approver will review your submission soon and notify you of the result.' }
        )
        .setFooter({ text: 'Do not modify your proof after submission' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: false });

      // Clean up temporary data
      delete global.proofData?.[`${assignmentId}_${userId}`];

      // Notify approvers
      const approverRoles = await db.getApprovedRoles(guildId);
      if (approverRoles.length > 0) {
        try {
          const guild = await interaction.guild.fetch();
          const members = await guild.members.fetch();
          
          const approvers = members.filter(m => {
            return m.roles.cache.some(r => approverRoles.includes(r.id));
          });

          if (approvers.size > 0) {
            const notificationEmbed = new EmbedBuilder()
              .setColor('#FFD700')
              .setTitle('📋 New Proof Submission to Review')
              .addFields(
                { name: 'Proof ID', value: `#${proofId}`, inline: true },
                { name: 'Assignment ID', value: `#${assignmentId}`, inline: true },
                { name: 'Submitted By', value: `<@${userId}>` },
                { name: 'Screenshot', value: `[View](${screenshotUrl})` },
                { name: 'Verification', value: `[View](${verificationUrl})` },
                ...(notes ? [{ name: 'Notes', value: notes }] : []),
                { name: 'Action', value: 'Use `/approve-proof` to review this submission' }
              )
              .setImage(screenshotUrl)
              .setTimestamp();

            // Send to first approver (in production, use notification channel)
            const firstApprover = approvers.first();
            try {
              await firstApprover.send({ embeds: [notificationEmbed] });
            } catch (e) {
              console.log('Could not DM approver');
            }
          }
        } catch (e) {
          console.log('Error notifying approvers:', e.message);
        }
      }

    } catch (error) {
      console.error('Error submitting proof:', error);
      return interaction.reply({
        content: `❌ Error submitting proof: ${error.message}`,
        ephemeral: true
      });
    }
  }
};
