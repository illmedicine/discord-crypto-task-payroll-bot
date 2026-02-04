const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/db');
const crypto = require('../utils/crypto');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bulk-tasks')
    .setDescription('Create and manage bulk task listings')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new bulk task listing')
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Task title (e.g., "Social Media Verification")')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('description')
            .setDescription('Detailed task description')
            .setRequired(true)
        )
        .addNumberOption(option =>
          option.setName('payout')
            .setDescription('Payout amount per task')
            .setRequired(true)
            .setMinValue(0.001)
        )
        .addStringOption(option =>
          option.setName('currency')
            .setDescription('Currency type')
            .setRequired(true)
            .addChoices(
              { name: 'SOL', value: 'SOL' },
              { name: 'USD', value: 'USD' }
            )
        )
        .addIntegerOption(option =>
          option.setName('slots')
            .setDescription('Number of task slots available')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('View available tasks to claim')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('claim')
        .setDescription('Claim a task to work on')
        .addIntegerOption(option =>
          option.setName('task_id')
            .setDescription('Task ID to claim')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (subcommand === 'create') {
      // Public reply - visible to all users in the channel
      await interaction.deferReply({ ephemeral: false });
      try {
        // Check permissions - must be server owner
        const guild = await interaction.guild.fetch();
        if (interaction.user.id !== guild.ownerId) {
          return interaction.editReply({
            content: '❌ Only the server owner can create bulk tasks.'
          });
        }

      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const payoutAmount = interaction.options.getNumber('payout');
      const currency = interaction.options.getString('currency');
      const slots = interaction.options.getInteger('slots');

      // Create the bulk task
      const taskId = await db.createBulkTask(
        guildId,
        title,
        description,
        payoutAmount,
        currency,
        slots,
        interaction.user.id
      );

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('✅ Bulk Task Created')
        .setDescription(`Task listing has been created and is now available for members to claim`)
        .addFields(
          { name: 'Task ID', value: `#${taskId}`, inline: true },
          { name: 'Title', value: title, inline: true },
          { name: 'Description', value: description },
          { name: 'Payout', value: `${payoutAmount} ${currency}`, inline: true },
          { name: 'Available Slots', value: `${slots}`, inline: true },
          { name: 'Status', value: '🟢 Active', inline: true },
          { name: 'Next Step', value: 'Members can claim this task using `/bulk-tasks claim task_id: ' + taskId + '`' }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Bulk task create error:', error);
      return interaction.editReply({
        content: `❌ Error: ${error.message}`
      });
    }
    }

    if (subcommand === 'list') {
      // Public reply - visible to all users in the channel
      await interaction.deferReply({ ephemeral: false });
      try {
        // Get all active tasks for this guild (server)
        const tasks = await db.getActiveBulkTasks(guildId);

      if (!tasks || tasks.length === 0) {
        return interaction.editReply({
          content: '📋 No available tasks at the moment.'
        });
      }

      let taskList = '';
      for (const task of tasks) {
        const availableSlots = task.total_slots - task.filled_slots;
        
        // Get user's claimed slots for this task
        const userAssignments = await db.getUserAssignmentsForTask(task.id, interaction.user.id);
        const userSlots = userAssignments.length;
        
        taskList += `**#${task.id}** - ${task.title}\n`;
        taskList += `💰 Payout: ${task.payout_amount} ${task.payout_currency} per slot\n`;
        taskList += `📍 Available Slots: ${availableSlots}/${task.total_slots}`;
        if (userSlots > 0) {
          taskList += ` | 🎯 You claimed: ${userSlots} slot${userSlots > 1 ? 's' : ''}`;
        }
        taskList += `\n${task.description}\n\n`;
      }

      const embed = new EmbedBuilder()
        .setColor('#14F195')
        .setTitle('📋 Available Tasks')
        .setDescription(taskList || 'No tasks available')
        .setFooter({ text: 'Use /bulk-tasks claim to claim a task' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Bulk task list error:', error);
      return interaction.editReply({
        content: `❌ Error: ${error.message}`
      });
    }
    }

    if (subcommand === 'claim') {
      const taskId = interaction.options.getInteger('task_id');
      
      // Get the task
      const task = await db.getBulkTask(taskId);
      
      if (!task) {
        return interaction.reply({
          content: `❌ Task #${taskId} not found.`,
          ephemeral: true
        });
      }

      if (task.guild_id !== guildId) {
        return interaction.reply({
          content: '❌ This task is not available in this server.',
          ephemeral: true
        });
      }

      // Check if slots are available
      if (task.filled_slots >= task.total_slots) {
        return interaction.reply({
          content: `❌ Task #${taskId} is full - all slots have been claimed.`,
          ephemeral: true
        });
      }

      // Get user's current claims for this task
      const userAssignments = await db.getUserAssignmentsForTask(taskId, interaction.user.id);
      const userClaimedSlots = userAssignments.length;

      // Assign task to user (each assignment = 1 slot)
      const assignmentId = await db.assignTaskToUser(taskId, guildId, interaction.user.id, interaction.channelId);
      const newSlotNumber = userClaimedSlots + 1;
      const remainingSlots = task.total_slots - task.filled_slots - 1;

      const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Slot Claimed!')
        .setDescription(`You have successfully claimed 1 slot from task #${taskId}`)
        .addFields(
          { name: 'Task', value: task.title },
          { name: 'Description', value: task.description },
          { name: 'Payout Per Slot', value: `${task.payout_amount} ${task.payout_currency}`, inline: true },
          { name: 'Your Slots for This Task', value: `${newSlotNumber}`, inline: true },
          { name: 'Remaining Slots', value: `${remainingSlots}/${task.total_slots}`, inline: true },
          { name: 'Slot Assignment ID', value: `#${assignmentId}` },
          { name: 'Next Steps', value: '1. Use `/submit-proof assignment_id: ' + assignmentId + '` to submit proof for this slot\n2. You can claim more slots with `/bulk-tasks claim` if available' }
        )
        .setFooter({ text: 'Each slot requires separate proof submission' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: false });
    }
  }
};
