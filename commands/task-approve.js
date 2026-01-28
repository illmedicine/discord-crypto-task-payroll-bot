const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('../utils/crypto');
const { tasks } = require('./task-create');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('approve')
    .setDescription('Approve and execute a payroll task')
    .addStringOption(option =>
      option.setName('task_id')
        .setDescription('Task ID to approve')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const taskIdStr = interaction.options.getString('task_id');
      const taskNum = parseInt(taskIdStr);
      const task = tasks.get(taskNum);

      if (!task) {
        return interaction.editReply({
          content: `❌ Task #${taskNum} not found.`
        });
      }

      if (task.status === 'executed') {
        return interaction.editReply({
          content: `❌ Task #${taskNum} has already been executed.`
        });
      }

      // Send SOL
      const result = await crypto.sendSol(task.recipient, task.amount);

      if (!result.success) {
        return interaction.editReply({
          content: `❌ Failed to execute task: ${result.error}`
        });
      }

      // Update task status
      task.status = 'executed';
      task.executedAt = new Date().toISOString();
      task.signature = result.signature;

      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Task Executed Successfully')
        .setDescription(`Task #${task.id} has been approved and executed`)
        .addFields(
          { name: 'Recipient', value: `\`${task.recipient}\`` },
          { name: 'Amount', value: `${task.amount} SOL` },
          { name: 'Description', value: task.description },
          { name: 'Approved By', value: interaction.user.username },
          { name: 'Signature', value: `\`${result.signature.slice(0, 30)}...\`` },
          { name: 'Status', value: '✅ Executed', inline: true },
          { name: 'Timestamp', value: new Date(task.executedAt).toLocaleString(), inline: true }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error approving task:', error);
      return interaction.editReply({
        content: `❌ Error: ${error.message}`
      });
    }
  }
};
