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

  // On Railway, prefer /data volume for persistence across deploys
  if (process.env.RAILWAY_ENVIRONMENT && fs.existsSync('/data')) {
    const volPath = '/data/payroll.db';
    console.log(`[DB] Railway mode (persistent volume) - Using: ${volPath}`);
    return volPath;
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
        label TEXT DEFAULT 'Treasury',
        budget_total REAL DEFAULT 0,
        budget_spent REAL DEFAULT 0,
        budget_currency TEXT DEFAULT 'SOL',
        network TEXT DEFAULT 'mainnet-beta',
        configured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        configured_by TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration: add new columns if table already exists (safe to run repeatedly)
    db.run(`ALTER TABLE guild_wallets ADD COLUMN label TEXT DEFAULT 'Treasury'`, () => {});
    db.run(`ALTER TABLE guild_wallets ADD COLUMN budget_total REAL DEFAULT 0`, () => {});
    db.run(`ALTER TABLE guild_wallets ADD COLUMN budget_spent REAL DEFAULT 0`, () => {});
    db.run(`ALTER TABLE guild_wallets ADD COLUMN budget_currency TEXT DEFAULT 'SOL'`, () => {});
    db.run(`ALTER TABLE guild_wallets ADD COLUMN network TEXT DEFAULT 'mainnet-beta'`, () => {});
    db.run(`ALTER TABLE guild_wallets ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`, () => {});

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
        claimed_channel_id TEXT,
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

    // Contests/Giveaways table
    db.run(`
      CREATE TABLE IF NOT EXISTS contests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        prize_amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        num_winners INTEGER DEFAULT 1,
        max_entries INTEGER NOT NULL,
        current_entries INTEGER DEFAULT 0,
        duration_hours INTEGER NOT NULL,
        reference_url TEXT NOT NULL,
        created_by TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        ends_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id),
        FOREIGN KEY(created_by) REFERENCES users(discord_id)
      )
    `);

    // Add message_id column if it doesn't exist (migration for existing tables)
    db.run(`ALTER TABLE contests ADD COLUMN message_id TEXT`, (err) => {
      // Ignore error if column already exists
    });

    // Add claimed_channel_id column if it doesn't exist (migration for existing tables)
    db.run(`ALTER TABLE task_assignments ADD COLUMN claimed_channel_id TEXT`, (err) => {
      // Ignore error if column already exists
    });

    // Contest entries table
    db.run(`
      CREATE TABLE IF NOT EXISTS contest_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contest_id INTEGER NOT NULL,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        screenshot_url TEXT,
        is_winner INTEGER DEFAULT 0,
        entered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(contest_id, user_id),
        FOREIGN KEY(contest_id) REFERENCES contests(id),
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id),
        FOREIGN KEY(user_id) REFERENCES users(discord_id)
      )
    `);

    // Scheduled posts table
    db.run(`
      CREATE TABLE IF NOT EXISTS scheduled_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        content TEXT NOT NULL,
        scheduled_at DATETIME NOT NULL,
        created_by TEXT,
        status TEXT DEFAULT 'scheduled',
        message_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Vote Events table
    db.run(`
      CREATE TABLE IF NOT EXISTS vote_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        prize_amount REAL DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        min_participants INTEGER NOT NULL,
        max_participants INTEGER NOT NULL,
        current_participants INTEGER DEFAULT 0,
        duration_minutes INTEGER,
        owner_favorite_image_id TEXT,
        created_by TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        ends_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id),
        FOREIGN KEY(created_by) REFERENCES users(discord_id)
      )
    `);

    // Vote Event Images table
    db.run(`
      CREATE TABLE IF NOT EXISTS vote_event_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vote_event_id INTEGER NOT NULL,
        image_id TEXT NOT NULL UNIQUE,
        image_url TEXT NOT NULL,
        upload_order INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(vote_event_id) REFERENCES vote_events(id)
      )
    `);

    // Vote Event Participants table
    db.run(`
      CREATE TABLE IF NOT EXISTS vote_event_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vote_event_id INTEGER NOT NULL,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        voted_image_id TEXT,
        is_winner INTEGER DEFAULT 0,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        voted_at DATETIME,
        UNIQUE(vote_event_id, user_id),
        FOREIGN KEY(vote_event_id) REFERENCES vote_events(id),
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id),
        FOREIGN KEY(user_id) REFERENCES users(discord_id)
      )
    `);

    // Vote Event Qualifications table
    db.run(`
      CREATE TABLE IF NOT EXISTS vote_event_qualifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vote_event_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT DEFAULT '',
        screenshot_url TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME,
        reviewed_by TEXT,
        UNIQUE(vote_event_id, user_id),
        FOREIGN KEY(vote_event_id) REFERENCES vote_events(id)
      )
    `);

    // Migration: add qualification_url to vote_events
    db.run(`ALTER TABLE vote_events ADD COLUMN qualification_url TEXT`, () => {});

    // ---- Gambling Events tables ----
    db.run(`
      CREATE TABLE IF NOT EXISTS gambling_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        mode TEXT DEFAULT 'house',
        prize_amount REAL DEFAULT 0,
        currency TEXT DEFAULT 'SOL',
        entry_fee REAL DEFAULT 0,
        min_players INTEGER NOT NULL DEFAULT 2,
        max_players INTEGER NOT NULL DEFAULT 20,
        current_players INTEGER DEFAULT 0,
        duration_minutes INTEGER,
        num_slots INTEGER DEFAULT 6,
        winning_slot INTEGER,
        created_by TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        ends_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id),
        FOREIGN KEY(created_by) REFERENCES users(discord_id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS gambling_event_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gambling_event_id INTEGER NOT NULL,
        slot_number INTEGER NOT NULL,
        label TEXT NOT NULL,
        color TEXT DEFAULT '#888',
        UNIQUE(gambling_event_id, slot_number),
        FOREIGN KEY(gambling_event_id) REFERENCES gambling_events(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS gambling_event_bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gambling_event_id INTEGER NOT NULL,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        chosen_slot INTEGER NOT NULL,
        bet_amount REAL DEFAULT 0,
        is_winner INTEGER DEFAULT 0,
        payment_status TEXT DEFAULT 'none',
        entry_tx_signature TEXT,
        payout_tx_signature TEXT,
        wallet_address TEXT,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(gambling_event_id, user_id),
        FOREIGN KEY(gambling_event_id) REFERENCES gambling_events(id),
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id),
        FOREIGN KEY(user_id) REFERENCES users(discord_id)
      )
    `);

    // Migration: add payment columns if table already exists
    db.run(`ALTER TABLE gambling_event_bets ADD COLUMN payment_status TEXT DEFAULT 'none'`, () => {});
    db.run(`ALTER TABLE gambling_event_bets ADD COLUMN entry_tx_signature TEXT`, () => {});
    db.run(`ALTER TABLE gambling_event_bets ADD COLUMN payout_tx_signature TEXT`, () => {});
    db.run(`ALTER TABLE gambling_event_bets ADD COLUMN wallet_address TEXT`, () => {});

    // User stats table (fast counters for trust/risk scoring)
    db.run(`
      CREATE TABLE IF NOT EXISTS user_stats (
        discord_id TEXT PRIMARY KEY,
        commands_total INTEGER DEFAULT 0,
        commands_last_24h INTEGER DEFAULT 0,
        last_command_at DATETIME,
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Command audit table (detailed command history)
    db.run(`
      CREATE TABLE IF NOT EXISTS command_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        guild_id TEXT,
        command_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Activity feed table - tracks all live activity for the dashboard
    db.run(`
      CREATE TABLE IF NOT EXISTS activity_feed (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        user_tag TEXT,
        amount REAL,
        currency TEXT DEFAULT 'SOL',
        reference_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id)
      )
    `);

    // Events table - scheduled events (separate from vote_events/contests)
    db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        event_type TEXT DEFAULT 'general',
        prize_amount REAL DEFAULT 0,
        currency TEXT DEFAULT 'SOL',
        max_participants INTEGER,
        current_participants INTEGER DEFAULT 0,
        starts_at DATETIME,
        ends_at DATETIME,
        status TEXT DEFAULT 'scheduled',
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id),
        FOREIGN KEY(created_by) REFERENCES users(discord_id)
      )
    `);

    // Event participants table
    db.run(`
      CREATE TABLE IF NOT EXISTS event_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_id, user_id),
        FOREIGN KEY(event_id) REFERENCES events(id),
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id),
        FOREIGN KEY(user_id) REFERENCES users(discord_id)
      )
    `);

    // DCB Worker Roles (Staff / Admin)
    db.run(`
      CREATE TABLE IF NOT EXISTS dcb_workers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        username TEXT,
        role TEXT NOT NULL DEFAULT 'staff',
        added_by TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        removed_at DATETIME,
        UNIQUE(guild_id, discord_id),
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id)
      )
    `);

    // Worker activity log (commands, payouts, channel messages, etc.)
    db.run(`
      CREATE TABLE IF NOT EXISTS worker_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        detail TEXT,
        amount REAL,
        currency TEXT,
        channel_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id)
      )
    `);

    // Worker daily snapshots (aggregated stats per day for fast dashboard queries)
    db.run(`
      CREATE TABLE IF NOT EXISTS worker_daily_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        stat_date TEXT NOT NULL,
        commands_run INTEGER DEFAULT 0,
        messages_sent INTEGER DEFAULT 0,
        payouts_issued INTEGER DEFAULT 0,
        payout_total REAL DEFAULT 0,
        proofs_reviewed INTEGER DEFAULT 0,
        online_minutes INTEGER DEFAULT 0,
        UNIQUE(guild_id, discord_id, stat_date),
        FOREIGN KEY(guild_id) REFERENCES guild_wallets(guild_id)
      )
    `);

    // Site analytics (website visitor / click counters)
    db.run(`
      CREATE TABLE IF NOT EXISTS site_analytics (
        metric TEXT PRIMARY KEY,
        count INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });
};

// Guild Wallet operations
const setGuildWallet = (guildId, walletAddress, configuredByUserId, label, network) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO guild_wallets (guild_id, wallet_address, configured_by, label, network, configured_at, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(guild_id) DO UPDATE SET
         wallet_address = excluded.wallet_address,
         configured_by = excluded.configured_by,
         label = excluded.label,
         network = excluded.network,
         updated_at = CURRENT_TIMESTAMP`,
      [guildId, walletAddress, configuredByUserId, label || 'Treasury', network || 'mainnet-beta'],
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
        else resolve(row || null);
      }
    );
  });
};

const updateGuildWallet = (guildId, updates) => {
  const fields = [];
  const params = [];
  if (updates.wallet_address !== undefined) { fields.push('wallet_address = ?'); params.push(updates.wallet_address); }
  if (updates.label !== undefined) { fields.push('label = ?'); params.push(updates.label); }
  if (updates.budget_total !== undefined) { fields.push('budget_total = ?'); params.push(Number(updates.budget_total)); }
  if (updates.budget_spent !== undefined) { fields.push('budget_spent = ?'); params.push(Number(updates.budget_spent)); }
  if (updates.budget_currency !== undefined) { fields.push('budget_currency = ?'); params.push(updates.budget_currency); }
  if (updates.network !== undefined) { fields.push('network = ?'); params.push(updates.network); }
  if (fields.length === 0) return Promise.resolve();
  fields.push('updated_at = CURRENT_TIMESTAMP');
  params.push(guildId);
  return new Promise((resolve, reject) => {
    db.run(`UPDATE guild_wallets SET ${fields.join(', ')} WHERE guild_id = ?`, params, function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
};

const deleteGuildWallet = (guildId) => {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM guild_wallets WHERE guild_id = ?', [guildId], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
};

const addBudgetSpend = (guildId, amount) => {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE guild_wallets SET budget_spent = budget_spent + ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?',
      [Number(amount), guildId],
      function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
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
const assignTaskToUser = (bulkTaskId, guildId, userId, channelId = null) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO task_assignments (bulk_task_id, guild_id, assigned_user_id, claimed_channel_id) VALUES (?, ?, ?, ?)`,
      [bulkTaskId, guildId, userId, channelId],
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

const getUserAssignmentsForTask = (bulkTaskId, userId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM task_assignments WHERE bulk_task_id = ? AND assigned_user_id = ?`,
      [bulkTaskId, userId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const getTaskAssignments = (bulkTaskId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM task_assignments WHERE bulk_task_id = ?`,
      [bulkTaskId],
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

// ==================== CONTEST OPERATIONS ====================

const createContest = (guildId, channelId, title, description, prizeAmount, currency, numWinners, maxEntries, durationHours, referenceUrl, createdBy) => {
  return new Promise((resolve, reject) => {
    const endsAt = new Date(Date.now() + (durationHours * 60 * 60 * 1000)).toISOString();
    console.log(`[db.createContest] Creating contest for guild ${guildId}: ${title}`);
    db.run(
      `INSERT INTO contests (guild_id, channel_id, title, description, prize_amount, currency, num_winners, max_entries, duration_hours, reference_url, created_by, ends_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [guildId, channelId, title, description, prizeAmount, currency, numWinners, maxEntries, durationHours, referenceUrl, createdBy, endsAt],
      function (err) {
        if (err) {
          console.error(`[db.createContest] Error:`, err);
          reject(err);
        } else {
          console.log(`[db.createContest] Created contest with ID: ${this.lastID}`);
          resolve(this.lastID);
        }
      }
    );
  });
};

const getContest = (contestId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM contests WHERE id = ?`,
      [contestId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
};

const getAllContests = () => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM contests ORDER BY id DESC`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const getActiveContests = (guildId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM contests WHERE guild_id = ? AND status = 'active' AND ends_at > datetime('now') ORDER BY ends_at ASC`,
      [guildId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const getExpiredContests = () => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM contests WHERE status = 'active' AND ends_at <= datetime('now')`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const updateContestStatus = (contestId, status) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE contests SET status = ? WHERE id = ?`,
      [status, contestId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

const updateContestMessageId = (contestId, messageId) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE contests SET message_id = ? WHERE id = ?`,
      [messageId, contestId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

const addContestEntry = (contestId, guildId, userId, screenshotUrl) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `INSERT INTO contest_entries (contest_id, guild_id, user_id, screenshot_url) VALUES (?, ?, ?, ?)`,
        [contestId, guildId, userId, screenshotUrl],
        function (err) {
          if (err) {
            reject(err);
            return;
          }
          const entryId = this.lastID;
          
          // Update current_entries count
          db.run(
            `UPDATE contests SET current_entries = current_entries + 1 WHERE id = ?`,
            [contestId],
            (updateErr) => {
              if (updateErr) reject(updateErr);
              else resolve(entryId);
            }
          );
        }
      );
    });
  });
};

const getContestEntry = (contestId, userId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM contest_entries WHERE contest_id = ? AND user_id = ?`,
      [contestId, userId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
};

const getContestEntries = (contestId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM contest_entries WHERE contest_id = ? ORDER BY entered_at ASC`,
      [contestId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const removeContestEntry = (contestId, userId) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `DELETE FROM contest_entries WHERE contest_id = ? AND user_id = ?`,
        [contestId, userId],
        function (err) {
          if (err) {
            reject(err);
            return;
          }
          
          if (this.changes > 0) {
            // Update current_entries count
            db.run(
              `UPDATE contests SET current_entries = current_entries - 1 WHERE id = ?`,
              [contestId],
              (updateErr) => {
                if (updateErr) reject(updateErr);
                else resolve(true);
              }
            );
          } else {
            resolve(false);
          }
        }
      );
    });
  });
};

const setContestWinners = (contestId, winnerUserIds) => {
  return new Promise((resolve, reject) => {
    const placeholders = winnerUserIds.map(() => '?').join(',');
    db.run(
      `UPDATE contest_entries SET is_winner = 1 WHERE contest_id = ? AND user_id IN (${placeholders})`,
      [contestId, ...winnerUserIds],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

const deleteContest = (contestId) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Delete entries first
      db.run(
        `DELETE FROM contest_entries WHERE contest_id = ?`,
        [contestId],
        (err) => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
        }
      );
      
      // Delete contest
      db.run(
        `DELETE FROM contests WHERE id = ?`,
        [contestId],
        function (err) {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
          
          db.run('COMMIT', (commitErr) => {
            if (commitErr) reject(commitErr);
            else resolve(this.changes);
          });
        }
      );
    });
  });
};

// ==================== VOTE EVENT OPERATIONS ====================

const createVoteEvent = (guildId, channelId, title, description, prizeAmount, currency, minParticipants, maxParticipants, durationMinutes, ownerFavoriteImageId, createdBy, qualificationUrl) => {
  return new Promise((resolve, reject) => {
    const endsAt = durationMinutes ? new Date(Date.now() + (durationMinutes * 60 * 1000)).toISOString() : null;
    console.log(`[db.createVoteEvent] Creating vote event for guild ${guildId}: ${title}`);
    db.run(
      `INSERT INTO vote_events (guild_id, channel_id, title, description, prize_amount, currency, min_participants, max_participants, duration_minutes, owner_favorite_image_id, created_by, ends_at, qualification_url) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [guildId, channelId, title, description, prizeAmount || 0, currency || 'USD', minParticipants, maxParticipants, durationMinutes, ownerFavoriteImageId, createdBy, endsAt, qualificationUrl || null],
      function (err) {
        if (err) {
          console.error(`[db.createVoteEvent] Error:`, err);
          reject(err);
        } else {
          console.log(`[db.createVoteEvent] Created vote event with ID: ${this.lastID}`);
          resolve(this.lastID);
        }
      }
    );
  });
};

const addVoteEventImage = (voteEventId, imageId, imageUrl, uploadOrder) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO vote_event_images (vote_event_id, image_id, image_url, upload_order) VALUES (?, ?, ?, ?)`,
      [voteEventId, imageId, imageUrl, uploadOrder],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const addVoteEventQualification = (voteEventId, userId, username, screenshotUrl) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO vote_event_qualifications (vote_event_id, user_id, username, screenshot_url, status, submitted_at)
       VALUES (?, ?, ?, ?, 'approved', datetime('now'))`,
      [voteEventId, userId, username || '', screenshotUrl],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const getVoteEventQualification = (voteEventId, userId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM vote_event_qualifications WHERE vote_event_id = ? AND user_id = ?`,
      [voteEventId, userId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
};

const getVoteEvent = (voteEventId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM vote_events WHERE id = ?`,
      [voteEventId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
};

// Insert a vote event (+ images) synced from the backend service
const createVoteEventFromSync = (event, images) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Use INSERT OR IGNORE so we never fail on duplicates
      db.run(
        `INSERT OR IGNORE INTO vote_events
          (id, guild_id, channel_id, message_id, title, description, prize_amount, currency,
           min_participants, max_participants, current_participants, duration_minutes,
           owner_favorite_image_id, created_by, status, ends_at, created_at, qualification_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.id,
          event.guild_id,
          event.channel_id,
          event.message_id || null,
          event.title,
          event.description || '',
          event.prize_amount || 0,
          event.currency || 'USD',
          event.min_participants,
          event.max_participants,
          event.current_participants || 0,
          event.duration_minutes || null,
          event.owner_favorite_image_id || null,
          event.created_by,
          event.status || 'active',
          event.ends_at || null,
          event.created_at || new Date().toISOString(),
          event.qualification_url || null
        ],
        function (err) {
          if (err) return reject(err);
        }
      );

      if (Array.isArray(images)) {
        for (const img of images) {
          db.run(
            `INSERT OR IGNORE INTO vote_event_images (vote_event_id, image_id, image_url, upload_order) VALUES (?, ?, ?, ?)`,
            [event.id, img.image_id, img.image_url, img.upload_order]
          );
        }
      }

      // Final no-op to capture completion
      db.run('SELECT 1', [], function (err) {
        if (err) reject(err);
        else resolve(event.id);
      });
    });
  });
};

const getVoteEventImages = (voteEventId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM vote_event_images WHERE vote_event_id = ? ORDER BY upload_order ASC`,
      [voteEventId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const getActiveVoteEvents = (guildId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM vote_events WHERE guild_id = ? AND status = 'active' ORDER BY created_at DESC`,
      [guildId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const getExpiredVoteEvents = () => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM vote_events WHERE status = 'active' AND ends_at IS NOT NULL AND datetime(ends_at) <= datetime('now')`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const updateVoteEventStatus = (voteEventId, status) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE vote_events SET status = ? WHERE id = ?`,
      [status, voteEventId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

const updateVoteEventMessageId = (voteEventId, messageId) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE vote_events SET message_id = ? WHERE id = ?`,
      [messageId, voteEventId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

const joinVoteEvent = (voteEventId, guildId, userId) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Increment current_participants
      db.run(
        `UPDATE vote_events SET current_participants = current_participants + 1 WHERE id = ?`,
        [voteEventId],
        (err) => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
        }
      );
      
      // Add participant
      db.run(
        `INSERT INTO vote_event_participants (vote_event_id, guild_id, user_id) VALUES (?, ?, ?)`,
        [voteEventId, guildId, userId],
        function (err) {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
          
          db.run('COMMIT', (commitErr) => {
            if (commitErr) reject(commitErr);
            else resolve(this.lastID);
          });
        }
      );
    });
  });
};

const getVoteEventParticipant = (voteEventId, userId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM vote_event_participants WHERE vote_event_id = ? AND user_id = ?`,
      [voteEventId, userId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
};

const getVoteEventParticipants = (voteEventId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM vote_event_participants WHERE vote_event_id = ? ORDER BY joined_at ASC`,
      [voteEventId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const submitVote = (voteEventId, userId, votedImageId) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE vote_event_participants SET voted_image_id = ?, voted_at = CURRENT_TIMESTAMP WHERE vote_event_id = ? AND user_id = ?`,
      [votedImageId, voteEventId, userId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

const getVoteResults = (voteEventId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT voted_image_id, COUNT(*) as vote_count 
       FROM vote_event_participants 
       WHERE vote_event_id = ? AND voted_image_id IS NOT NULL 
       GROUP BY voted_image_id 
       ORDER BY vote_count DESC`,
      [voteEventId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const setVoteEventWinners = (voteEventId, winnerUserIds) => {
  return new Promise((resolve, reject) => {
    if (!winnerUserIds || winnerUserIds.length === 0) {
      return resolve();
    }
    const placeholders = winnerUserIds.map(() => '?').join(',');
    db.run(
      `UPDATE vote_event_participants SET is_winner = 1 WHERE vote_event_id = ? AND user_id IN (${placeholders})`,
      [voteEventId, ...winnerUserIds],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

const deleteVoteEvent = (voteEventId) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Delete participants first
      db.run(
        `DELETE FROM vote_event_participants WHERE vote_event_id = ?`,
        [voteEventId],
        (err) => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
        }
      );
      
      // Delete images
      db.run(
        `DELETE FROM vote_event_images WHERE vote_event_id = ?`,
        [voteEventId],
        (err) => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
        }
      );
      
      // Delete vote event
      db.run(
        `DELETE FROM vote_events WHERE id = ?`,
        [voteEventId],
        function (err) {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
          
          db.run('COMMIT', (commitErr) => {
            if (commitErr) reject(commitErr);
            else resolve(this.changes);
          });
        }
      );
    });
  });
};

// ==================== GAMBLING EVENT OPERATIONS ====================

const createGamblingEvent = (guildId, channelId, title, description, mode, prizeAmount, currency, entryFee, minPlayers, maxPlayers, durationMinutes, numSlots, createdBy) => {
  return new Promise((resolve, reject) => {
    const endsAt = durationMinutes ? new Date(Date.now() + (durationMinutes * 60 * 1000)).toISOString() : null;
    db.run(
      `INSERT INTO gambling_events (guild_id, channel_id, title, description, mode, prize_amount, currency, entry_fee, min_players, max_players, duration_minutes, num_slots, created_by, ends_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [guildId, channelId, title, description || '', mode || 'house', prizeAmount || 0, currency || 'SOL', entryFee || 0, minPlayers, maxPlayers, durationMinutes, numSlots || 6, createdBy, endsAt],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const addGamblingEventSlot = (eventId, slotNumber, label, color) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO gambling_event_slots (gambling_event_id, slot_number, label, color) VALUES (?, ?, ?, ?)`,
      [eventId, slotNumber, label, color || '#888'],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const getGamblingEvent = (eventId) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM gambling_events WHERE id = ?`, [eventId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const getGamblingEventSlots = (eventId) => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM gambling_event_slots WHERE gambling_event_id = ? ORDER BY slot_number ASC`, [eventId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const getActiveGamblingEvents = (guildId) => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM gambling_events WHERE guild_id = ? AND status = 'active' ORDER BY created_at DESC`, [guildId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const getExpiredGamblingEvents = () => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM gambling_events WHERE status = 'active' AND ends_at IS NOT NULL AND datetime(ends_at) <= datetime('now')`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const updateGamblingEventStatus = (eventId, status) => {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE gambling_events SET status = ? WHERE id = ?`, [status, eventId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const updateGamblingEventMessageId = (eventId, messageId) => {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE gambling_events SET message_id = ? WHERE id = ?`, [messageId, eventId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const setGamblingEventWinningSlot = (eventId, winningSlot) => {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE gambling_events SET winning_slot = ? WHERE id = ?`, [winningSlot, eventId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const joinGamblingEvent = (eventId, guildId, userId, chosenSlot, betAmount, paymentStatus, walletAddress) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.run(`UPDATE gambling_events SET current_players = current_players + 1 WHERE id = ?`, [eventId], (err) => {
        if (err) { db.run('ROLLBACK'); return reject(err); }
      });
      // Try INSERT with payment columns; fall back to basic INSERT if columns don't exist yet
      const fullSql = `INSERT INTO gambling_event_bets (gambling_event_id, guild_id, user_id, chosen_slot, bet_amount, payment_status, wallet_address) VALUES (?, ?, ?, ?, ?, ?, ?)`;
      const fullParams = [eventId, guildId, userId, chosenSlot, betAmount || 0, paymentStatus || 'none', walletAddress || null];
      const fallbackSql = `INSERT INTO gambling_event_bets (gambling_event_id, guild_id, user_id, chosen_slot, bet_amount) VALUES (?, ?, ?, ?, ?)`;
      const fallbackParams = [eventId, guildId, userId, chosenSlot, betAmount || 0];

      db.run(fullSql, fullParams, function (err) {
        if (err && err.message && err.message.includes('has no column')) {
          // Columns not yet migrated — fall back
          console.warn('[DB] joinGamblingEvent: payment columns missing, using fallback INSERT');
          db.run(fallbackSql, fallbackParams, function (err2) {
            if (err2) { db.run('ROLLBACK'); return reject(err2); }
            const id = this.lastID;
            db.run('COMMIT', (commitErr) => {
              if (commitErr) reject(commitErr);
              else resolve(id);
            });
          });
        } else if (err) {
          db.run('ROLLBACK'); return reject(err);
        } else {
          const id = this.lastID;
          db.run('COMMIT', (commitErr) => {
            if (commitErr) reject(commitErr);
            else resolve(id);
          });
        }
      });
    });
  });
};

const getGamblingEventBet = (eventId, userId) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM gambling_event_bets WHERE gambling_event_id = ? AND user_id = ?`, [eventId, userId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const getGamblingEventBets = (eventId) => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM gambling_event_bets WHERE gambling_event_id = ? ORDER BY joined_at ASC`, [eventId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const getGamblingBetResults = (eventId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT chosen_slot, COUNT(*) as bet_count, SUM(bet_amount) as total_bet
       FROM gambling_event_bets WHERE gambling_event_id = ? GROUP BY chosen_slot ORDER BY bet_count DESC`,
      [eventId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const setGamblingEventWinners = (eventId, winnerUserIds) => {
  return new Promise((resolve, reject) => {
    if (!winnerUserIds || winnerUserIds.length === 0) return resolve();
    const placeholders = winnerUserIds.map(() => '?').join(',');
    db.run(
      `UPDATE gambling_event_bets SET is_winner = 1 WHERE gambling_event_id = ? AND user_id IN (${placeholders})`,
      [eventId, ...winnerUserIds],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

const updateGamblingBetPayment = (eventId, userId, paymentStatus, txSignatureField, txSignature) => {
  return new Promise((resolve, reject) => {
    const field = txSignatureField === 'payout' ? 'payout_tx_signature' : 'entry_tx_signature';
    db.run(
      `UPDATE gambling_event_bets SET payment_status = ?, ${field} = ? WHERE gambling_event_id = ? AND user_id = ?`,
      [paymentStatus, txSignature, eventId, userId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

const getGamblingEventBetsWithWallets = (eventId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT b.*, u.solana_address FROM gambling_event_bets b
       LEFT JOIN users u ON b.user_id = u.discord_id
       WHERE b.gambling_event_id = ? ORDER BY b.joined_at ASC`,
      [eventId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

// Insert a gambling event (+ slots) synced from the backend service
const createGamblingEventFromSync = (event, slots) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `INSERT OR REPLACE INTO gambling_events
          (id, guild_id, channel_id, message_id, title, description, mode, prize_amount, currency, entry_fee,
           min_players, max_players, current_players, duration_minutes, num_slots, winning_slot, created_by, status, ends_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.id,
          event.guild_id,
          event.channel_id,
          event.message_id || null,
          event.title,
          event.description || '',
          event.mode || 'house',
          event.prize_amount || 0,
          event.currency || 'SOL',
          event.entry_fee || 0,
          event.min_players,
          event.max_players,
          event.current_players || 0,
          event.duration_minutes || null,
          event.num_slots || 6,
          event.winning_slot || null,
          event.created_by,
          event.status || 'active',
          event.ends_at || null,
          event.created_at || new Date().toISOString()
        ],
        function (err) {
          if (err) return reject(err);
        }
      );

      if (Array.isArray(slots)) {
        for (const s of slots) {
          db.run(
            `INSERT OR REPLACE INTO gambling_event_slots (gambling_event_id, slot_number, label, color) VALUES (?, ?, ?, ?)`,
            [event.id, s.slot_number, s.label, s.color || '#888']
          );
        }
      }

      // Final no-op to capture completion
      db.run('SELECT 1', [], function (err) {
        if (err) reject(err);
        else resolve(event.id);
      });
    });
  });
};

const deleteGamblingEvent = (eventId) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.run(`DELETE FROM gambling_event_bets WHERE gambling_event_id = ?`, [eventId], (err) => {
        if (err) { db.run('ROLLBACK'); return reject(err); }
      });
      db.run(`DELETE FROM gambling_event_slots WHERE gambling_event_id = ?`, [eventId], (err) => {
        if (err) { db.run('ROLLBACK'); return reject(err); }
      });
      db.run(`DELETE FROM gambling_events WHERE id = ?`, [eventId], function (err) {
        if (err) { db.run('ROLLBACK'); return reject(err); }
        db.run('COMMIT', (commitErr) => {
          if (commitErr) reject(commitErr);
          else resolve(this.changes);
        });
      });
    });
  });
};

// ==================== TRUST/RISK STAT OPERATIONS ====================

const touchUserStats = (discordId) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO user_stats (discord_id, commands_total, last_command_at, first_seen_at, last_seen_at)
       VALUES (?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(discord_id) DO UPDATE SET
         commands_total = commands_total + 1,
         last_command_at = CURRENT_TIMESTAMP,
         last_seen_at = CURRENT_TIMESTAMP`,
      [discordId],
      (err) => (err ? reject(err) : resolve())
    );
  });
};

const getUserStats = (discordId) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM user_stats WHERE discord_id = ?`, [discordId], (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
};

const countOwnerConnectedGuilds = (discordId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) as cnt FROM guild_wallets WHERE configured_by = ?`,
      [discordId],
      (err, row) => (err ? reject(err) : resolve(row?.cnt || 0))
    );
  });
};

const countUserActiveGuilds = (discordId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `
      SELECT COUNT(*) as cnt FROM (
        SELECT guild_id FROM task_assignments WHERE assigned_user_id = ?
        UNION
        SELECT guild_id FROM proof_submissions WHERE user_id = ?
        UNION
        SELECT guild_id FROM contest_entries WHERE user_id = ?
      ) t
      `,
      [discordId, discordId, discordId],
      (err, row) => (err ? reject(err) : resolve(row?.cnt || 0))
    );
  });
};

const getProofOutcomeStats = (discordId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `
      SELECT
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        COUNT(*) as total
      FROM proof_submissions
      WHERE user_id = ?
      `,
      [discordId],
      (err, row) => {
        if (err) reject(err);
        else resolve({
          approved: row?.approved || 0,
          rejected: row?.rejected || 0,
          total: row?.total || 0
        });
      }
    );
  });
};

const logCommandAudit = (discordId, guildId, commandName) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO command_audit (discord_id, guild_id, command_name) VALUES (?, ?, ?)`,
      [discordId, guildId, commandName],
      (err) => (err ? reject(err) : resolve())
    );
  });
};

// Initialize database on module load
initDb();

// Scheduled posts functions
const createScheduledPost = (guildId, channelId, content, scheduledAt, createdBy) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO scheduled_posts (guild_id, channel_id, content, scheduled_at, created_by) VALUES (?, ?, ?, ?, ?)`,
      [guildId, channelId, content, scheduledAt, createdBy],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const getDueScheduledPosts = () => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM scheduled_posts WHERE status = 'scheduled' AND scheduled_at <= datetime('now') ORDER BY scheduled_at ASC`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const updateScheduledPostStatus = (postId, status, messageId = null) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE scheduled_posts SET status = ?, message_id = ? WHERE id = ?`,
      [status, messageId, postId],
      (err) => (err ? reject(err) : resolve())
    );
  });
};

const getScheduledPostsForGuild = (guildId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM scheduled_posts WHERE guild_id = ? ORDER BY scheduled_at DESC`,
      [guildId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

// ---- Activity Feed functions ----
const logActivity = (guildId, type, title, description, userTag, amount, currency, referenceId) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO activity_feed (guild_id, type, title, description, user_tag, amount, currency, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [guildId, type, title, description || null, userTag || null, amount || null, currency || 'SOL', referenceId || null],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const getActivityFeed = (guildId, limit = 20, typeFilter = null) => {
  return new Promise((resolve, reject) => {
    let sql = `SELECT * FROM activity_feed WHERE guild_id = ?`;
    const params = [guildId];
    if (typeFilter && typeFilter !== 'all') {
      sql += ` AND type = ?`;
      params.push(typeFilter);
    }
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

// ---- Events (scheduled events) functions ----
const createEvent = (guildId, channelId, title, description, eventType, prizeAmount, currency, maxParticipants, startsAt, endsAt, createdBy) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO events (guild_id, channel_id, title, description, event_type, prize_amount, currency, max_participants, starts_at, ends_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [guildId, channelId, title, description || '', eventType || 'general', prizeAmount || 0, currency || 'SOL', maxParticipants || null, startsAt || null, endsAt || null, createdBy],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const getEvent = (eventId) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM events WHERE id = ?`, [eventId], (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
};

const getEventsForGuild = (guildId) => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM events WHERE guild_id = ? ORDER BY created_at DESC`, [guildId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const getActiveEvents = (guildId) => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM events WHERE guild_id = ? AND status IN ('scheduled','active') ORDER BY starts_at ASC`, [guildId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const updateEventStatus = (eventId, status) => {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE events SET status = ? WHERE id = ?`, [status, eventId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const deleteEvent = (eventId) => {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM events WHERE id = ?`, [eventId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

// ---- Dashboard stats functions ----
const getDashboardStats = (guildId) => {
  return new Promise((resolve, reject) => {
    const stats = {};
    db.get(`SELECT COUNT(*) as cnt FROM bulk_tasks WHERE guild_id = ? AND status = 'active'`, [guildId], (err, row) => {
      if (err) return reject(err);
      stats.activeTasks = row?.cnt || 0;
      db.get(`SELECT COUNT(*) as cnt FROM proof_submissions WHERE guild_id = ? AND status = 'pending'`, [guildId], (err2, row2) => {
        if (err2) return reject(err2);
        stats.pendingProofs = row2?.cnt || 0;
        db.get(`SELECT COUNT(DISTINCT assigned_user_id) as cnt FROM task_assignments WHERE guild_id = ?`, [guildId], (err3, row3) => {
          if (err3) return reject(err3);
          stats.workers = row3?.cnt || 0;
          db.get(`SELECT COUNT(*) as cnt FROM contests WHERE guild_id = ? AND status = 'active'`, [guildId], (err4, row4) => {
            if (err4) return reject(err4);
            stats.liveContests = row4?.cnt || 0;
            db.get(`SELECT COUNT(*) as cnt FROM events WHERE guild_id = ? AND status IN ('scheduled','active')`, [guildId], (err5, row5) => {
              if (err5) return reject(err5);
              stats.activeEvents = row5?.cnt || 0;
              resolve(stats);
            });
          });
        });
      });
    });
  });
};

const getRecentTransactions = (guildId, limit = 20) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM transactions WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?`,
      [guildId, limit],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

// ---- DCB Worker Role helpers ----

const addWorker = (guildId, discordId, username, role, addedBy) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO dcb_workers (guild_id, discord_id, username, role, added_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, discord_id) DO UPDATE SET
         username = excluded.username,
         role = excluded.role,
         added_by = excluded.added_by,
         removed_at = NULL,
         added_at = CURRENT_TIMESTAMP`,
      [guildId, discordId, username, role || 'staff', addedBy],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const removeWorker = (guildId, discordId) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE dcb_workers SET removed_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL`,
      [guildId, discordId],
      function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
};

const getWorker = (guildId, discordId) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM dcb_workers WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL`,
      [guildId, discordId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      }
    );
  });
};

const getGuildWorkers = (guildId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM dcb_workers WHERE guild_id = ? AND removed_at IS NULL ORDER BY role ASC, added_at ASC`,
      [guildId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const updateWorkerRole = (guildId, discordId, newRole) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE dcb_workers SET role = ? WHERE guild_id = ? AND discord_id = ? AND removed_at IS NULL`,
      [newRole, guildId, discordId],
      function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
};

// ---- Worker Activity helpers ----

const logWorkerActivity = (guildId, discordId, actionType, detail, amount, currency, channelId) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO worker_activity (guild_id, discord_id, action_type, detail, amount, currency, channel_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [guildId, discordId, actionType, detail || null, amount || null, currency || null, channelId || null],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const getWorkerActivity = (guildId, discordId, limit = 50) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM worker_activity WHERE guild_id = ? AND discord_id = ? ORDER BY created_at DESC LIMIT ?`,
      [guildId, discordId, limit],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const getGuildWorkerActivity = (guildId, limit = 100) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT wa.*, dw.username, dw.role FROM worker_activity wa
       LEFT JOIN dcb_workers dw ON wa.guild_id = dw.guild_id AND wa.discord_id = dw.discord_id AND dw.removed_at IS NULL
       WHERE wa.guild_id = ? ORDER BY wa.created_at DESC LIMIT ?`,
      [guildId, limit],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

const upsertWorkerDailyStat = (guildId, discordId, statDate, field, increment) => {
  return new Promise((resolve, reject) => {
    const validFields = ['commands_run', 'messages_sent', 'payouts_issued', 'payout_total', 'proofs_reviewed', 'online_minutes'];
    if (!validFields.includes(field)) return reject(new Error('invalid stat field'));
    db.run(
      `INSERT INTO worker_daily_stats (guild_id, discord_id, stat_date, ${field})
       VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, discord_id, stat_date) DO UPDATE SET
         ${field} = ${field} + ?`,
      [guildId, discordId, statDate, increment, increment],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

const getWorkerStats = (guildId, discordId, days = 30) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT
         COALESCE(SUM(commands_run), 0) as total_commands,
         COALESCE(SUM(messages_sent), 0) as total_messages,
         COALESCE(SUM(payouts_issued), 0) as total_payouts_issued,
         COALESCE(SUM(payout_total), 0) as total_payout_amount,
         COALESCE(SUM(proofs_reviewed), 0) as total_proofs_reviewed,
         COALESCE(SUM(online_minutes), 0) as total_online_minutes,
         COUNT(DISTINCT stat_date) as active_days
       FROM worker_daily_stats
       WHERE guild_id = ? AND discord_id = ? AND stat_date >= date('now', '-' || ? || ' days')`,
      [guildId, discordId, days],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || {});
      }
    );
  });
};

const getGuildWorkersSummary = (guildId, days = 30) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT
         dw.discord_id,
         dw.username,
         dw.role,
         dw.added_at,
         COALESCE(SUM(wds.commands_run), 0) as total_commands,
         COALESCE(SUM(wds.messages_sent), 0) as total_messages,
         COALESCE(SUM(wds.payouts_issued), 0) as total_payouts_issued,
         COALESCE(SUM(wds.payout_total), 0) as total_payout_amount,
         COALESCE(SUM(wds.proofs_reviewed), 0) as total_proofs_reviewed,
         COALESCE(SUM(wds.online_minutes), 0) as total_online_minutes,
         COUNT(DISTINCT wds.stat_date) as active_days,
         (SELECT MAX(wa2.created_at) FROM worker_activity wa2 WHERE wa2.guild_id = dw.guild_id AND wa2.discord_id = dw.discord_id) as last_active
       FROM dcb_workers dw
       LEFT JOIN worker_daily_stats wds ON dw.guild_id = wds.guild_id AND dw.discord_id = wds.discord_id
         AND wds.stat_date >= date('now', '-' || ? || ' days')
       WHERE dw.guild_id = ? AND dw.removed_at IS NULL
       GROUP BY dw.discord_id
       ORDER BY dw.role ASC, total_commands DESC`,
      [days, guildId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

module.exports = {
  db,
  initDb,
  setGuildWallet,
  getGuildWallet,
  updateGuildWallet,
  deleteGuildWallet,
  addBudgetSpend,
  setApprovedRoles,
  getApprovedRoles,
  createBulkTask,
  getActiveBulkTasks,
  getAllBulkTasks,
  getBulkTask,
  assignTaskToUser,
  getUserAssignment,
  getUserAssignments,
  getUserAssignmentsForTask,
  getTaskAssignments,
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
  getTransactionHistory,
  // Contest functions
  createContest,
  getContest,
  getAllContests,
  getActiveContests,
  getExpiredContests,
  updateContestStatus,
  updateContestMessageId,
  addContestEntry,
  getContestEntry,
  getContestEntries,
  removeContestEntry,
  setContestWinners,
  deleteContest,
  // Vote Event functions
  createVoteEvent,
  createVoteEventFromSync,
  addVoteEventImage,
  getVoteEvent,
  getVoteEventImages,
  getActiveVoteEvents,
  getExpiredVoteEvents,
  updateVoteEventStatus,
  updateVoteEventMessageId,
  joinVoteEvent,
  getVoteEventParticipant,
  getVoteEventParticipants,
  submitVote,
  getVoteResults,
  setVoteEventWinners,
  deleteVoteEvent,
  addVoteEventQualification,
  getVoteEventQualification,
  // Trust/Risk functions
  touchUserStats,
  getUserStats,
  countOwnerConnectedGuilds,
  countUserActiveGuilds,
  getProofOutcomeStats,
  logCommandAudit,
  // Scheduled posts
  createScheduledPost,
  getDueScheduledPosts,
  getScheduledPostsForGuild,
  updateScheduledPostStatus,
  // Activity feed
  logActivity,
  getActivityFeed,
  // Events (scheduled)
  createEvent,
  getEvent,
  getEventsForGuild,
  getActiveEvents,
  updateEventStatus,
  deleteEvent,
  // Dashboard
  getDashboardStats,
  getRecentTransactions,
  // Worker / Staff management
  addWorker,
  removeWorker,
  getWorker,
  getGuildWorkers,
  updateWorkerRole,
  logWorkerActivity,
  getWorkerActivity,
  getGuildWorkerActivity,
  upsertWorkerDailyStat,
  getWorkerStats,
  getGuildWorkersSummary,
  // Gambling Event functions
  createGamblingEvent,
  createGamblingEventFromSync,
  addGamblingEventSlot,
  getGamblingEvent,
  getGamblingEventSlots,
  getActiveGamblingEvents,
  getExpiredGamblingEvents,
  updateGamblingEventStatus,
  updateGamblingEventMessageId,
  setGamblingEventWinningSlot,
  joinGamblingEvent,
  getGamblingEventBet,
  getGamblingEventBets,
  getGamblingBetResults,
  setGamblingEventWinners,
  updateGamblingBetPayment,
  getGamblingEventBetsWithWallets,
  deleteGamblingEvent,
};
