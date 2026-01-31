const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('auto-approve')
    .setDescription('Configure automatic approval and payment for bulk tasks (Treasury Owner only)')
    .addSubcommand(subcommand =>
      subcommand
        .setName('enable')
        .setDescription('Enable auto-approve for a bulk task')
        .addIntegerOption(option =>
          option.setName('bulk_task_id')
            .setDescription('Bulk task ID to enable auto-approve for')
            .setRequired(true)
        )
        .addBooleanOption(option =>
          option.setName('require_screenshot')
            .setDescription('Require screenshot attachment (default: true)')
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option.setName('require_verification_url')
            .setDescription('Require verification URL (default: false)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('disable')
        .setDescription('Disable auto-approve for a bulk task')
        .addIntegerOption(option =>
          option.setName('bulk_task_id')
            .setDescription('Bulk task ID to disable auto-approve for')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Check auto-approve status for a bulk task')
        .addIntegerOption(option =>
          option.setName('bulk_task_id')
            .setDescription('Bulk task ID to check')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    // Verify this is a guild command
    if (!guildId) {
      return interaction.reply({
        content: '❌ This command can only be used in a Discord server.',
        ephemeral: true
      });
    }

    // Check if user is the treasury owner (wallet configured by)
    const guildWallet = await db.getGuildWallet(guildId);
    if (!guildWallet) {
      return interaction.reply({
        content: '❌ This server does not have a treasury wallet configured yet.\n\n**Server Admin:** Use `/wallet connect` to set up the treasury wallet.',
        ephemeral: true
      });
    }

    if (guildWallet.configured_by !== interaction.user.id) {
      return interaction.reply({
        content: '❌ Only the treasury owner (the person who connected the wallet) can configure auto-approve settings.',
        ephemeral: true
      });
    }

    const bulkTaskId = interaction.options.getInteger('bulk_task_id');

    // Verify the bulk task exists and belongs to this guild
    const bulkTask = await db.getBulkTask(bulkTaskId);
    if (!bulkTask) {
      return interaction.reply({
        content: `❌ Bulk task #${bulkTaskId} not found.`,
        ephemeral: true
      });
    }

    if (bulkTask.guild_id !== guildId) {
      return interaction.reply({
        content: '❌ This bulk task does not belong to this server.',
        ephemeral: true
      });
    }

    if (subcommand === 'enable') {
      const requireScreenshot = interaction.options.getBoolean('require_screenshot') ?? true;
      const requireVerificationUrl = interaction.options.getBoolean('require_verification_url') ?? false;

      await db.setAutoApprove(bulkTaskId, guildId, true, requireScreenshot, requireVerificationUrl, interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Auto-Approve Enabled')
        .setDescription(`Auto-approve has been enabled for bulk task #${bulkTaskId}`)
        .addFields(
          { name: 'Task', value: bulkTask.title },
          { name: 'Payout', value: `${bulkTask.payout_amount} ${bulkTask.payout_currency}` },
          { name: 'Requirements', value: `📸 Screenshot: ${requireScreenshot ? '✅ Required' : '⚠️ Optional'}\n🔗 Verification URL: ${requireVerificationUrl ? '✅ Required' : '⚠️ Optional'}` },
          { name: 'Auto-Payment', value: '✅ Enabled - Proofs that meet requirements will be automatically approved and paid' }
        )
        .setFooter({ text: 'Configured by ' + interaction.user.username })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'disable') {
      await db.setAutoApprove(bulkTaskId, guildId, false, false, false, interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Auto-Approve Disabled')
        .setDescription(`Auto-approve has been disabled for bulk task #${bulkTaskId}`)
        .addFields(
          { name: 'Task', value: bulkTask.title },
          { name: 'Manual Approval Required', value: 'You must now manually approve proofs using `/approve-proof approve`' }
        )
        .setFooter({ text: 'Configured by ' + interaction.user.username })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'status') {
      const settings = await db.getAutoApproveSettings(bulkTaskId);

      const embed = new EmbedBuilder()
        .setColor(settings && settings.auto_approve_enabled ? '#00FF00' : '#FF0000')
        .setTitle('📊 Auto-Approve Status')
        .setDescription(`Status for bulk task #${bulkTaskId}`)
        .addFields(
          { name: 'Task', value: bulkTask.title },
          { name: 'Payout', value: `${bulkTask.payout_amount} ${bulkTask.payout_currency}` }
        );

      if (settings && settings.auto_approve_enabled) {
        embed.addFields(
          { name: 'Status', value: '✅ **ENABLED**' },
          { name: 'Requirements', value: `📸 Screenshot: ${settings.require_screenshot ? '✅ Required' : '⚠️ Optional'}\n🔗 Verification URL: ${settings.require_verification_url ? '✅ Required' : '⚠️ Optional'}` },
          { name: 'Auto-Payment', value: '✅ Proofs that meet requirements will be automatically approved and paid' }
        );
      } else {
        embed.addFields(
          { name: 'Status', value: '❌ **DISABLED**' },
          { name: 'Manual Approval', value: 'Treasury owner must manually approve and pay each proof' }
        );
      }

      embed.setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }
  }
};
