/**
 * Diagnostic script to check Railway database via Discord bot
 * Run this on Railway terminal to see all tasks
 * Usage: node scripts/check-railway-tasks.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../payroll.db');
const db = new sqlite3.Database(dbPath);

console.log('🔍 Checking Railway database for all bulk tasks...\n');
console.log(`Database path: ${dbPath}\n`);

// Check all tasks
db.all('SELECT * FROM bulk_tasks ORDER BY id DESC', [], (err, rows) => {
  if (err) {
    console.error('❌ Error:', err);
    db.close();
    return;
  }

  if (!rows || rows.length === 0) {
    console.log('📋 No tasks found in database');
    db.close();
    return;
  }

  console.log(`📋 Found ${rows.length} total task(s):\n`);
  
  rows.forEach(task => {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Task #${task.id}: ${task.title}`);
    console.log(`  Description: ${task.description}`);
    console.log(`  Payout: ${task.payout_amount} ${task.payout_currency}`);
    console.log(`  Slots: ${task.filled_slots}/${task.total_slots}`);
    console.log(`  Status: ${task.status}`);
    console.log(`  Guild ID: ${task.guild_id}`);
    console.log(`  Created By: ${task.created_by}`);
    console.log(`  Created At: ${task.created_at}`);
  });
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Group by guild
  const guilds = {};
  rows.forEach(task => {
    if (!guilds[task.guild_id]) {
      guilds[task.guild_id] = [];
    }
    guilds[task.guild_id].push(task);
  });

  console.log('📊 Tasks by Guild/Server:');
  Object.keys(guilds).forEach(guildId => {
    console.log(`\n  Guild ${guildId}: ${guilds[guildId].length} task(s)`);
    guilds[guildId].forEach(t => {
      console.log(`    - Task #${t.id}: ${t.title} (${t.status})`);
    });
  });

  // Check specifically for server 1454132493006409942
  const server1Tasks = rows.filter(t => t.guild_id === '1454132493006409942');
  console.log(`\n🔍 Tasks for server 1454132493006409942: ${server1Tasks.length}`);
  if (server1Tasks.length > 0) {
    server1Tasks.forEach(t => {
      console.log(`  ✅ Task #${t.id}: ${t.title}`);
    });
  } else {
    console.log('  ❌ No tasks found for this server');
  }

  db.close();
});
