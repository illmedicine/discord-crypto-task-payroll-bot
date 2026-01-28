const { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const db = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('submit-proof')
    .setDescription('Submit proof of task completion')
    .addIntegerOption(option =>
      option.setName('assignment_id')
        .setDescription('Your task assignment ID')
        .setRequired(true)
    ),

  async execute(interaction) {
    const assignmentId = interaction.options.getInteger('assignment_id');
    const guildId = interaction.guildId;

    // Verify the assignment exists and belongs to the user
    // Create a modal for proof submission
    const modal = new ModalBuilder()
      .setCustomId(`proof_modal_${assignmentId}_${interaction.user.id}`)
      .setTitle('Submit Task Proof');

    const screenshotInput = new TextInputBuilder()
      .setCustomId('screenshot_url')
      .setLabel('Screenshot URL')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('https://imgur.com/...')
      .setRequired(true);

    const verificationInput = new TextInputBuilder()
      .setCustomId('verification_url')
      .setLabel('Verification/Proof URL')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('https://link-to-proof.com/...')
      .setRequired(true);

    const notesInput = new TextInputBuilder()
      .setCustomId('notes')
      .setLabel('Additional Notes (Optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Explain your proof...')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(screenshotInput),
      new ActionRowBuilder().addComponents(verificationInput),
      new ActionRowBuilder().addComponents(notesInput)
    );

    await interaction.showModal(modal);
  },

  // Handle modal submission
  handleModal: async (interaction) => {
    if (!interaction.customId.startsWith('proof_modal_')) return;

    const parts = interaction.customId.split('_');
    const assignmentId = parseInt(parts[2]);
    const userId = parts[3];

    // Verify user is submitting their own proof
    if (interaction.user.id !== userId) {
      return interaction.reply({
        content: '❌ You can only submit proof for your own assignments.',
        ephemeral: true
      });
    }

    const guildId = interaction.guildId;
    const screenshotUrl = interaction.fields.getTextInputValue('screenshot_url');
    const verificationUrl = interaction.fields.getTextInputValue('verification_url');
    const notes = interaction.fields.getTextInputValue('notes') || '';

    try {
      // Submit proof
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
        .setTitle('✅ Proof Submitted!')
        .setDescription('Your task proof has been submitted for review')
        .addFields(
          { name: 'Assignment ID', value: `#${assignmentId}`, inline: true },
          { name: 'Proof ID', value: `#${proofId}`, inline: true },
          { name: 'Screenshot', value: `[View](${screenshotUrl})` },
          { name: 'Verification', value: `[View](${verificationUrl})` },
          ...(notes ? [{ name: 'Notes', value: notes }] : []),
          { name: 'Status', value: '⏳ Awaiting Approval' }
        )
        .setFooter({ text: 'An approver will review your submission soon' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: false });

      // Notify approvers
      const approverRoles = await db.getApprovedRoles(guildId);
      if (approverRoles.length > 0) {
        const guild = await interaction.guild.fetch();
        const members = await guild.members.fetch();
        
        const approvers = members.filter(m => {
          return m.roles.cache.some(r => approverRoles.includes(r.id));
        });

        if (approvers.size > 0) {
          const notificationEmbed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('📋 New Proof Submission')
            .addFields(
              { name: 'Submitted By', value: `<@${userId}>` },
              { name: 'Proof ID', value: `#${proofId}` },
              { name: 'Screenshot', value: `[View](${screenshotUrl})` },
              { name: 'Verification', value: `[View](${verificationUrl})` },
              { name: 'Action', value: 'Use `/approve-proof` to review this submission' }
            )
            .setTimestamp();

          // Send to first approver (in production, create notification channel)
          const firstApprover = approvers.first();
          try {
            await firstApprover.send({ embeds: [notificationEmbed] });
          } catch (e) {
            console.log('Could not DM approver');
          }
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
