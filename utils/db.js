const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Use the same database file for both local and Railway
// This allows committing the database to git for deployment
const getDbPath = () => {
  // If DB_PATH is set, use it (for advanced configuration)
  if (process.env.DB_PATH) {
    console.log(`[DB] Using custom database path: ${process.env.DB_PATH}`);
    return process.env.DB_PATH;
  }
  
  // Use payroll.db in app directory for both local and Railway
  const dbPath = path.join(__dirname, '../payroll.db');
  
  if (process.env.RAILWAY_ENVIRONMENT) {
    console.log(`[DB] Railway mode - Using: ${dbPath}`);
  } else {
    console.log(`[DB] Development mode - Using: ${dbPath}`);
  }
  
  return dbPath;
};

const dbPath = getDbPath();

// Ensure directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  console.log(`[DB] Creating directory: ${dbDir}`);
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[DB] Error opening database:', err);
    console.error('[DB] Database path:', dbPath);
  } else {
    console.log('[DB] ✅ Database connection established');
    console.log('[DB] 📁 Database file location:', dbPath);
  }
});

// Initialize database tables
const initDb = () => {
  db.serialize(() => {
    // Guild/Server Treasury Wallets - one wallet per Discord server (multiple servers can use same wallet)
    db.run(`
      CREATE TABLE IF NOT EXISTS guild_wallets (
        guild_id TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        configured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        configured_by TEXT
      )
    `);

    // Guild Settings - approve roles, etc
    db.run(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        approved_roles TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id)
      )
    `);

    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        discord_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        solana_address TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Bulk Tasks - reusable task templates
    db.run(`
      CREATE TABLE IF NOT EXISTS bulk_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        payout_amount REAL NOT NULL,
        payout_currency TEXT DEFAULT 'SOL',
        total_slots INTEGER,
        filled_slots INTEGER DEFAULT 0,
        created_by TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id),
        FOREIGN KEY(created_by) REFERENCES users(discord_id)
      )
    `);

    // Task Assignments - users claiming tasks
    db.run(`
      CREATE TABLE IF NOT EXISTS task_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bulk_task_id INTEGER NOT NULL,
        guild_id TEXT NOT NULL,
        assigned_user_id TEXT NOT NULL,
        status TEXT DEFAULT 'assigned',
        assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(bulk_task_id) REFERENCES bulk_tasks(id),
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id),
        FOREIGN KEY(assigned_user_id) REFERENCES users(discord_id)
      )
    `);

    // Proof Submissions - proof of task completion
    db.run(`
      CREATE TABLE IF NOT EXISTS proof_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_assignment_id INTEGER NOT NULL,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        screenshot_url TEXT,
        verification_url TEXT,
        notes TEXT,
        status TEXT DEFAULT 'pending',
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_at DATETIME,
        approved_by TEXT,
        rejection_reason TEXT,
        FOREIGN KEY(task_assignment_id) REFERENCES task_assignments(id),
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id),
        FOREIGN KEY(user_id) REFERENCES users(discord_id),
        FOREIGN KEY(approved_by) REFERENCES users(discord_id)
      )
    `);

    // Tasks table (legacy)
    db.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        creator_id TEXT NOT NULL,
        recipient_address TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        transaction_signature TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        executed_at DATETIME,
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id),
        FOREIGN KEY(creator_id) REFERENCES users(discord_id)
      )
    `);

    // Transactions table
    db.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        amount REAL NOT NULL,
        signature TEXT UNIQUE,
        status TEXT DEFAULT 'confirmed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id)
      )
    `);

    // Wallet history table
    db.run(`
      CREATE TABLE IF NOT EXISTS wallet_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        action TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id)
      )
    `);

    // Auto-approve settings per bulk task
    db.run(`
      CREATE TABLE IF NOT EXISTS auto_approve_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bulk_task_id INTEGER NOT NULL UNIQUE,
        guild_id TEXT NOT NULL,
        auto_approve_enabled INTEGER DEFAULT 0,
        require_screenshot INTEGER DEFAULT 1,
        require_verification_url INTEGER DEFAULT 0,
        enabled_by TEXT NOT NULL,
        enabled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(bulk_task_id) REFERENCES bulk_tasks(id),
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id),
        FOREIGN KEY(enabled_by) REFERENCES users(discord_id)
      )
    `);
  });
};

// Guild Wallet operations
const setGuildWallet = (guildId, walletAddress, configuredByUserId) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO guild_wallets (guild_id, wallet_address, configured_by) VALUES (?, ?, ?)`,
      [guildId, walletAddress, configuredByUserId],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

const getGuildWallet = (guildId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM guild_wallets WHERE guild_id = ?`,
      [guildId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
};

// Guild Settings operations
const setApprovedRoles = (guildId, roleIds) => {
  return new Promise((resolve, reject) => {
    const rolesJson = JSON.stringify(roleIds);
    db.run(
      `INSERT OR REPLACE INTO guild_settings (guild_id, approved_roles) VALUES (?, ?)`,
      [guildId, rolesJson],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

const getApprovedRoles = (guildId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT approved_roles FROM guild_settings WHERE guild_id = ?`,
      [guildId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? JSON.parse(row.approved_roles || '[]') : []);
      }
    );
  });
};

// Bulk Task operations
const createBulkTask = (guildId, title, description, payoutAmount, payoutCurrency, totalSlots, createdBy) => {
  return new Promise((resolve, reject) => {
    console.log(`[db.createBulkTask] Creating task for guild ${guildId}: ${title}`);
    db.run(
      `INSERT INTO bulk_tasks (guild_id, title, description, payout_amount, payout_currency, total_slots, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [guildId, title, description, payoutAmount, payoutCurrency, totalSlots, createdBy],
      function (err) {
        if (err) {
          console.error(`[db.createBulkTask] Error:`, err);
          reject(err);
        } else {
          console.log(`[db.createBulkTask] Created task with ID: ${this.lastID}`);
          resolve(this.lastID);
        }
      }
    );
  });
};

const getActiveBulkTasks = (guildId) => {
  return new Promise((resolve, reject) => {
    console.log(`[db.getActiveBulkTasks] Querying for guild: ${guildId}`);
    db.all(
      `SELECT * FROM bulk_tasks WHERE guild_id = ? AND status = 'active' ORDER BY created_at DESC`,
      [guildId],
      (err, rows) => {
        if (err) {
          console.error(`[db.getActiveBulkTasks] Error:`, err);
          reject(err);
        } else {
          console.log(`[db.getActiveBulkTasks] Found ${rows?.length || 0} tasks:`, rows);
          resolve(rows || []);
        }
      }
    );
  });
};

const getAllBulkTasks = (guildId) => {
  return new Promise((resolve, reject) => {
    console.log(`[db.getAllBulkTasks] Querying ALL tasks for guild: ${guildId}`);
    db.all(
      `SELECT * FROM bulk_tasks WHERE guild_id = ? ORDER BY created_at DESC`,
      [guildId],
      (err, rows) => {
        if (err) {
          console.error(`[db.getAllBulkTasks] Error:`, err);
          reject(err);
        } else {
          console.log(`[db.getAllBulkTasks] Found ${rows?.length || 0} total tasks:`, rows);
          resolve(rows || []);
        }
      }
    );
  });
};

const getBulkTask = (taskId) => {
  return new Promise((resolve, reject) => {
    console.log(`[db.getBulkTask] Querying for task ID: ${taskId} (type: ${typeof taskId})`);
    db.get(
      `SELECT * FROM bulk_tasks WHERE id = ?`,
      [taskId],
      (err, row) => {
        if (err) {
          console.error(`[db.getBulkTask] Error:`, err);
          reject(err);
        } else {
          console.log(`[db.getBulkTask] Result:`, row);
          resolve(row);
        }
      }
    );
  });
};

// Task Assignment operations
const assignTaskToUser = (bulkTaskId, guildId, userId) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO task_assignments (bulk_task_id, guild_id, assigned_user_id) VALUES (?, ?, ?)`,
      [bulkTaskId, guildId, userId],
      function (err) {
        if (err) reject(err);
        else {
          // Update filled slots
          db.run(`UPDATE bulk_tasks SET filled_slots = filled_slots + 1 WHERE id = ?`, [bulkTaskId]);
          resolve(this.lastID);
        }
      }
    );
  });
};

const getUserAssignment = (bulkTaskId, userId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM task_assignments WHERE bulk_task_id = ? AND assigned_user_id = ?`,
      [bulkTaskId, userId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
};

const getUserAssignments = (userId, guildId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT ta.*, bt.* FROM task_assignments ta 
       JOIN bulk_tasks bt ON ta.bulk_task_id = bt.id 
       WHERE ta.assigned_user_id = ? AND ta.guild_id = ?`,
      [userId, guildId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const getAssignment = (assignmentId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT ta.*, bt.title, bt.payout_amount, bt.payout_currency, bt.description, bt.status as task_status
       FROM task_assignments ta
       JOIN bulk_tasks bt ON ta.bulk_task_id = bt.id
       WHERE ta.id = ?`,
      [assignmentId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
};

// Proof Submission operations
const submitProof = (taskAssignmentId, guildId, userId, screenshotUrl, verificationUrl, notes) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO proof_submissions (task_assignment_id, guild_id, user_id, screenshot_url, verification_url, notes) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [taskAssignmentId, guildId, userId, screenshotUrl, verificationUrl, notes],
      function (err) {
        if (err) reject(err);
        else {
          // Update assignment status
          db.run(`UPDATE task_assignments SET status = 'submitted' WHERE id = ?`, [taskAssignmentId]);
          resolve(this.lastID);
        }
      }
    );
  });
};

const getPendingProofs = (guildId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT ps.*, ta.assigned_user_id, bt.title FROM proof_submissions ps
       JOIN task_assignments ta ON ps.task_assignment_id = ta.id
       JOIN bulk_tasks bt ON ta.bulk_task_id = bt.id
       WHERE ps.guild_id = ? AND ps.status = 'pending' ORDER BY ps.submitted_at DESC`,
      [guildId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const getProofSubmission = (proofId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT ps.*, ta.bulk_task_id, ta.assigned_user_id, bt.title, bt.payout_amount, bt.payout_currency 
       FROM proof_submissions ps
       JOIN task_assignments ta ON ps.task_assignment_id = ta.id
       JOIN bulk_tasks bt ON ta.bulk_task_id = bt.id
       WHERE ps.id = ?`,
      [proofId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
};

const approveProof = (proofId, approvedBy) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE proof_submissions SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = ? WHERE id = ?`,
      [approvedBy, proofId],
      (err) => {
        if (err) reject(err);
        else {
          // Update assignment status
          db.get(`SELECT task_assignment_id FROM proof_submissions WHERE id = ?`, [proofId], (err, row) => {
            if (row) {
              db.run(`UPDATE task_assignments SET status = 'approved' WHERE id = ?`, [row.task_assignment_id]);
            }
          });
          resolve();
        }
      }
    );
  });
};

const rejectProof = (proofId, rejectionReason, rejectedBy) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE proof_submissions SET status = 'rejected', rejection_reason = ?, approved_by = ? WHERE id = ?`,
      [rejectionReason, rejectedBy, proofId],
      (err) => {
        if (err) reject(err);
        else {
          // Reset assignment status
          db.get(`SELECT task_assignment_id FROM proof_submissions WHERE id = ?`, [proofId], (err, row) => {
            if (row) {
              db.run(`UPDATE task_assignments SET status = 'assigned' WHERE id = ?`, [row.task_assignment_id]);
            }
          });
          resolve();
        }
      }
    );
  });
};

// Auto-approve operations
const setAutoApprove = (bulkTaskId, guildId, enabled, requireScreenshot, requireVerificationUrl, enabledBy) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO auto_approve_settings 
       (bulk_task_id, guild_id, auto_approve_enabled, require_screenshot, require_verification_url, enabled_by, enabled_at) 
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [bulkTaskId, guildId, enabled ? 1 : 0, requireScreenshot ? 1 : 0, requireVerificationUrl ? 1 : 0, enabledBy],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

const getAutoApproveSettings = (bulkTaskId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM auto_approve_settings WHERE bulk_task_id = ?`,
      [bulkTaskId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
};

const isAutoApproveEnabled = (bulkTaskId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT auto_approve_enabled FROM auto_approve_settings WHERE bulk_task_id = ?`,
      [bulkTaskId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.auto_approve_enabled === 1 : false);
      }
    );
  });
};

// Delete bulk task and cascade to related records
const deleteBulkTask = (bulkTaskId) => {
  return new Promise((resolve, reject) => {
    console.log(`[DB] Deleting bulk task #${bulkTaskId} with cascade...`);
    
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Delete auto-approve settings for this task
      db.run(
        `DELETE FROM auto_approve_settings WHERE bulk_task_id = ?`,
        [bulkTaskId],
        (err) => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
        }
      );
      
      // Delete proof submissions for assignments related to this task
      db.run(
        `DELETE FROM proof_submissions WHERE task_assignment_id IN (
          SELECT id FROM task_assignments WHERE bulk_task_id = ?
        )`,
        [bulkTaskId],
        (err) => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
        }
      );
      
      // Delete task assignments
      db.run(
        `DELETE FROM task_assignments WHERE bulk_task_id = ?`,
        [bulkTaskId],
        (err) => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
        }
      );
      
      // Delete the bulk task itself
      db.run(
        `DELETE FROM bulk_tasks WHERE id = ?`,
        [bulkTaskId],
        function(err) {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
          
          db.run('COMMIT', (commitErr) => {
            if (commitErr) {
              db.run('ROLLBACK');
              return reject(commitErr);
            }
            
            console.log(`[DB] ✅ Successfully deleted bulk task #${bulkTaskId} (affected ${this.changes} rows)`);
            resolve({ success: true, deletedRows: this.changes });
          });
        }
      );
    });
  });
};

// User operations
const addUser = (discordId, username, solanaAddress) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO users (discord_id, username, solana_address) VALUES (?, ?, ?)`,
      [discordId, username, solanaAddress],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

const getUser = (discordId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM users WHERE discord_id = ?`,
      [discordId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
};

// Task operations (legacy)
const createTask = (guildId, creatorId, recipientAddress, amount, description) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO tasks (guild_id, creator_id, recipient_address, amount, description) VALUES (?, ?, ?, ?, ?)`,
      [guildId, creatorId, recipientAddress, amount, description],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const getTask = (taskId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM tasks WHERE id = ?`,
      [taskId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
};

const getPendingTasks = (guildId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM tasks WHERE guild_id = ? AND status = 'pending'`,
      [guildId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
};

const updateTaskStatus = (taskId, status, signature) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE tasks SET status = ?, transaction_signature = ?, executed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, signature, taskId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

// Transaction operations
const recordTransaction = (guildId, fromAddress, toAddress, amount, signature) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO transactions (guild_id, from_address, to_address, amount, signature) VALUES (?, ?, ?, ?, ?)`,
      [guildId, fromAddress, toAddress, amount, signature],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const getTransactionHistory = (guildId, address, limit = 50) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM transactions WHERE guild_id = ? AND (from_address = ? OR to_address = ?) ORDER BY created_at DESC LIMIT ?`,
      [guildId, address, address, limit],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
};

// Initialize database on module load
initDb();

module.exports = {
  db,
  setGuildWallet,
  getGuildWallet,
  setApprovedRoles,
  getApprovedRoles,
  createBulkTask,
  getActiveBulkTasks,
  getAllBulkTasks,
  getBulkTask,
  assignTaskToUser,
  getUserAssignment,
  getUserAssignments,
  getAssignment,
  submitProof,
  getPendingProofs,
  getProofSubmission,
  approveProof,
  rejectProof,
  setAutoApprove,
  getAutoApproveSettings,
  isAutoApproveEnabled,
  deleteBulkTask,
  addUser,
  getUser,
  createTask,
  getTask,
  getPendingTasks,
  updateTaskStatus,
  recordTransaction,
  getTransactionHistory
};
