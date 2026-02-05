-- This file contains the schema additions for scheduled_posts

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
);
