const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove-bulk-task')
    .setDescription('Remove a bulk task (Treasury Owner only)')
    // Place required options first (if any in future), then optional
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for removing the task (will be shown to affected members)')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('bulk_task_id')
        .setDescription('Bulk task ID to remove')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('proof_id')
        .setDescription('Proof ID (will remove the associated bulk task)')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Defer reply immediately to prevent timeout
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;

    // Verify this is a guild command
    if (!guildId) {
      return interaction.editReply({
        content: '❌ This command can only be used in a Discord server.'
      });
    }

    // Check if user is the treasury owner (wallet configured by)
    const guildWallet = await db.getGuildWallet(guildId);
    if (!guildWallet) {
      return interaction.editReply({
        content: '❌ No treasury wallet is configured for this server.\n' +
                'Use `/wallet setup` to configure the treasury wallet first.'
      });
    }

    if (guildWallet.configured_by !== interaction.user.id) {
      return interaction.editReply({
        content: '❌ Only the treasury owner can remove bulk tasks.\n' +
                `Treasury owner: <@${guildWallet.configured_by}>`
      });
    }

    // Get bulk task ID from either direct ID or proof ID
    let bulkTaskId = interaction.options.getInteger('bulk_task_id');
    const proofId = interaction.options.getInteger('proof_id');

    // If neither ID provided, show error
    if (!bulkTaskId && !proofId) {
      const allTasks = await db.getActiveBulkTasks(guildId);
      
      if (allTasks.length === 0) {
        return interaction.editReply({
          content: '❌ No bulk tasks available to remove.\n\n' +
                  'Use either:\n' +
                  '• `/remove-bulk-task bulk_task_id:<task_id>`\n' +
                  '• `/remove-bulk-task proof_id:<proof_id>`'
        });
      }

      const taskList = allTasks
        .map(t => `• Task #${t.id}: ${t.title} (${t.payout_amount} ${t.payout_currency})`)
        .join('\n');

      return interaction.editReply({
        content: '❌ Please specify either `bulk_task_id` or `proof_id`.\n\n' +
                '**Available tasks:**\n' + taskList + '\n\n' +
                'Use either:\n' +
                '• `/remove-bulk-task bulk_task_id:<task_id>`\n' +
                '• `/remove-bulk-task proof_id:<proof_id>`'
      });
    }

    // If proof ID provided, get the bulk task ID from the proof
    if (proofId && !bulkTaskId) {
      try {
        const proof = await db.getProofSubmission(proofId);
        if (!proof) {
          return interaction.editReply({
            content: `❌ Proof #${proofId} not found.`
          });
        }
        bulkTaskId = proof.bulk_task_id;
      } catch (error) {
        console.error('[REMOVE-BULK-TASK] Error fetching proof:', error);
        return interaction.editReply({
          content: `❌ Error fetching proof #${proofId}: ${error.message}`
        });
      }
    }

    // Get the bulk task details before deleting
    let bulkTask;
    try {
      bulkTask = await db.getBulkTask(bulkTaskId);
      if (!bulkTask) {
        return interaction.editReply({
          content: `❌ Bulk task #${bulkTaskId} not found.`
        });
      }

      // Verify task belongs to this guild
      if (bulkTask.guild_id !== guildId) {
        return interaction.editReply({
          content: `❌ Bulk task #${bulkTaskId} does not belong to this server.`
        });
      }
    } catch (error) {
      console.error('[REMOVE-BULK-TASK] Error fetching bulk task:', error);
      return interaction.editReply({
        content: `❌ Error fetching bulk task #${bulkTaskId}: ${error.message}`
      });
    }

    // Get reason for removal
    const reason = interaction.options.getString('reason') || 'No reason provided';

    // Get all assignments for this task to notify affected users
    let assignments = [];
    try {
      assignments = await db.getTaskAssignments(bulkTaskId);
    } catch (error) {
      console.error('[REMOVE-BULK-TASK] Error fetching assignments:', error);
    }

    // Delete the bulk task
    try {
      const result = await db.deleteBulkTask(bulkTaskId);

      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('🗑️ Bulk Task Removed')
        .setDescription(`Successfully removed bulk task #${bulkTaskId}`)
        .addFields(
          { name: '📋 Task', value: bulkTask.title, inline: false },
          { name: '💰 Payout', value: `${bulkTask.payout_amount} ${bulkTask.payout_currency}`, inline: true },
          { name: '📊 Slots', value: `${bulkTask.total_slots}`, inline: true },
          { name: '⚙️ Status', value: bulkTask.status || 'active', inline: true },
          { name: '📝 Reason', value: reason, inline: false },
          { name: '👥 Affected Members', value: `${assignments.length} member(s) notified`, inline: true },
          { name: '📍 Channel', value: interaction.channel.name, inline: true }
        )
        .setFooter({ text: 'All related assignments, proofs, and auto-approve settings have been removed.' })
        .setTimestamp();

      // Notify affected members in their claim channels
      if (assignments.length > 0) {
        const notifiedChannels = new Set();
        
        for (const assignment of assignments) {
          try {
            const channelId = assignment.claimed_channel_id || interaction.channelId;
            
            // Only notify once per channel to avoid spam
            if (!notifiedChannels.has(channelId)) {
              const channel = await interaction.client.channels.fetch(channelId);
              if (channel && channel.isTextBased()) {
                const notificationEmbed = new EmbedBuilder()
                  .setColor('#FF0000')
                  .setTitle('⚠️ Bulk Task Removed')
                  .setDescription(`Bulk task #${bulkTaskId} has been removed by the treasury owner.`)
                  .addFields(
                    { name: '📋 Task', value: bulkTask.title },
                    { name: '💰 Payout', value: `${bulkTask.payout_amount} ${bulkTask.payout_currency}`, inline: true },
                    { name: '📝 Reason', value: reason },
                    { name: 'Impact', value: 'All claims and pending proofs for this task have been removed.' }
                  )
                  .setTimestamp();

                // Find all users affected in this channel
                const affectedUsers = assignments
                  .filter(a => (a.claimed_channel_id || interaction.channelId) === channelId)
                  .map(a => `<@${a.assigned_user_id}>`)
                  .join(', ');

                await channel.send({ 
                  content: affectedUsers || 'Affected members',
                  embeds: [notificationEmbed] 
                });
                
                notifiedChannels.add(channelId);
              }
            }
          } catch (error) {
            console.error(`[REMOVE-BULK-TASK] Error notifying user ${assignment.assigned_user_id}:`, error);
          }
        }
      }

      return interaction.editReply({
        embeds: [embed]
      });

    } catch (error) {
      console.error('[REMOVE-BULK-TASK] Error deleting task:', error);
      return interaction.editReply({
        content: `❌ Failed to remove bulk task #${bulkTaskId}: ${error.message}`
      });
    }
  }
};
