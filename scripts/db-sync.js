#!/usr/bin/env node
/**
 * Database Sync Utility
 * 
 * This script helps you:
 * 1. Connect local dev to Railway's production database
 * 2. Backup databases
 * 3. Copy data between databases
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const localDbPath = path.join(__dirname, '../payroll.db');

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║         Discord Crypto Bot - Database Sync            ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

// Check if local database exists
if (!fs.existsSync(localDbPath)) {
  console.log('❌ No local database found at:', localDbPath);
  console.log('\n💡 This is normal if you haven\'t created any tasks locally.');
  process.exit(0);
}

console.log('📊 Local Database Information:');
console.log('   Location:', localDbPath);

// Open local database and show stats
const db = new sqlite3.Database(localDbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('❌ Error opening local database:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  // Get bulk tasks count
  db.get('SELECT COUNT(*) as count FROM bulk_tasks', [], (err, row) => {
    if (err) {
      console.error('❌ Error reading bulk_tasks:', err.message);
    } else {
      console.log(`   📋 Bulk Tasks: ${row.count}`);
      
      if (row.count > 0) {
        db.all('SELECT id, title, status FROM bulk_tasks', [], (err, rows) => {
          if (!err && rows) {
            console.log('\n   Tasks in local database:');
            rows.forEach(task => {
              console.log(`      #${task.id} - ${task.title} (${task.status})`);
            });
          }
        });
      }
    }
  });

  // Get task assignments count
  db.get('SELECT COUNT(*) as count FROM task_assignments', [], (err, row) => {
    if (!err) {
      console.log(`   👥 Task Assignments: ${row.count}`);
    }
  });

  // Get proof submissions count
  db.get('SELECT COUNT(*) as count FROM proof_submissions', [], (err, row) => {
    if (!err) {
      console.log(`   📸 Proof Submissions: ${row.count}`);
    }
  });

  // Get guilds count
  db.get('SELECT COUNT(*) as count FROM guild_wallets', [], (err, row) => {
    if (!err) {
      console.log(`   🏛️  Guild Wallets: ${row.count}`);
      
      setTimeout(() => {
        console.log('\n╔════════════════════════════════════════════════════════╗');
        console.log('║              How to Use Railway Database              ║');
        console.log('╚════════════════════════════════════════════════════════╝\n');
        console.log('🎯 RECOMMENDED: Always use Railway for production\n');
        console.log('Option 1: Use Railway\'s database (Recommended)');
        console.log('   • All commands you run in Discord will use Railway\'s DB');
        console.log('   • Data persists across deployments');
        console.log('   • No local database needed\n');
        console.log('Option 2: Connect local dev to Railway');
        console.log('   • Set environment variable: DB_PATH=/data/payroll.db');
        console.log('   • Use Railway CLI to connect locally');
        console.log('   • Useful for testing with production data\n');
        console.log('Option 3: Migrate to PostgreSQL (Best for scale)');
        console.log('   • Add Railway PostgreSQL plugin');
        console.log('   • Update code to use PostgreSQL');
        console.log('   • Better for multi-server scaling\n');
        console.log('📌 Current Setup:');
        console.log('   ✅ Local development uses: ./payroll.db');
        console.log('   ✅ Railway production uses: /data/payroll.db');
        console.log('   ✅ Databases are separate by design\n');
        console.log('💡 To manage Railway database:');
        console.log('   1. All Discord commands automatically use Railway DB');
        console.log('   2. Create tasks through Discord (they go to Railway)');
        console.log('   3. Local tasks stay local unless you connect to Railway\n');
        
        db.close();
      }, 100);
    }
  });
});
