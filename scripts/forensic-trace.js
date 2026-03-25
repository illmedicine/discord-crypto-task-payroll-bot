/**
 * FORENSIC TRACE SCRIPT
 * Queries all database tables for a specific Discord user ID
 * Run: node scripts/forensic-trace.js
 */

const SUSPECT_ID = '1456689623328624929';

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

let db;

async function initDb() {
  const dbPaths = [
    '/data/payroll.db',
    path.join(process.cwd(), 'payroll.db'),
    path.join(__dirname, '..', 'payroll.db'),
  ];
  
  for (const p of dbPaths) {
    if (fs.existsSync(p)) {
      console.log(`[DB] Using database: ${p}`);
      return new Promise((resolve, reject) => {
        db = new sqlite3.Database(p, sqlite3.OPEN_READONLY, (err) => {
          if (err) reject(err);
          else resolve(true);
        });
      });
    }
  }
  console.log('[DB] No local database found.');
  return false;
}

function querySafe(sql, params = []) {
  return new Promise((resolve) => {
    db.all(sql, params, (err, rows) => {
      if (err) resolve([]);
      else resolve(rows || []);
    });
  });
}

function getSafe(sql, params = []) {
  return new Promise((resolve) => {
    db.get(sql, params, (err, row) => {
      if (err) resolve(null);
      else resolve(row || null);
    });
  });
}

async function runForensics() {
  console.log('='.repeat(80));
  console.log(`FORENSIC TRACE REPORT — Discord User ID: ${SUSPECT_ID}`);
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  const hasDb = await initDb();
  
  if (!hasDb) {
    console.log('\n⚠️  No local DB. Copy payroll.db from Railway first:');
    console.log('   railway run -- cp /data/payroll.db ./payroll.db');
    console.log('   Then re-run this script.\n');
    return;
  }

  // ──────────────────────────────────────────────
  // 1. USER ACCOUNT (Discord OAuth login data)
  // ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('1. USER ACCOUNT (user_accounts table)');
  console.log('─'.repeat(60));
  // List all tables in DB
  const tables = await querySafe("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log('\nTABLES IN DB:', tables.map(t => t.name).join(', '));

  const account = await getSafe(
    'SELECT * FROM user_accounts WHERE discord_id = ?',
    [SUSPECT_ID]
  );
  if (account) {
    for (const [k,v] of Object.entries(account)) {
      if (k.includes('secret') || k.includes('token')) { console.log(`    ${k}: ***REDACTED***`); continue; }
      console.log(`    ${k}: ${v}`);
    }
  } else {
    console.log('  ❌ No account found for this Discord ID');
  }

  // ──────────────────────────────────────────────
  // 2. LINKED WALLETS (DCB wallet system)
  // ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('2. LINKED WALLETS (user_wallets table — DCB system)');
  console.log('─'.repeat(60));
  const dcbWallet = await getSafe(
    'SELECT * FROM user_wallets WHERE discord_id = ?',
    [SUSPECT_ID]
  );
  if (dcbWallet) {
    for (const [k,v] of Object.entries(dcbWallet)) {
      if (k.includes('secret') || k.includes('token')) { console.log(`    ${k}: ***REDACTED***`); continue; }
      console.log(`    ${k}: ${v}`);
    }
    if (dcbWallet.solana_address) console.log(`\n  🔗 Solscan: https://solscan.io/account/${dcbWallet.solana_address}`);
  } else {
    console.log('  ❌ No DCB wallet linked for this Discord ID');
  }

  // ──────────────────────────────────────────────
  // 3. BEAST USER WALLETS (casino deposit/winnings wallets)
  // ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('3. BEAST CASINO WALLETS (beast_user_wallets table)');
  console.log('─'.repeat(60));
  const beastWallets = await querySafe(
    'SELECT id, user_id, wallet_type, wallet_address, label, source_game, source_bet_id, balance_cache, created_at FROM beast_user_wallets WHERE user_id = ? ORDER BY created_at',
    [SUSPECT_ID]
  );
  if (beastWallets.length) {
    beastWallets.forEach((w, i) => {
      console.log(`\n  Wallet #${i + 1}:`);
      console.log('    ID:           ', w.id);
      console.log('    Type:         ', w.wallet_type);
      console.log('    Address:      ', w.wallet_address);
      console.log('    Label:        ', w.label || '(none)');
      console.log('    Source Game:   ', w.source_game || '(none)');
      console.log('    Source Bet:    ', w.source_bet_id || '(none)');
      console.log('    Balance Cache: ', w.balance_cache, 'SOL');
      console.log('    Created:      ', w.created_at);
      console.log(`    🔗 Solscan: https://solscan.io/account/${w.wallet_address}`);
    });
    console.log(`\n  Total beast wallets: ${beastWallets.length}`);
  } else {
    console.log('  ❌ No beast casino wallets found for this Discord ID');
  }

  // ──────────────────────────────────────────────
  // 4. BEAST PROFILE
  // ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('4. BEAST PROFILE (beast_profiles table)');
  console.log('─'.repeat(60));
  const profile = await getSafe(
    'SELECT * FROM beast_profiles WHERE user_id = ?',
    [SUSPECT_ID]
  );
  if (profile) {
    for (const [k,v] of Object.entries(profile)) console.log(`    ${k}: ${v}`);
  } else {
    console.log('  ❌ No beast profile found for this Discord ID');
  }

  // ──────────────────────────────────────────────
  // 5. ALL BETS PLACED
  // ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('5. ALL BETS (beast_bets table)');
  console.log('─'.repeat(60));
  const bets = await querySafe(
    'SELECT id, game_id, bet_amount, currency, won, multiplier, payout, server_seed, details, created_at FROM beast_bets WHERE user_id = ? ORDER BY created_at',
    [SUSPECT_ID]
  );
  if (bets.length) {
    let totalWagered = 0, totalPayout = 0, wins = 0;
    bets.forEach((b, i) => {
      totalWagered += b.bet_amount;
      totalPayout += b.payout;
      if (b.won) wins++;
      console.log(`\n  Bet #${i + 1} (ID: ${b.id}):`);
      console.log('    Game:       ', b.game_id);
      console.log('    Bet Amount: ', b.bet_amount, b.currency);
      console.log('    Won:        ', b.won ? '✅ YES' : '❌ NO');
      console.log('    Multiplier: ', b.multiplier, 'x');
      console.log('    Payout:     ', b.payout, b.currency);
      console.log('    Server Seed:', b.server_seed);
      console.log('    Details:    ', b.details);
      console.log('    Time:       ', b.created_at);
    });
    console.log(`\n  📊 BET SUMMARY:`);
    console.log(`    Total Bets:    ${bets.length}`);
    console.log(`    Total Wagered: ${totalWagered.toFixed(6)} SOL`);
    console.log(`    Total Payout:  ${totalPayout.toFixed(6)} SOL`);
    console.log(`    Net P/L:       ${(totalPayout - totalWagered).toFixed(6)} SOL`);
    console.log(`    Win Rate:      ${((wins / bets.length) * 100).toFixed(1)}%`);
  } else {
    console.log('  ❌ No bets found for this Discord ID');
  }

  // ──────────────────────────────────────────────
  // 6. ALL TREASURY TRANSACTIONS (wagers, payouts, withdrawals, fees)
  // ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('6. TREASURY TRANSACTIONS (beast_treasury_txns table)');
  console.log('─'.repeat(60));
  const txns = await querySafe(
    'SELECT id, type, currency, amount, balance_after, bet_id, user_id, username, details, tx_signature, created_at FROM beast_treasury_txns WHERE user_id = ? ORDER BY created_at',
    [SUSPECT_ID]
  );
  if (txns.length) {
    txns.forEach((t, i) => {
      console.log(`\n  TX #${i + 1} (ID: ${t.id}):`);
      console.log('    Type:           ', t.type);
      console.log('    Amount:         ', t.amount, t.currency);
      console.log('    Balance After:  ', t.balance_after);
      console.log('    Bet ID:         ', t.bet_id || '(none)');
      console.log('    Username:       ', t.username);
      console.log('    Details:        ', t.details);
      console.log('    TX Signature:   ', t.tx_signature || '(none)');
      if (t.tx_signature) {
        console.log(`    🔗 Solscan TX: https://solscan.io/tx/${t.tx_signature}`);
      }
      console.log('    Time:           ', t.created_at);
    });
    
    // Collect all unique TX signatures
    const sigs = txns.filter(t => t.tx_signature).map(t => t.tx_signature);
    if (sigs.length) {
      console.log(`\n  📋 ALL ON-CHAIN TX SIGNATURES (for Solscan/law enforcement):`);
      sigs.forEach(s => console.log(`    https://solscan.io/tx/${s}`));
    }
  } else {
    console.log('  ❌ No treasury transactions found for this Discord ID');
  }

  // ──────────────────────────────────────────────
  // 7. ALL WITHDRAWALS
  // ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('7. WITHDRAWALS (beast_withdrawals table)');
  console.log('─'.repeat(60));
  const withdrawals = await querySafe(
    'SELECT id, user_id, currency, amount, to_address, status, tx_signature, fee, fee_percent, created_at FROM beast_withdrawals WHERE user_id = ? ORDER BY created_at',
    [SUSPECT_ID]
  );
  if (withdrawals.length) {
    let totalWithdrawn = 0;
    withdrawals.forEach((w, i) => {
      totalWithdrawn += w.amount;
      console.log(`\n  Withdrawal #${i + 1} (ID: ${w.id}):`);
      console.log('    Amount:       ', w.amount, w.currency);
      console.log('    To Address:   ', w.to_address);
      console.log('    Status:       ', w.status);
      console.log('    Fee:          ', w.fee, `(${w.fee_percent}%)`);
      console.log('    TX Signature: ', w.tx_signature || '(none)');
      if (w.tx_signature) {
        console.log(`    🔗 Solscan TX: https://solscan.io/tx/${w.tx_signature}`);
      }
      if (w.to_address) {
        console.log(`    🔗 Destination: https://solscan.io/account/${w.to_address}`);
      }
      console.log('    Time:         ', w.created_at);
    });
    console.log(`\n  💸 Total Withdrawn: ${totalWithdrawn.toFixed(6)} SOL`);
  } else {
    console.log('  ❌ No withdrawals found for this Discord ID');
  }

  // ──────────────────────────────────────────────
  // 8. GAMBLING EVENT BETS (poker/gambling events)
  // ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('8. GAMBLING EVENT BETS (gambling_event_bets table)');
  console.log('─'.repeat(60));
  const gamblingBets = await querySafe(
    'SELECT * FROM gambling_event_bets WHERE user_id = ? ORDER BY created_at',
    [SUSPECT_ID]
  );
  if (gamblingBets.length) {
    gamblingBets.forEach((b, i) => {
      console.log(`\n  Event Bet #${i + 1}:`, JSON.stringify(b, null, 2));
    });
  } else {
    console.log('  ❌ No gambling event bets found');
  }

  // ──────────────────────────────────────────────
  // 9. POKER EVENT PLAYERS
  // ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('9. POKER EVENTS (poker_event_players table)');
  console.log('─'.repeat(60));
  const pokerPlayers = await querySafe(
    'SELECT * FROM poker_event_players WHERE user_id = ? ORDER BY joined_at',
    [SUSPECT_ID]
  );
  if (pokerPlayers.length) {
    pokerPlayers.forEach((p, i) => {
      console.log(`\n  Poker Entry #${i + 1}:`, JSON.stringify(p, null, 2));
    });
  } else {
    console.log('  ❌ No poker event entries found');
  }

  // ──────────────────────────────────────────────
  // 10. WORKER PAYOUTS (was this user ever paid as staff?)
  // ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('10. PAYROLL (worker_payouts table)');
  console.log('─'.repeat(60));
  const payouts = await querySafe(
    'SELECT * FROM worker_payouts WHERE recipient_discord_id = ? ORDER BY paid_at',
    [SUSPECT_ID]
  );
  if (payouts.length) {
    payouts.forEach((p, i) => {
      console.log(`\n  Payout #${i + 1}:`, JSON.stringify(p, null, 2));
    });
  } else {
    console.log('  ❌ No payroll payouts found for this Discord ID');
  }

  // ──────────────────────────────────────────────
  // 11. TRANSACTIONS TABLE (general tx log)
  // ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('11. GENERAL TRANSACTIONS (transactions table)');
  console.log('─'.repeat(60));
  const generalTx = await querySafe(
    'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 100'
  );
  // Filter for any tx involving suspect's known addresses
  const suspectAddresses = new Set();
  if (dcbWallet) suspectAddresses.add(dcbWallet.solana_address);
  beastWallets.forEach(w => suspectAddresses.add(w.wallet_address));
  if (withdrawals.length) withdrawals.forEach(w => { if (w.to_address) suspectAddresses.add(w.to_address); });

  if (suspectAddresses.size > 0) {
    console.log(`\n  Suspect addresses to trace: ${[...suspectAddresses].join(', ')}`);
    const relatedTx = generalTx.filter(t => 
      suspectAddresses.has(t.from_address) || suspectAddresses.has(t.to_address)
    );
    if (relatedTx.length) {
      relatedTx.forEach((t, i) => {
        console.log(`\n  TX #${i + 1}:`, JSON.stringify(t, null, 2));
      });
    } else {
      console.log('  ❌ No general transactions matching suspect addresses');
    }
  }

  // ──────────────────────────────────────────────
  // 12. TREASURY WALLET — Current state (was it drained?)
  // ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('12. TREASURY STATE (beast_treasury table)');
  console.log('─'.repeat(60));
  const treasury = await getSafe('SELECT * FROM beast_treasury WHERE id = ?', ['beast_main']);
  if (treasury) {
    for (const [k,v] of Object.entries(treasury)) {
      if (k.includes('secret') || k.includes('token')) { console.log(`    ${k}: ***REDACTED***`); continue; }
      console.log(`    ${k}: ${v}`);
    }
    if (treasury.wallet_address) console.log(`\n  🔗 Treasury Solscan: https://solscan.io/account/${treasury.wallet_address}`);
  }

  // ──────────────────────────────────────────────
  // 13. ALL RECENT LARGE PAYOUTS (suspicious activity scan)
  // ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('13. RECENT LARGE PAYOUTS FROM TREASURY (last 50 txns)');
  console.log('─'.repeat(60));
  const recentPayouts = await querySafe(
    "SELECT * FROM beast_treasury_txns WHERE type IN ('payout', 'withdrawal') ORDER BY created_at DESC LIMIT 50"
  );
  if (recentPayouts.length) {
    recentPayouts.forEach((t, i) => {
      const flag = t.user_id === SUSPECT_ID ? ' ⚠️ SUSPECT' : '';
      console.log(`  ${t.created_at} | ${t.type.padEnd(12)} | ${t.amount.toFixed(6)} ${t.currency} | ${t.username || t.user_id}${flag} | TX: ${t.tx_signature || 'none'}`);
    });
  }

  // ──────────────────────────────────────────────
  // 14. COLLECT ALL EVIDENCE ADDRESSES & TX HASHES
  // ──────────────────────────────────────────────
  console.log('\n' + '='.repeat(80));
  console.log('EVIDENCE SUMMARY — FOR LAW ENFORCEMENT');
  console.log('='.repeat(80));

  console.log('\n📋 SUSPECT DISCORD ID:', SUSPECT_ID);
  
  if (account) {
    console.log('📋 LAST LOGIN:', account.last_login_at);
    console.log('📋 ACCOUNT CREATED:', account.created_at);
    if (account.google_email) console.log('📋 GOOGLE EMAIL:', account.google_email);
    if (account.google_name) console.log('📋 GOOGLE NAME:', account.google_name);
    if (account.discord_access_token) console.log('📋 HAS DISCORD OAuth TOKEN: YES (can query Discord API for user email/info)');
  }

  console.log('\n📋 ALL SUSPECT WALLET ADDRESSES:');
  if (dcbWallet && dcbWallet.solana_address) {
    console.log(`  [DCB Linked]  ${dcbWallet.solana_address}  →  https://solscan.io/account/${dcbWallet.solana_address}`);
  }
  (beastWallets || []).forEach(w => {
    console.log(`  [Beast ${(w.wallet_type||'').padEnd(10)}] ${w.wallet_address}  →  https://solscan.io/account/${w.wallet_address}`);
  });
  (withdrawals || []).forEach(w => {
    if (w.to_address) {
      console.log(`  [Withdrawal]  ${w.to_address}  →  https://solscan.io/account/${w.to_address}`);
    }
  });

  // Collect ALL tx signatures
  const allSigs = new Set();
  (txns || []).filter(t => t.tx_signature).forEach(t => allSigs.add(t.tx_signature));
  (withdrawals || []).filter(w => w.tx_signature).forEach(w => allSigs.add(w.tx_signature));
  
  if (allSigs.size) {
    console.log('\n📋 ALL ON-CHAIN TRANSACTION SIGNATURES:');
    [...allSigs].forEach(s => {
      console.log(`  ${s}  →  https://solscan.io/tx/${s}`);
    });
  }

  // Financial summary
  const totalWagered = (bets || []).reduce((s, b) => s + (b.bet_amount || 0), 0);
  const totalPayout = (bets || []).reduce((s, b) => s + (b.payout || 0), 0);
  const totalWithdrawn = (withdrawals || []).reduce((s, w) => s + (w.amount || 0), 0);

  console.log('\n📋 FINANCIAL SUMMARY:');
  console.log(`  Total Wagered:    ${totalWagered.toFixed(6)} SOL`);
  console.log(`  Total Won:        ${totalPayout.toFixed(6)} SOL`);
  console.log(`  Net Win/Loss:     ${(totalPayout - totalWagered).toFixed(6)} SOL`);
  console.log(`  Total Withdrawn:  ${totalWithdrawn.toFixed(6)} SOL`);

  console.log('\n' + '='.repeat(80));
  console.log('⚠️  IP ADDRESSES: NOT persisted in database. Check Railway logs:');
  console.log(`    railway logs --filter "${SUSPECT_ID}" --since 7d`);
  console.log('    railway logs --filter "OAuth" --since 7d');
  console.log('\n⚠️  DISCORD USER INFO: If stored OAuth access_token is still valid, query:');
  console.log('    GET https://discord.com/api/v10/users/@me (with Bearer token)');
  console.log('    Returns: username, email, locale, avatar, mfa_enabled');
  console.log('\n📌 NEXT STEPS FOR PROSECUTION:');
  console.log('  1. Trace all wallet addresses on Solscan for outbound transfers');
  console.log('  2. Check if funds went to a centralized exchange (Binance, Coinbase, etc.)');
  console.log('  3. If exchange-bound, subpoena exchange for KYC records');
  console.log('  4. Check Railway deployment logs for IP addresses');
  console.log('  5. File IC3 report: https://www.ic3.gov');
  console.log('  6. File with FBI cybercrime if US-based');
  console.log('  7. Contact Solana Foundation for chain analysis support');
  console.log('  8. Use Discord API with stored OAuth token to get user email');
  console.log('='.repeat(80));

  db.close();
}

runForensics().then(() => {
  console.log('\nDone.');
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
