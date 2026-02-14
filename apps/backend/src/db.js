const path = require('path')
const fs = require('fs')
const sqlite3 = require('sqlite3')

// Prefer env var, then /data volume (persistent), then CWD
const dbPath = process.env.DCB_DB_PATH
  || (process.env.RAILWAY_ENVIRONMENT && fs.existsSync('/data') ? '/data/payroll.db' : null)
  || path.join(process.cwd(), 'payroll.db')

console.log(`[backend-db] Using database: ${dbPath}`)
const db = new sqlite3.Database(dbPath)

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      creator_id TEXT,
      recipient_address TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      transaction_signature TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      executed_at DATETIME
    )`
  )

  // Command audit log (synced from bot)
  db.run(
    `CREATE TABLE IF NOT EXISTS command_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT NOT NULL,
      guild_id TEXT,
      command_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  )

  db.run(
    `CREATE TABLE IF NOT EXISTS contests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      prize_amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      num_winners INTEGER DEFAULT 1,
      max_entries INTEGER NOT NULL,
      current_entries INTEGER DEFAULT 0,
      duration_hours REAL NOT NULL,
      reference_url TEXT NOT NULL,
      message_id TEXT,
      created_by TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ends_at DATETIME
    )`
  )

  db.run(
    `CREATE TABLE IF NOT EXISTS bulk_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      payout_amount REAL NOT NULL,
      payout_currency TEXT DEFAULT 'SOL',
      total_slots INTEGER NOT NULL,
      filled_slots INTEGER DEFAULT 0,
      message_id TEXT,
      created_by TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  )

  db.run(
    `CREATE TABLE IF NOT EXISTS vote_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      prize_amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      min_participants INTEGER NOT NULL,
      max_participants INTEGER NOT NULL,
      current_participants INTEGER DEFAULT 0,
      duration_minutes INTEGER,
      owner_favorite_image_id TEXT,
      message_id TEXT,
      created_by TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ends_at DATETIME
    )`
  )

  db.run(
    `CREATE TABLE IF NOT EXISTS vote_event_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vote_event_id INTEGER NOT NULL,
      image_id TEXT NOT NULL,
      image_url TEXT NOT NULL,
      upload_order INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(vote_event_id, image_id)
    )`
  )

  // Guild wallets
  db.run(
    `CREATE TABLE IF NOT EXISTS guild_wallets (
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
    )`
  )

  // Migration: add new columns if table already exists (safe to run repeatedly)
  db.run(`ALTER TABLE guild_wallets ADD COLUMN label TEXT DEFAULT 'Treasury'`, () => {})
  db.run(`ALTER TABLE guild_wallets ADD COLUMN budget_total REAL DEFAULT 0`, () => {})
  db.run(`ALTER TABLE guild_wallets ADD COLUMN budget_spent REAL DEFAULT 0`, () => {})
  db.run(`ALTER TABLE guild_wallets ADD COLUMN budget_currency TEXT DEFAULT 'SOL'`, () => {})
  db.run(`ALTER TABLE guild_wallets ADD COLUMN network TEXT DEFAULT 'mainnet-beta'`, () => {})
  db.run(`ALTER TABLE guild_wallets ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`, () => {})

  // Transactions
  db.run(
    `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      from_address TEXT NOT NULL,
      to_address TEXT NOT NULL,
      amount REAL NOT NULL,
      signature TEXT UNIQUE,
      status TEXT DEFAULT 'confirmed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  )

  // Task assignments
  db.run(
    `CREATE TABLE IF NOT EXISTS task_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bulk_task_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      assigned_user_id TEXT NOT NULL,
      claimed_channel_id TEXT,
      status TEXT DEFAULT 'assigned',
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  )

  // Proof submissions
  db.run(
    `CREATE TABLE IF NOT EXISTS proof_submissions (
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
      rejection_reason TEXT
    )`
  )

  // Activity feed
  db.run(
    `CREATE TABLE IF NOT EXISTS activity_feed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      user_tag TEXT,
      amount REAL,
      currency TEXT DEFAULT 'SOL',
      reference_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  )

  // Events (scheduled events)
  db.run(
    `CREATE TABLE IF NOT EXISTS events (
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  )

  // Event participants
  db.run(
    `CREATE TABLE IF NOT EXISTS event_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, user_id)
    )`
  )

  // DCB Worker Roles (Staff / Admin)
  db.run(
    `CREATE TABLE IF NOT EXISTS dcb_workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      username TEXT,
      role TEXT NOT NULL DEFAULT 'staff',
      added_by TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      removed_at DATETIME,
      UNIQUE(guild_id, discord_id)
    )`
  )

  // Worker activity log
  db.run(
    `CREATE TABLE IF NOT EXISTS worker_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      detail TEXT,
      amount REAL,
      currency TEXT,
      channel_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  )

  // Worker daily stats
  db.run(
    `CREATE TABLE IF NOT EXISTS worker_daily_stats (
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
      events_created INTEGER DEFAULT 0,
      UNIQUE(guild_id, discord_id, stat_date)
    )`
  )

  // Migration: add events_created if missing
  db.run(`ALTER TABLE worker_daily_stats ADD COLUMN events_created INTEGER DEFAULT 0`, () => {})

  // Migration: add qualification_url to vote_events
  db.run(`ALTER TABLE vote_events ADD COLUMN qualification_url TEXT`, () => {})

  // Vote Event Qualifications table
  db.run(
    `CREATE TABLE IF NOT EXISTS vote_event_qualifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vote_event_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT DEFAULT '',
      screenshot_url TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      reviewed_by TEXT,
      UNIQUE(vote_event_id, user_id)
    )`
  )

  // User accounts – links Google / Discord identities
  db.run(
    `CREATE TABLE IF NOT EXISTS user_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT,
      google_id TEXT,
      google_email TEXT,
      google_name TEXT,
      google_picture TEXT,
      last_login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(discord_id),
      UNIQUE(google_id)
    )`
  )

  // User preferences – persists selected guild, page, etc. across sessions
  db.run(
    `CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      selected_guild_id TEXT,
      selected_page TEXT DEFAULT 'dashboard',
      extra_json TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  )
})

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err)
      resolve({ lastID: this.lastID, changes: this.changes })
    })
  })
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err)
      resolve(row || null)
    })
  })
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err)
      resolve(rows || [])
    })
  })
}

module.exports = {
  db,
  run,
  get,
  all,
}
