// Fix contest guild_id mismatch
// Run on Railway: node scripts/fix-contest-guild-id.js

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, '..', 'payroll.db');
const db = new sqlite3.Database(dbPath);

// Your actual server guild_id
const CORRECT_GUILD_ID = '1454132493006409942';

console.log('='.repeat(60));
console.log('FIX CONTEST GUILD IDs');
console.log('='.repeat(60));
console.log(`Correct Guild ID: ${CORRECT_GUILD_ID}`);
console.log('');

// Update all contests to use the correct guild_id
db.run(
  `UPDATE contests SET guild_id = ? WHERE guild_id != ?`,
  [CORRECT_GUILD_ID, CORRECT_GUILD_ID],
  function(err) {
    if (err) {
      console.error('Error updating contests:', err);
    } else {
      console.log(`Updated ${this.changes} contest(s) with correct guild_id`);
    }
    
    // Also update contest_entries
    db.run(
      `UPDATE contest_entries SET guild_id = ? WHERE guild_id != ?`,
      [CORRECT_GUILD_ID, CORRECT_GUILD_ID],
      function(err) {
        if (err) {
          console.log('Error updating contest_entries (may not exist):', err.message);
        } else {
          console.log(`Updated ${this.changes} contest entry(s) with correct guild_id`);
        }
        
        // Verify
        db.all(`SELECT id, title, guild_id, status FROM contests`, [], (err, contests) => {
          console.log('');
          console.log('Contests after fix:');
          if (contests) {
            contests.forEach(c => {
              console.log(`  #${c.id}: ${c.title} - guild_id: ${c.guild_id} - status: ${c.status}`);
            });
          }
          console.log('');
          console.log('Done! Try /contest refresh 1 again.');
          db.close();
        });
      }
    );
  }
);
