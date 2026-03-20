//
// utils/prestige.js — DCB Prestige Badge System
// Tier grades: S (highest) → A → B → C → D (lowest)
// Calculated from tangible, publicly-available user activity metadata.
//

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

// ── Tier thresholds ──
function prestigeTier(score) {
  if (score >= 90) return 'S';
  if (score >= 65) return 'A';
  if (score >= 40) return 'B';
  if (score >= 20) return 'C';
  return 'D';
}

// ── Tier display config ──
const TIER_CONFIG = {
  S: { label: 'S', emoji: '👑', color: '#f1c40f', title: 'Sovereign' },
  A: { label: 'A', emoji: '💎', color: '#c084fc', title: 'Ace' },
  B: { label: 'B', emoji: '⚡', color: '#60a5fa', title: 'Bold' },
  C: { label: 'C', emoji: '🔷', color: '#34d399', title: 'Contender' },
  D: { label: 'D', emoji: '🔹', color: '#94a3b8', title: 'Debut' },
};

// ── Sub-score functions (all return 0..max) ──

function scoreRaceBets(count) {
  // 0→0, 1→3, 5→8, 15→14, 30+→20
  if (count >= 30) return 20;
  if (count >= 15) return 14;
  if (count >= 5) return 8;
  if (count >= 1) return 3;
  return 0;
}

function scoreRaceWins(count) {
  if (count >= 10) return 10;
  if (count >= 5) return 7;
  if (count >= 2) return 4;
  if (count >= 1) return 2;
  return 0;
}

function scoreVoteParticipation(count) {
  if (count >= 20) return 10;
  if (count >= 10) return 7;
  if (count >= 3) return 4;
  if (count >= 1) return 2;
  return 0;
}

function scorePokerPlayed(count) {
  if (count >= 15) return 10;
  if (count >= 5) return 7;
  if (count >= 2) return 4;
  if (count >= 1) return 2;
  return 0;
}

function scoreEventsCreated(count) {
  if (count >= 10) return 10;
  if (count >= 5) return 7;
  if (count >= 2) return 4;
  if (count >= 1) return 2;
  return 0;
}

function scoreCommands(total) {
  if (total >= 500) return 15;
  if (total >= 200) return 12;
  if (total >= 50) return 8;
  if (total >= 10) return 4;
  if (total >= 1) return 1;
  return 0;
}

function scoreTenure(days) {
  if (days >= 180) return 15;
  if (days >= 90) return 12;
  if (days >= 30) return 8;
  if (days >= 7) return 4;
  if (days >= 1) return 1;
  return 0;
}

function scoreWallet(hasWallet, hasAutoPayKey) {
  let pts = 0;
  if (hasWallet) pts += 5;
  if (hasAutoPayKey) pts += 5;
  return pts;
}

/**
 * Calculate prestige for a user given their activity stats.
 * @param {Object} stats - { raceBets, raceWins, voteJoins, pokerPlayed, eventsCreated, commands, tenureDays, hasWallet, hasAutoPayKey }
 * @returns {{ score: number, tier: string, config: object, breakdown: object }}
 */
function calcPrestige(stats) {
  const breakdown = {
    raceBets:      scoreRaceBets(stats.raceBets || 0),
    raceWins:      scoreRaceWins(stats.raceWins || 0),
    voteJoins:     scoreVoteParticipation(stats.voteJoins || 0),
    pokerPlayed:   scorePokerPlayed(stats.pokerPlayed || 0),
    eventsCreated: scoreEventsCreated(stats.eventsCreated || 0),
    commands:      scoreCommands(stats.commands || 0),
    tenure:        scoreTenure(stats.tenureDays || 0),
    wallet:        scoreWallet(stats.hasWallet, stats.hasAutoPayKey),
  };
  const raw = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const score = clamp(raw, 0, 100);
  const tier = prestigeTier(score);
  return { score, tier, config: TIER_CONFIG[tier], breakdown };
}

/**
 * Build a compact prestige badge string for Discord embeds.
 * e.g. "👑 S-Tier (Sovereign) — Prestige 92/100"
 */
function prestigeLine(score) {
  const tier = prestigeTier(score);
  const cfg = TIER_CONFIG[tier];
  return `${cfg.emoji} ${tier}-Tier (${cfg.title}) — Prestige ${score}/100`;
}

/**
 * Gather all activity stats for a user from the bot DB.
 * @param {Object} db — bot database module (utils/db.js)
 * @param {string} userId — Discord user ID
 * @returns {Promise<Object>} stats object suitable for calcPrestige()
 */
async function gatherPrestigeStats(db, userId) {
  const wrap = (p) => p.catch(() => null);

  const [userRow, statsRow, raceBetsRow, raceWinsRow, voteRow, pokerRow, eventsRow] = await Promise.all([
    wrap(db.getUser(userId)),
    wrap(db.getUserStats(userId)),
    // Race bets placed
    wrap(new Promise((resolve, reject) => {
      db.db.get(`SELECT COUNT(*) as c FROM gambling_event_bets WHERE user_id = ?`, [userId], (err, r) => err ? reject(err) : resolve(r));
    })),
    // Race wins
    wrap(new Promise((resolve, reject) => {
      db.db.get(`SELECT COUNT(*) as c FROM gambling_event_bets WHERE user_id = ? AND is_winner = 1`, [userId], (err, r) => err ? reject(err) : resolve(r));
    })),
    // Vote event participation
    wrap(new Promise((resolve, reject) => {
      db.db.get(`SELECT COUNT(*) as c FROM vote_event_participants WHERE user_id = ?`, [userId], (err, r) => err ? reject(err) : resolve(r));
    })),
    // Poker events played
    wrap(new Promise((resolve, reject) => {
      db.db.get(`SELECT COUNT(*) as c FROM poker_event_players WHERE user_id = ?`, [userId], (err, r) => err ? reject(err) : resolve(r));
    })),
    // Events created (gambling + vote + poker + contests)
    wrap(new Promise((resolve, reject) => {
      db.db.get(
        `SELECT (SELECT COUNT(*) FROM gambling_events WHERE created_by = ?) +
                (SELECT COUNT(*) FROM vote_events WHERE created_by = ?) +
                (SELECT COUNT(*) FROM poker_events WHERE created_by = ?) +
                (SELECT COUNT(*) FROM contests WHERE created_by = ?) as c`,
        [userId, userId, userId, userId], (err, r) => err ? reject(err) : resolve(r));
    })),
  ]);

  const now = Date.now();
  const firstSeen = userRow?.created_at ? new Date(userRow.created_at).getTime()
    : statsRow?.first_seen_at ? new Date(statsRow.first_seen_at).getTime()
    : now;
  const tenureDays = Math.max(0, Math.floor((now - firstSeen) / 86400000));

  return {
    raceBets: raceBetsRow?.c || 0,
    raceWins: raceWinsRow?.c || 0,
    voteJoins: voteRow?.c || 0,
    pokerPlayed: pokerRow?.c || 0,
    eventsCreated: eventsRow?.c || 0,
    commands: statsRow?.commands_total || 0,
    tenureDays,
    hasWallet: !!(userRow?.solana_address),
    hasAutoPayKey: !!(userRow?.wallet_secret),
  };
}

module.exports = { calcPrestige, prestigeTier, prestigeLine, gatherPrestigeStats, TIER_CONFIG };
