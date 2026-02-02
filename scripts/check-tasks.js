/**
 * Diagnostic script to check all bulk tasks in the database
 * Usage: node scripts/check-tasks.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../payroll.db');
const db = new sqlite3.Database(dbPath);

console.log('🔍 Checking all bulk tasks in database...\n');

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
    console.log(`Task #${task.id}:`);
    console.log(`  Title: ${task.title}`);
    console.log(`  Description: ${task.description}`);
    console.log(`  Payout: ${task.payout_amount} ${task.payout_currency}`);
    console.log(`  Slots: ${task.filled_slots}/${task.total_slots}`);
    console.log(`  Status: ${task.status}`);
    console.log(`  Guild ID: ${task.guild_id}`);
    console.log(`  Created By: ${task.created_by}`);
    console.log(`  Created At: ${task.created_at}`);
    console.log('');
  });

  // Check for Task #5 specifically
  const task5 = rows.find(t => t.id === 5);
  if (task5) {
    console.log('✅ Task #5 found!');
    console.log(`   Created by: ${task5.created_by}`);
    console.log(`   Guild: ${task5.guild_id}`);
    console.log(`   Status: ${task5.status}`);
  } else {
    console.log('❌ Task #5 not found in database');
  }

  // Check for tasks by creator 1075818871149305966
  const userTasks = rows.filter(t => t.created_by === '1075818871149305966');
  if (userTasks.length > 0) {
    console.log(`\n✅ Found ${userTasks.length} task(s) created by user 1075818871149305966:`);
    userTasks.forEach(t => {
      console.log(`   - Task #${t.id}: ${t.title} (Status: ${t.status}, Guild: ${t.guild_id})`);
    });
  } else {
    console.log('\n❌ No tasks found created by user 1075818871149305966');
  }

  db.close();
});
