const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./payroll.db');

console.log('Checking for tasks in server 1454132493006409942...\n');

db.all('SELECT * FROM bulk_tasks WHERE guild_id = ?', ['1454132493006409942'], (err, rows) => {
  if (err) {
    console.error('Error:', err);
  } else if (!rows || rows.length === 0) {
    console.log('❌ No tasks found for server 1454132493006409942 in local database');
  } else {
    console.log(`✅ Found ${rows.length} task(s) for server 1454132493006409942:\n`);
    rows.forEach(t => {
      console.log(`Task #${t.id}:`);
      console.log(`  Title: ${t.title}`);
      console.log(`  Description: ${t.description}`);
      console.log(`  Payout: ${t.payout_amount} ${t.payout_currency}`);
      console.log(`  Slots: ${t.filled_slots}/${t.total_slots}`);
      console.log(`  Status: ${t.status}`);
      console.log(`  Created By: ${t.created_by}`);
      console.log(`  Created At: ${t.created_at}\n`);
    });
  }
  db.close();
});
