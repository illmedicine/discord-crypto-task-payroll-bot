const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../payroll.db');
const db = new sqlite3.Database(dbPath);

// Initialize database tables
const initDb = () => {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        discord_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        solana_address TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tasks table
    db.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id TEXT NOT NULL,
        recipient_address TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        transaction_signature TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        executed_at DATETIME,
        FOREIGN KEY(creator_id) REFERENCES users(discord_id)
      )
    `);

    // Transactions table
    db.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        amount REAL NOT NULL,
        signature TEXT UNIQUE,
        status TEXT DEFAULT 'confirmed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Wallet history table
    db.run(`
      CREATE TABLE IF NOT EXISTS wallet_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        action TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(discord_id) REFERENCES users(discord_id)
      )
    `);
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

// Task operations
const createTask = (creatorId, recipientAddress, amount, description) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO tasks (creator_id, recipient_address, amount, description) VALUES (?, ?, ?, ?)`,
      [creatorId, recipientAddress, amount, description],
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

const getPendingTasks = () => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM tasks WHERE status = 'pending'`,
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
const recordTransaction = (fromAddress, toAddress, amount, signature) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO transactions (from_address, to_address, amount, signature) VALUES (?, ?, ?, ?)`,
      [fromAddress, toAddress, amount, signature],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const getTransactionHistory = (address, limit = 50) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM transactions WHERE from_address = ? OR to_address = ? ORDER BY created_at DESC LIMIT ?`,
      [address, address, limit],
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
  addUser,
  getUser,
  createTask,
  getTask,
  getPendingTasks,
  updateTaskStatus,
  recordTransaction,
  getTransactionHistory
};
