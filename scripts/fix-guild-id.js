const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../payroll.db');
const db = new sqlite3.Database(dbPath);

const correctGuildId = '1459252801464041554';

// Update all tasks to use the correct guild ID
db.run(
  `UPDATE bulk_tasks SET guild_id = ? WHERE id IN (1, 2, 3)`,
  [correctGuildId],
  function(err) {
    if (err) {
      console.error('❌ Error updating tasks:', err.message);
    } else {
      console.log(`✅ Updated ${this.changes} task(s) with correct guild ID: ${correctGuildId}`);
      
      // Verify all tasks
      db.all('SELECT id, title, guild_id FROM bulk_tasks ORDER BY id', [], (err, rows) => {
        if (err) {
          console.error('Error fetching tasks:', err);
        } else {
          console.log('\n📋 All tasks now use guild ID:', correctGuildId);
          console.table(rows);
        }
        db.close();
      });
    }
  }
);
