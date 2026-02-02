/**
 * Script to retroactively notify members about bulk tasks that were removed
 * before the notification feature was implemented.
 * 
 * Usage: node scripts/notify-removed-tasks.js
 */

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();

// Configure the removed tasks here
const REMOVED_TASKS = [
  {
    taskId: 3,
    title: 'Add Discrypto Bot',
    payoutAmount: 1,
    payoutCurrency: 'USD',
    reason: 'Jacob deleted by accident',
    guildId: '1459252801464041554',
    channelId: '1454144204082249789',
    affectedUsers: ['1317437712139292684']
  },
  {
    taskId: 4,
    title: 'Bulk Task #4', // UPDATE: Replace with actual task #4 title if known
    payoutAmount: 1, // UPDATE: Replace with actual payout amount if different
    payoutCurrency: 'USD', // UPDATE: Replace with actual currency if different (SOL or USD)
    reason: 'Jacob deleted by accident',
    guildId: '1459252801464041554',
    channelId: '1454144204082249789',
    affectedUsers: ['1317437712139292684']
  }
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

async function notifyRemovedTasks() {
  console.log('🔄 Starting retroactive notifications for removed tasks...\n');

  for (const task of REMOVED_TASKS) {
    try {
      console.log(`📋 Processing task #${task.taskId}: ${task.title}`);
      
      const channel = await client.channels.fetch(task.channelId);
      if (!channel || !channel.isTextBased()) {
        console.log(`  ❌ Channel ${task.channelId} not found or not a text channel`);
        continue;
      }

      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('⚠️ Bulk Task Removed (Retroactive Notification)')
        .setDescription(`Bulk task #${task.taskId} was removed earlier today by the treasury owner.`)
        .addFields(
          { name: '📋 Task', value: task.title },
          { name: '💰 Payout', value: `${task.payoutAmount} ${task.payoutCurrency}`, inline: true },
          { name: '📝 Reason', value: task.reason },
          { name: 'Impact', value: 'All claims and pending proofs for this task have been removed.' },
          { name: 'Note', value: 'This is a retroactive notification for a task removed before the notification system was updated.' }
        )
        .setTimestamp();

      const mentions = task.affectedUsers && task.affectedUsers.length > 0
        ? task.affectedUsers.map(id => `<@${id}>`).join(', ')
        : '@here';

      await channel.send({
        content: mentions,
        embeds: [embed]
      });

      console.log(`  ✅ Notification posted in ${channel.name}`);
    } catch (error) {
      console.error(`  ❌ Error processing task #${task.taskId}:`, error.message);
    }
  }

  console.log('\n✅ All retroactive notifications completed!');
  process.exit(0);
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}\n`);
  await notifyRemovedTasks();
});

client.login(process.env.DISCORD_TOKEN);
