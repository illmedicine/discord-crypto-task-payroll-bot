/**
 * Script to fix guild_id on bulk tasks
 * This updates the guild_id for specified tasks
 * Run on Railway terminal: node scripts/fix-task-guild-id.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../payroll.db');
const db = new sqlite3.Database(dbPath);

// ============================================
// CONFIGURATION
// ============================================
const CORRECT_GUILD_ID = '1454132493006409942';  // Your server ID
const TASK_IDS_TO_FIX = [5];  // Task IDs to update (add more as needed: [5, 6, 7])
// Or set to 'ALL_FROM_WRONG_GUILD' to fix all tasks from a different guild
const FIX_ALL_FROM_GUILD = '1459252801464041554';  // Old guild ID to fix
// ============================================

console.log('🔧 Fixing task guild IDs...\n');

function fixSpecificTasks() {
  console.log(`📝 Updating ${TASK_IDS_TO_FIX.length} task(s) to guild ${CORRECT_GUILD_ID}...`);
  
  const placeholders = TASK_IDS_TO_FIX.map(() => '?').join(',');
  
  // First, show what we're updating
  db.all(
    `SELECT id, title, guild_id FROM bulk_tasks WHERE id IN (${placeholders})`,
    TASK_IDS_TO_FIX,
    (err, rows) => {
      if (err) {
        console.error('❌ Error fetching tasks:', err);
        db.close();
        return;
      }
      
      if (!rows || rows.length === 0) {
        console.log('❌ No tasks found with the specified IDs');
        db.close();
        return;
      }
      
      console.log('\n📋 Tasks to update:');
      rows.forEach(t => {
        console.log(`  Task #${t.id}: ${t.title} (Current guild: ${t.guild_id})`);
      });
      
      // Update the tasks
      db.run(
        `UPDATE bulk_tasks SET guild_id = ? WHERE id IN (${placeholders})`,
        [CORRECT_GUILD_ID, ...TASK_IDS_TO_FIX],
        function(err) {
          if (err) {
            console.error('❌ Error updating tasks:', err);
            db.close();
            return;
          }
          
          console.log(`\n✅ Updated ${this.changes} task(s)\n`);
          
          // Verify the update
          db.all(
            `SELECT id, title, guild_id FROM bulk_tasks WHERE id IN (${placeholders})`,
            TASK_IDS_TO_FIX,
            (err, updatedRows) => {
              if (!err && updatedRows) {
                console.log('✅ Verified - Updated tasks:');
                updatedRows.forEach(t => {
                  console.log(`  Task #${t.id}: ${t.title} (Guild: ${t.guild_id})`);
                });
              }
              
              showAllTasksForGuild();
            }
          );
        }
      );
    }
  );
}

function fixAllFromWrongGuild() {
  console.log(`📝 Updating ALL tasks from guild ${FIX_ALL_FROM_GUILD} to ${CORRECT_GUILD_ID}...`);
  
  // First, show what we're updating
  db.all(
    `SELECT id, title, guild_id FROM bulk_tasks WHERE guild_id = ?`,
    [FIX_ALL_FROM_GUILD],
    (err, rows) => {
      if (err) {
        console.error('❌ Error fetching tasks:', err);
        db.close();
        return;
      }
      
      if (!rows || rows.length === 0) {
        console.log(`❌ No tasks found for guild ${FIX_ALL_FROM_GUILD}`);
        db.close();
        return;
      }
      
      console.log(`\n📋 Found ${rows.length} task(s) to update:`);
      rows.forEach(t => {
        console.log(`  Task #${t.id}: ${t.title}`);
      });
      
      // Update the tasks
      db.run(
        `UPDATE bulk_tasks SET guild_id = ? WHERE guild_id = ?`,
        [CORRECT_GUILD_ID, FIX_ALL_FROM_GUILD],
        function(err) {
          if (err) {
            console.error('❌ Error updating tasks:', err);
            db.close();
            return;
          }
          
          console.log(`\n✅ Updated ${this.changes} task(s)\n`);
          showAllTasksForGuild();
        }
      );
    }
  );
}

function showAllTasksForGuild() {
  console.log(`\n📊 All tasks for guild ${CORRECT_GUILD_ID}:`);
  db.all(
    `SELECT id, title, payout_amount, payout_currency, status, guild_id FROM bulk_tasks WHERE guild_id = ? ORDER BY id`,
    [CORRECT_GUILD_ID],
    (err, rows) => {
      if (err) {
        console.error('Error fetching tasks:', err);
      } else if (rows && rows.length > 0) {
        console.table(rows);
      } else {
        console.log('  No tasks found');
      }
      db.close();
    }
  );
}

// Determine which mode to run
if (FIX_ALL_FROM_GUILD && FIX_ALL_FROM_GUILD !== '') {
  fixAllFromWrongGuild();
} else {
  fixSpecificTasks();
}
