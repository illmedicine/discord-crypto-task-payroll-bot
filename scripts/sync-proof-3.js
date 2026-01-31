const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../payroll.db');
const db = new sqlite3.Database(dbPath);

// First, create a task assignment if it doesn't exist
db.run(
  `INSERT OR IGNORE INTO task_assignments (id, bulk_task_id, guild_id, assigned_user_id, status, assigned_at) 
   VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  [3, 3, '1459252801464041554', 'test_user_123', 'submitted'],
  function(err) {
    if (err) {
      console.error('Error creating assignment:', err.message);
      return;
    }
    
    // Now create the proof submission
    db.run(
      `INSERT OR IGNORE INTO proof_submissions (id, task_assignment_id, guild_id, user_id, screenshot_url, verification_url, notes, status, submitted_at, approved_at, approved_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
      [
        3, // proof_id
        3, // task_assignment_id
        '1459252801464041554', // guild_id
        'test_user_123', // user_id
        'https://cdn.discordapp.com/attachments/screenshot.png', // screenshot_url
        'https://verification.url', // verification_url
        'Test proof submission', // notes
        'approved', // status
        'illymeds_user_id' // approved_by
      ],
      function(err) {
        if (err) {
          console.error('Error creating proof:', err.message);
        } else {
          console.log('✅ Proof #3 added to database');
          
          // Verify
          db.all(
            `SELECT ps.id as proof_id, ps.status, ta.bulk_task_id, bt.title 
             FROM proof_submissions ps 
             JOIN task_assignments ta ON ps.task_assignment_id = ta.id 
             JOIN bulk_tasks bt ON ta.bulk_task_id = bt.id 
             ORDER BY ps.id`,
            [],
            (err, rows) => {
              if (!err) {
                console.log('\n📋 All proof submissions:');
                console.table(rows);
              }
              db.close();
            }
          );
        }
      }
    );
  }
);
