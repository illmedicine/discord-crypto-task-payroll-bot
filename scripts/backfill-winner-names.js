/**
 * Backfill winner_names for completed gambling events from the past 24 hours.
 *
 * - Events with winners → comma-separated Discord display names
 * - Events with no winners (house wins) → "House"
 *
 * Usage:  node scripts/backfill-winner-names.js
 * Requires DISCORD_TOKEN in .env (or environment).
 */

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const BOT_DB_PATH = path.join(__dirname, '../payroll.db');

// Also patch backend DB if it lives alongside (Railway deploys separately, so
// the script will POST to the backend sync endpoint as a fallback).
const BACKEND_DB_PATH = path.join(__dirname, '../apps/backend/data/backend.db');

function openDB(dbPath) {
  return new sqlite3.Database(dbPath);
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
}

async function main() {
  console.log('🏇 Backfilling winner_names for events completed in the last 24 hours…\n');

  // 1. Open the bot's local DB
  const botDb = openDB(BOT_DB_PATH);

  // Ensure the column exists
  await dbRun(botDb, `ALTER TABLE gambling_events ADD COLUMN winner_names TEXT`).catch(() => {});

  // 2. Get completed events from the last 24 hours
  const events = await dbAll(
    botDb,
    `SELECT id, winning_slot FROM gambling_events
     WHERE status IN ('completed', 'ended')
       AND created_at >= datetime('now', '-24 hours')
     ORDER BY id DESC`
  );

  if (events.length === 0) {
    console.log('  No completed events in the past 24 hours.\n');
    botDb.close();
    return;
  }

  console.log(`  Found ${events.length} completed event(s). Resolving winners…\n`);

  // 3. Boot a minimal Discord client to resolve usernames
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);
  console.log(`  Logged in as ${client.user.tag}\n`);

  // Username cache to avoid duplicate fetches
  const nameCache = new Map();

  async function resolveName(userId) {
    if (nameCache.has(userId)) return nameCache.get(userId);
    try {
      const user = await client.users.fetch(userId);
      const name = user.displayName || user.username || userId;
      nameCache.set(userId, name);
      return name;
    } catch {
      nameCache.set(userId, userId);
      return userId;
    }
  }

  let updated = 0;

  for (const event of events) {
    // Get winner bets
    const winnerBets = await dbAll(
      botDb,
      `SELECT user_id FROM gambling_event_bets
       WHERE gambling_event_id = ? AND is_winner = 1`,
      [event.id]
    );

    let winnerNames;
    if (winnerBets.length === 0) {
      winnerNames = 'House';
    } else {
      const names = [];
      for (const bet of winnerBets) {
        names.push(await resolveName(bet.user_id));
      }
      winnerNames = names.join(', ');
    }

    // Update bot DB
    await dbRun(botDb, `UPDATE gambling_events SET winner_names = ? WHERE id = ?`, [winnerNames, event.id]);
    console.log(`  Event #${event.id}: ${winnerNames}`);
    updated++;

    // Also push to backend via sync endpoint (if configured)
    try {
      const backendUrl = process.env.DCB_BACKEND_URL;
      const secret = process.env.DCB_INTERNAL_SECRET;
      if (backendUrl && secret) {
        await fetch(`${backendUrl.replace(/\/$/, '')}/api/internal/gambling-event-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-dcb-internal-secret': secret },
          body: JSON.stringify({
            eventId: event.id,
            action: 'status_update',
            status: 'completed',
            winnerNames,
            winningSlot: event.winning_slot,
          }),
        });
      }
    } catch (syncErr) {
      console.warn(`  ⚠️  Backend sync failed for #${event.id}: ${syncErr.message}`);
    }
  }

  console.log(`\n✅ Updated ${updated} event(s). Done.`);

  client.destroy();
  botDb.close();
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
