/**
 * Script to check tasks created by a specific user on Railway
 * Usage: node scripts/check-user-tasks.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../payroll.db');
const db = new sqlite3.Database(dbPath);

const USER_ID = '1075818871149305966';

console.log(`🔍 Checking tasks created by user ${USER_ID}...\n`);

db.all(
  'SELECT * FROM bulk_tasks WHERE created_by = ? ORDER BY id DESC',
  [USER_ID],
  (err, rows) => {
    if (err) {
      console.error('❌ Error:', err);
      db.close();
      return;
    }

    if (!rows || rows.length === 0) {
      console.log(`❌ No tasks found created by user ${USER_ID}`);
      db.close();
      return;
    }

    console.log(`✅ Found ${rows.length} task(s) created by user ${USER_ID}:\n`);
    
    rows.forEach(task => {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Task #${task.id}: ${task.title}`);
      console.log(`  Description: ${task.description}`);
      console.log(`  Payout: ${task.payout_amount} ${task.payout_currency}`);
      console.log(`  Slots: ${task.filled_slots}/${task.total_slots}`);
      console.log(`  Status: ${task.status}`);
      console.log(`  Guild ID: ${task.guild_id}`);
      console.log(`  Created At: ${task.created_at}`);
      console.log('');
    });

    db.close();
  }
);
