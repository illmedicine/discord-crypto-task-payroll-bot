#!/usr/bin/env node
/**
 * Recovery Audit Tool
 * Fetches failed payments data from the backend and displays a summary.
 * 
 * Usage:
 *   node scripts/run-recovery-audit.js <DCB_INTERNAL_SECRET> [guildId]
 * 
 * Or set env var:
 *   DCB_INTERNAL_SECRET=xxx node scripts/run-recovery-audit.js [guildId]
 */

const https = require('https');

const API_BASE = 'https://dcb-payroll-backend-production.up.railway.app';
const secret = process.argv[2] || process.env.DCB_INTERNAL_SECRET;
const guildId = process.argv[3] || process.env.GUILD_ID || '';

if (!secret) {
  console.error('❌ Usage: node scripts/run-recovery-audit.js <DCB_INTERNAL_SECRET> [guildId]');
  console.error('   Or set DCB_INTERNAL_SECRET env var');
  process.exit(1);
}

const url = `${API_BASE}/api/admin/failed-payments${guildId ? `?guildId=${guildId}` : ''}`;

console.log(`\n🔍 Running Recovery Audit...`);
console.log(`   Backend: ${API_BASE}`);
if (guildId) console.log(`   Guild:   ${guildId}`);
console.log('');

const req = https.get(url, { headers: { 'x-dcb-internal-secret': secret } }, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error(`❌ HTTP ${res.statusCode}: ${data}`);
      process.exit(1);
    }

    try {
      const r = JSON.parse(data);
      
      console.log('═══════════════════════════════════════════════════════');
      console.log('   💰 COMPREHENSIVE FAILED PAYMENTS RECOVERY AUDIT');
      console.log('═══════════════════════════════════════════════════════\n');

      // ─── Grand Total ──────────────────────────────────────────
      const gt = r.grandTotal;
      console.log('🏦 GRAND TOTAL');
      console.log('───────────────────────────────────────────────────────');
      console.log(`  Worker Payouts Owed:    ${(gt.workerOwedSol || 0).toFixed(6)} SOL`);
      console.log(`  Gambling Events Owed:   ${(gt.gamblingOwedSol || 0).toFixed(6)} SOL`);
      console.log(`  Poker Events Owed:      ${(gt.pokerOwedSol || 0).toFixed(6)} SOL`);
      console.log(`  ⚠️  TOTAL OWED:          ${(gt.totalOwedSol || 0).toFixed(6)} SOL`);
      console.log('');

      // ─── Worker Payouts ────────────────────────────────────────
      const wp = r.workerPayouts;
      console.log(`💸 WORKER PAYOUTS (${wp.stats?.failed || 0} failed of ${wp.stats?.total || 0} total)`);
      console.log('───────────────────────────────────────────────────────');
      if (wp.statusDistribution?.length) {
        console.log('  Status Distribution:');
        for (const s of wp.statusDistribution) console.log(`    ${s.status}: ${s.cnt} (${parseFloat(s.total_sol || 0).toFixed(4)} SOL)`);
      }
      if (wp.records?.length) {
        console.log(`\n  Failed Records (${wp.records.length}):`);
        for (const p of wp.records) {
          console.log(`    #${p.id} | ${p.status} | ${p.amount_sol} SOL ($${p.amount_usd || '?'}) → ${p.recipient_address || 'no addr'} | ${p.created_at}`);
        }
      } else {
        console.log('  ✅ No failed worker payout records found.');
      }
      console.log('');

      // ─── Gambling (Horse Race) ─────────────────────────────────
      const ge = r.gamblingEvents;
      const gStats = ge.stats || {};
      console.log(`🐎 GAMBLING EVENT FAILURES (${(gStats.payout_failed_cnt || 0) + (gStats.refund_failed_cnt || 0)} total)`);
      console.log('───────────────────────────────────────────────────────');
      if (ge.statusDistribution?.length) {
        console.log('  Status Distribution:');
        for (const s of ge.statusDistribution) console.log(`    ${s.payment_status}: ${s.cnt} (${parseFloat(s.total_amount || 0).toFixed(4)} SOL/currency)`);
      }
      console.log(`  Payout Failed: ${gStats.payout_failed_cnt || 0} records (${parseFloat(gStats.payout_failed_sol || 0).toFixed(6)} SOL)`);
      console.log(`  Refund Failed: ${gStats.refund_failed_cnt || 0} records (${parseFloat(gStats.refund_failed_sol || 0).toFixed(6)} SOL)`);
      if (ge.records?.length) {
        console.log(`\n  Failed Records (${ge.records.length}):`);
        for (const b of ge.records) {
          console.log(`    Event: "${b.event_title}" (#${b.gambling_event_id}) [${b.event_mode}/${b.currency}]`);
          console.log(`    User: ${b.username || b.user_id} | ${b.payment_status} | ${b.bet_amount} ${b.currency || 'SOL'}`);
          console.log(`    Wallet: ${b.wallet_address || 'NONE'} | Entry TX: ${b.entry_tx_signature ? '✅' : '❌'} | Payout TX: ${b.payout_tx_signature ? '✅' : '❌'}`);
          console.log('');
        }
      } else {
        console.log('  ✅ No failed gambling event records found.');
      }
      console.log('');

      // ─── Poker ─────────────────────────────────────────────────
      const pe = r.pokerEvents;
      const pStats = pe.stats || {};
      console.log(`🃏 POKER EVENT FAILURES (${(pStats.payout_failed_cnt || 0) + (pStats.stuck_committed_cnt || 0)} total)`);
      console.log('───────────────────────────────────────────────────────');
      if (pe.statusDistribution?.length) {
        console.log('  Status Distribution:');
        for (const s of pe.statusDistribution) console.log(`    ${s.payment_status}: ${s.cnt} (buy-in: ${parseFloat(s.total_buy_in || 0).toFixed(4)}, payout: ${parseFloat(s.total_payout || 0).toFixed(4)})`);
      }
      console.log(`  Payout Failed:       ${pStats.payout_failed_cnt || 0} records (${parseFloat(pStats.payout_failed_sol || 0).toFixed(6)} SOL)`);
      console.log(`  Stuck (committed):   ${pStats.stuck_committed_cnt || 0} records (${parseFloat(pStats.stuck_committed_sol || 0).toFixed(6)} SOL buy-in)`);
      if (pe.records?.length) {
        console.log(`\n  Failed Records (${pe.records.length}):`);
        for (const p of pe.records) {
          console.log(`    Event: "${p.event_title}" (#${p.poker_event_id}) [${p.event_mode}/${p.currency}]`);
          console.log(`    User: ${p.user_id} | ${p.payment_status} | Buy-in: ${p.buy_in_amount} SOL | Chips: ${p.final_chips} | Payout: ${p.payout_amount || '?'} SOL`);
          console.log(`    Wallet: ${p.wallet_address || 'NONE'} | Entry TX: ${p.entry_tx_signature ? '✅' : '❌'} | Payout TX: ${p.payout_tx_signature ? '✅' : '❌'}`);
          console.log('');
        }
      } else {
        console.log('  ✅ No failed poker event records found.');
      }

      console.log('\n═══════════════════════════════════════════════════════');
      if (gt.totalOwedSol > 0) {
        console.log('⚠️  ACTION REQUIRED: Manual recovery needed.');
        console.log('   All stuck funds remain in the guild treasury wallet.');
        console.log('   Send owed SOL directly to each wallet address listed.');
      } else {
        console.log('✅ No recovery needed — all payments accounted for!');
      }
      console.log('═══════════════════════════════════════════════════════\n');

    } catch (e) {
      console.error('❌ Failed to parse response:', e.message);
      console.error('Raw:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Request failed:', e.message);
  process.exit(1);
});
