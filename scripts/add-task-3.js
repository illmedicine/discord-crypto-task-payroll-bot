const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../payroll.db');
const db = new sqlite3.Database(dbPath);

// Add task #3 as it was created on Railway
const task3 = {
  title: 'Add Discrypto Bot',
  description: 'to Server with 10 members or more',
  payout_amount: 1,
  payout_currency: 'USD',
  total_slots: 20,
  filled_slots: 0,
  created_by: 'system_sync',
  status: 'active',
  guild_id: '1318083332477583450' // Using a placeholder guild ID
};

db.run(
  `INSERT INTO bulk_tasks (title, description, payout_amount, payout_currency, total_slots, filled_slots, created_by, status, guild_id, created_at) 
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  [
    task3.title,
    task3.description,
    task3.payout_amount,
    task3.payout_currency,
    task3.total_slots,
    task3.filled_slots,
    task3.created_by,
    task3.status,
    task3.guild_id
  ],
  function(err) {
    if (err) {
      console.error('❌ Error creating task:', err.message);
    } else {
      console.log('✅ Task #3 "Add Discrypto Bot" created with ID:', this.lastID);
      
      // Verify all tasks
      db.all('SELECT id, title, payout_amount, payout_currency, total_slots FROM bulk_tasks ORDER BY id', [], (err, rows) => {
        if (err) {
          console.error('Error fetching tasks:', err);
        } else {
          console.log('\n📋 All tasks in database:');
          console.table(rows);
        }
        db.close();
      });
    }
  }
);
