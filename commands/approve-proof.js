const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('approve-proof')
    .setDescription('Approve or reject task proof submissions')
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('View pending proof submissions')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('approve')
        .setDescription('Approve a proof submission')
        .addIntegerOption(option =>
          option.setName('proof_id')
            .setDescription('Proof submission ID')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reject')
        .setDescription('Reject a proof submission')
        .addIntegerOption(option =>
          option.setName('proof_id')
            .setDescription('Proof submission ID')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('reason')
            .setDescription('Reason for rejection')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    // Check if user has approved role
    const approvedRoles = await db.getApprovedRoles(guildId);
    const hasApprovalRole = approvedRoles.length === 0 || 
      interaction.member.roles.cache.some(r => approvedRoles.includes(r.id)) ||
      interaction.member.permissions.has('ManageGuild');

    if (!hasApprovalRole) {
      return interaction.reply({
        content: '❌ You do not have permission to approve proofs. Only designated approvers can review submissions.',
        ephemeral: true
      });
    }

    if (subcommand === 'list') {
      const proofs = await db.getPendingProofs(guildId);

      if (!proofs || proofs.length === 0) {
        return interaction.reply({
          content: '📋 No pending proof submissions.',
          ephemeral: true
        });
      }

      let proofList = '';
      for (const proof of proofs) {
        proofList += `**#${proof.id}** - ${proof.title}\n`;
        proofList += `Submitted by: <@${proof.assigned_user_id}>\n`;
        proofList += `Screenshot: [View](${proof.screenshot_url})\n`;
        proofList += `Verification: [View](${proof.verification_url})\n`;
        proofList += `Status: ⏳ Pending\n\n`;
      }

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('📋 Pending Proof Submissions')
        .setDescription(proofList || 'No pending submissions')
        .setFooter({ text: 'Use /approve-proof approve or reject to review' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'approve') {
      const proofId = interaction.options.getInteger('proof_id');

      const proof = await db.getProofSubmission(proofId);

      if (!proof) {
        return interaction.reply({
          content: `❌ Proof #${proofId} not found.`,
          ephemeral: true
        });
      }

      if (proof.guild_id !== guildId) {
        return interaction.reply({
          content: '❌ This proof is not from this server.',
          ephemeral: true
        });
      }

      if (proof.status !== 'pending') {
        return interaction.reply({
          content: `❌ Proof #${proofId} has already been ${proof.status}.`,
          ephemeral: true
        });
      }

      // Approve the proof
      await db.approveProof(proofId, interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Proof Approved!')
        .addFields(
          { name: 'Proof ID', value: `#${proofId}`, inline: true },
          { name: 'Status', value: 'Approved ✓', inline: true },
          { name: 'Approved By', value: interaction.user.username },
          { name: 'Next Step', value: 'Notify the user and process payment' }
        )
        .setTimestamp();

      // Notify the submitter
      try {
        const user = await interaction.client.users.fetch(proof.user_id);
        const notifyEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('✅ Your Proof Was Approved!')
          .addFields(
            { name: 'Proof ID', value: `#${proofId}` },
            { name: 'Approved By', value: interaction.user.username },
            { name: 'Status', value: '✅ Payment Processing' }
          );

        await user.send({ embeds: [notifyEmbed] });
      } catch (e) {
        console.log('Could not notify user');
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'reject') {
      const proofId = interaction.options.getInteger('proof_id');
      const reason = interaction.options.getString('reason');

      const proof = await db.getProofSubmission(proofId);

      if (!proof) {
        return interaction.reply({
          content: `❌ Proof #${proofId} not found.`,
          ephemeral: true
        });
      }

      if (proof.guild_id !== guildId) {
        return interaction.reply({
          content: '❌ This proof is not from this server.',
          ephemeral: true
        });
      }

      if (proof.status !== 'pending') {
        return interaction.reply({
          content: `❌ Proof #${proofId} has already been ${proof.status}.`,
          ephemeral: true
        });
      }

      // Reject the proof
      await db.rejectProof(proofId, reason, interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ Proof Rejected')
        .addFields(
          { name: 'Proof ID', value: `#${proofId}`, inline: true },
          { name: 'Status', value: 'Rejected', inline: true },
          { name: 'Rejected By', value: interaction.user.username },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();

      // Notify the submitter
      try {
        const user = await interaction.client.users.fetch(proof.user_id);
        const notifyEmbed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('❌ Your Proof Was Rejected')
          .addFields(
            { name: 'Proof ID', value: `#${proofId}` },
            { name: 'Reason', value: reason },
            { name: 'Next Step', value: 'You can resubmit your proof' }
          );

        await user.send({ embeds: [notifyEmbed] });
      } catch (e) {
        console.log('Could not notify user');
      }

      return interaction.reply({ embeds: [embed] });
    }
  }
};
