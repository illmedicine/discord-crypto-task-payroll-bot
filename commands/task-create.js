const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('../utils/crypto');

// Simple in-memory task storage (replace with database in production)
const tasks = new Map();
let taskId = 1;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('task')
    .setDescription('Manage payroll tasks')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new payroll task')
        .addStringOption(option =>
          option.setName('recipient')
            .setDescription('Recipient Solana wallet address')
            .setRequired(true)
        )
        .addNumberOption(option =>
          option.setName('amount')
            .setDescription('Amount in SOL to send')
            .setRequired(true)
            .setMinValue(0.001)
        )
        .addStringOption(option =>
          option.setName('description')
            .setDescription('Task description (e.g., "Salary Payment")')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all pending tasks')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('info')
        .setDescription('Get info about a specific task')
        .addStringOption(option =>
          option.setName('task_id')
            .setDescription('Task ID to view')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'create') {
      const recipient = interaction.options.getString('recipient');
      const amount = interaction.options.getNumber('amount');
      const description = interaction.options.getString('description') || 'Payroll Payment';

      // Validate Solana address
      if (!crypto.isValidSolanaAddress(recipient)) {
        return interaction.reply({
          content: '❌ Invalid Solana address. Please check and try again.',
          ephemeral: true
        });
      }

      // Check sender has sufficient balance
      const wallet = crypto.getWallet();
      if (!wallet) {
        return interaction.reply({
          content: '❌ Bot wallet not configured.',
          ephemeral: true
        });
      }

      const balance = await crypto.getBalance(wallet.publicKey.toString());
      if (balance < amount) {
        return interaction.reply({
          content: `❌ Insufficient balance. Current balance: ${balance.toFixed(4)} SOL, Required: ${amount} SOL`,
          ephemeral: true
        });
      }

      // Create task
      const id = taskId++;
      const task = {
        id,
        creator: interaction.user.id,
        creatorName: interaction.user.username,
        recipient,
        amount,
        description,
        status: 'pending',
        createdAt: new Date().toISOString(),
        executedAt: null,
        signature: null
      };

      tasks.set(id, task);

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('📋 Payroll Task Created')
        .setDescription(`Task #${id} has been created`)
        .addFields(
          { name: 'Recipient', value: `\`${recipient}\`` },
          { name: 'Amount', value: `${amount} SOL`, inline: true },
          { name: 'Status', value: '⏳ Pending Approval', inline: true },
          { name: 'Description', value: description },
          { name: 'Created By', value: interaction.user.username },
          { name: 'Task ID', value: `#${id}`, inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'list') {
      if (tasks.size === 0) {
        return interaction.reply({
          content: '📋 No tasks found.',
          ephemeral: true
        });
      }

      let taskList = '';
      for (const [id, task] of tasks) {
        taskList += `**#${id}** - ${task.description} | ${task.amount} SOL → \`${task.recipient.slice(0, 8)}...\` | Status: ${task.status}\n`;
      }

      const embed = new EmbedBuilder()
        .setColor('#14F195')
        .setTitle('📋 All Payroll Tasks')
        .setDescription(taskList)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'info') {
      const taskIdStr = interaction.options.getString('task_id');
      const taskNum = parseInt(taskIdStr);
      const task = tasks.get(taskNum);

      if (!task) {
        return interaction.reply({
          content: `❌ Task #${taskNum} not found.`,
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setColor('#14F195')
        .setTitle(`📋 Task #${task.id} Details`)
        .addFields(
          { name: 'Description', value: task.description },
          { name: 'Recipient', value: `\`${task.recipient}\`` },
          { name: 'Amount', value: `${task.amount} SOL` },
          { name: 'Status', value: task.status === 'pending' ? '⏳ Pending' : '✅ Executed' },
          { name: 'Created By', value: task.creatorName },
          { name: 'Created At', value: new Date(task.createdAt).toLocaleString() },
          ...(task.signature ? [{ name: 'Signature', value: `\`${task.signature.slice(0, 20)}...\`` }] : [])
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }
  }
};

// Export tasks map for use in other commands
module.exports.tasks = tasks;
