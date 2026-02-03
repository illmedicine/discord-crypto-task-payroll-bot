//
// utils/trustRisk.js - DCB Trust & Risk Scoring System
//

const ANCHOR_GUILD_ID = "1454132493006409942"; // Your main server

function clamp(n, min, max) { 
  return Math.max(min, Math.min(max, n)); 
}

function tierTrust(score) {
  if (score >= 85) return "Elite";
  if (score >= 70) return "High";
  if (score >= 50) return "Trusted";
  if (score >= 25) return "Basic";
  return "New";
}

function tierRisk(score) {
  if (score >= 75) return "Critical";
  if (score >= 50) return "High";
  if (score >= 25) return "Medium";
  return "Low";
}

function prefixLine(trust, risk) {
  return `🛡️ DCB Trust: ${trust} (${tierTrust(trust)}) • ⚠️ DCB Risk: ${risk} (${tierRisk(risk)})`;
}

function scoreTenureDays(days) {
  if (days >= 91) return 20;
  if (days >= 31) return 17;
  if (days >= 8) return 12;
  if (days >= 1) return 5;
  return 0;
}

function scoreCommands(total) {
  if (total >= 201) return 15;
  if (total >= 51) return 12;
  if (total >= 11) return 8;
  if (total >= 1) return 3;
  return 0;
}

function scoreDiscordAgeDays(days) {
  if (days >= 365) return 10;
  if (days >= 180) return 8;
  if (days >= 30) return 6;
  if (days >= 7) return 3;
  return 1;
}

function scoreSurfaceArea(ownerGuilds, activeGuilds) {
  const owner = Math.min(6, ownerGuilds * 2);               // 0..6
  const user = Math.min(9, Math.round(activeGuilds * 1.5)); // 0..9
  return owner + user; // 0..15
}

function scoreOutcomes(approved, rejected, total) {
  if (total <= 0) return 3;
  const approvalRate = approved / total;
  let score = 5 + Math.round(approvalRate * 5); // 5..10
  if (rejected / total > 0.25) score -= 2;
  if (rejected / total > 0.5) score -= 3;
  return clamp(score, 0, 10);
}

function riskFromOutcomes(approved, rejected, total) {
  let risk = 35;
  if (total > 0) {
    const rej = rejected / total;
    if (rej > 0.5) risk += 35;
    else if (rej > 0.25) risk += 20;
    else if (rej > 0.10) risk += 10;
  }
  return risk;
}

async function getTrustRisk({ db, user, guildId, guildAnchorMember }) {
  // Increment command counts
  await db.touchUserStats(user.id);

  const [u, stats, ownerGuilds, activeGuilds, proofStats] = await Promise.all([
    db.getUser(user.id),
    db.getUserStats(user.id),
    db.countOwnerConnectedGuilds(user.id),
    db.countUserActiveGuilds(user.id),
    db.getProofOutcomeStats(user.id),
  ]);

  const now = Date.now();
  const firstSeen = u?.created_at ? new Date(u.created_at).getTime()
                : stats?.first_seen_at ? new Date(stats.first_seen_at).getTime()
                : now;

  const tenureDays = Math.max(0, Math.floor((now - firstSeen) / (1000 * 60 * 60 * 24)));
  const discordAgeDays = Math.max(0, Math.floor((now - user.createdTimestamp) / (1000 * 60 * 60 * 24)));

  // TRUST (0..100)
  const trust =
    (guildAnchorMember ? 30 : 0) +
    scoreTenureDays(tenureDays) +                 // 20
    scoreCommands(stats?.commands_total || 0) +   // 15
    scoreSurfaceArea(ownerGuilds, activeGuilds) + // 15
    scoreDiscordAgeDays(discordAgeDays) +         // 10
    scoreOutcomes(proofStats.approved, proofStats.rejected, proofStats.total); // 10

  // RISK (0..100)
  let risk = riskFromOutcomes(proofStats.approved, proofStats.rejected, proofStats.total);

  // Discounts
  if (guildAnchorMember) risk -= 10;
  if (tenureDays >= 90) risk -= 10;
  if (proofStats.total > 10 && (proofStats.approved / proofStats.total) > 0.9) risk -= 10;

  // No wallet penalty (only after some usage)
  if (!u?.solana_address && (stats?.commands_total || 0) > 5) risk += 10;

  return {
    trust: clamp(Math.round(trust), 0, 100),
    risk: clamp(Math.round(risk), 0, 100),
    meta: {
      ownerGuilds,
      activeGuilds,
      tenureDays,
      discordAgeDays,
      commandsTotal: stats?.commands_total || 0,
      proofStats,
      guildAnchorMember,
      guildId
    }
  };
}

module.exports = { ANCHOR_GUILD_ID, prefixLine, getTrustRisk, tierTrust, tierRisk };
