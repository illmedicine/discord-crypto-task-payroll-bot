// Diagnostic script to check contests in database
// Run on Railway: node scripts/check-contests.js

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, '..', 'payroll.db');
const db = new sqlite3.Database(dbPath);

console.log('='.repeat(60));
console.log('CONTEST DIAGNOSTIC');
console.log('='.repeat(60));
console.log(`Database: ${dbPath}`);
console.log('');

// Check all contests
db.all(`SELECT * FROM contests ORDER BY id`, [], (err, contests) => {
  if (err) {
    console.error('Error querying contests:', err);
    return;
  }
  
  console.log(`Total contests found: ${contests?.length || 0}`);
  console.log('');
  
  if (contests && contests.length > 0) {
    contests.forEach(contest => {
      console.log(`Contest #${contest.id}: ${contest.title}`);
      console.log(`  Guild ID: ${contest.guild_id}`);
      console.log(`  Channel ID: ${contest.channel_id}`);
      console.log(`  Message ID: ${contest.message_id || 'NOT SET'}`);
      console.log(`  Status: ${contest.status}`);
      console.log(`  Entries: ${contest.current_entries}/${contest.max_entries}`);
      console.log(`  Ends at: ${contest.ends_at}`);
      console.log(`  Created by: ${contest.created_by}`);
      console.log('');
    });
  }
  
  // Check contest entries
  db.all(`SELECT * FROM contest_entries ORDER BY contest_id`, [], (err, entries) => {
    if (err) {
      console.log('No contest_entries table or error:', err.message);
    } else {
      console.log(`Total contest entries: ${entries?.length || 0}`);
      if (entries && entries.length > 0) {
        entries.forEach(e => {
          console.log(`  Entry #${e.id}: Contest ${e.contest_id}, User ${e.user_id}`);
        });
      }
    }
    
    console.log('');
    console.log('='.repeat(60));
    console.log('YOUR SERVER GUILD ID: 1454132493006409942');
    console.log('If contests have different guild_id, run fix-contest-guild-id.js');
    console.log('='.repeat(60));
    
    db.close();
  });
});
