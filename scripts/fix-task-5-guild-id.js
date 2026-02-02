/**
 * One-time script to update bulk_tasks.id = 5 to the correct guild.
 *
 * Usage:
 *  - Make sure payroll.db is in the repo root (same location as other scripts assume).
 *  - This script creates a backup payroll.db.fix-task-5.bak before making changes.
 *  - Run: node scripts/fix-task-5-guild-id.js
 *
 * This script intentionally only updates id = 5 and nothing else.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_FILENAME = path.join(__dirname, '../payroll.db');
const BACKUP_FILENAME = path.join(__dirname, '../payroll.db.fix-task-5.bak');

const TARGET_TASK_ID = 5;
const CORRECT_GUILD_ID = '1454132493006409942';

function exitWith(code = 0) {
  process.exit(code);
}

try {
  if (!fs.existsSync(DB_FILENAME)) {
    console.error(`❌ payroll.db not found at ${DB_FILENAME}`);
    exitWith(2);
  }

  // Backup
  fs.copyFileSync(DB_FILENAME, BACKUP_FILENAME);
  console.log(`🔒 Backup created: ${BACKUP_FILENAME}`);

  const db = new sqlite3.Database(DB_FILENAME);

  db.get(
    `SELECT id, title, guild_id FROM bulk_tasks WHERE id = ?`,
    [TARGET_TASK_ID],
    (err, row) => {
      if (err) {
        console.error('❌ Error reading task:', err);
        db.close();
        exitWith(3);
      }

      if (!row) {
        console.log(`❌ No task found with id = ${TARGET_TASK_ID}. Nothing to do.`);
        db.close();
        exitWith(0);
      }

      console.log('🔎 Current task record:');
      console.log(`  id: ${row.id}`);
      console.log(`  title: ${row.title}`);
      console.log(`  guild_id: ${row.guild_id}`);

      if (String(row.guild_id) === CORRECT_GUILD_ID) {
        console.log(`✅ Task #${TARGET_TASK_ID} already has guild_id = ${CORRECT_GUILD_ID}. No update needed.`);
        db.close();
        exitWith(0);
      }

      // Perform the one-time update
      db.run(
        `UPDATE bulk_tasks SET guild_id = ? WHERE id = ?`,
        [CORRECT_GUILD_ID, TARGET_TASK_ID],
        function (updateErr) {
          if (updateErr) {
            console.error('❌ Error updating task:', updateErr);
            db.close();
            exitWith(4);
          }

          console.log(`✅ Updated ${this.changes} row(s).`);

          // Verify
          db.get(
            `SELECT id, title, guild_id FROM bulk_tasks WHERE id = ?`,
            [TARGET_TASK_ID],
            (verifyErr, updatedRow) => {
              if (verifyErr) {
                console.error('❌ Error verifying update:', verifyErr);
                db.close();
                exitWith(5);
              }

              console.log('🔎 After update:');
              console.log(`  id: ${updatedRow.id}`);
              console.log(`  title: ${updatedRow.title}`);
              console.log(`  guild_id: ${updatedRow.guild_id}`);

              db.close();
              console.log('🎉 One-time fix complete. Keep payroll.db.fix-task-5.bak until you confirm everything is OK.');
              exitWith(0);
            }
          );
        }
      );
    }
  );
} catch (e) {
  console.error('❌ Unexpected error:', e);
  exitWith(10);
}
