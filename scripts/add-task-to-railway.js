/**
 * Script to add a bulk task directly to Railway database
 * Edit the task details below, then run on Railway terminal:
 * node scripts/add-task-to-railway.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../payroll.db');
const db = new sqlite3.Database(dbPath);

// ============================================
// EDIT THIS TASK INFORMATION
// ============================================
const newTask = {
  title: 'Task #5 Title Here',                    // UPDATE: Enter the task title
  description: 'Task description here',            // UPDATE: Enter the description
  payout_amount: 1,                                // UPDATE: Enter payout amount
  payout_currency: 'USD',                          // UPDATE: SOL or USD
  total_slots: 10,                                 // UPDATE: Number of available slots
  filled_slots: 0,                                 // Keep as 0 for new tasks
  created_by: '1075818871149305966',              // User ID who created it
  status: 'active',                                // Keep as 'active'
  guild_id: '1454132493006409942'                 // Server ID
};
// ============================================

console.log('📝 Adding new bulk task to Railway database...\n');
console.log('Task details:');
console.log(`  Title: ${newTask.title}`);
console.log(`  Description: ${newTask.description}`);
console.log(`  Payout: ${newTask.payout_amount} ${newTask.payout_currency}`);
console.log(`  Slots: ${newTask.total_slots}`);
console.log(`  Guild: ${newTask.guild_id}`);
console.log(`  Created By: ${newTask.created_by}\n`);

db.run(
  `INSERT INTO bulk_tasks (title, description, payout_amount, payout_currency, total_slots, filled_slots, created_by, status, guild_id, created_at) 
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  [
    newTask.title,
    newTask.description,
    newTask.payout_amount,
    newTask.payout_currency,
    newTask.total_slots,
    newTask.filled_slots,
    newTask.created_by,
    newTask.status,
    newTask.guild_id
  ],
  function(err) {
    if (err) {
      console.error('❌ Error creating task:', err.message);
      db.close();
      return;
    }
    
    console.log(`✅ Task created successfully with ID: ${this.lastID}\n`);
    
    // Verify the task was created
    db.get(
      `SELECT * FROM bulk_tasks WHERE id = ?`,
      [this.lastID],
      (err, row) => {
        if (err) {
          console.error('Error verifying task:', err);
        } else if (row) {
          console.log('✅ Verification - Task details:');
          console.log(`   ID: ${row.id}`);
          console.log(`   Title: ${row.title}`);
          console.log(`   Guild: ${row.guild_id}`);
          console.log(`   Status: ${row.status}`);
          console.log(`   Created: ${row.created_at}`);
        }
        
        // Show all tasks for this guild
        console.log(`\n📋 All tasks for guild ${newTask.guild_id}:`);
        db.all(
          `SELECT id, title, payout_amount, payout_currency, status FROM bulk_tasks WHERE guild_id = ? ORDER BY id`,
          [newTask.guild_id],
          (err, rows) => {
            if (err) {
              console.error('Error fetching tasks:', err);
            } else if (rows && rows.length > 0) {
              console.table(rows);
            } else {
              console.log('   No tasks found');
            }
            db.close();
          }
        );
      }
    );
  }
);
