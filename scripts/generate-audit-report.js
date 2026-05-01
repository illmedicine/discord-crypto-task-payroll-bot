#!/usr/bin/env node
/**
 * Treasury Audit Report Generator
 * --------------------------------
 * Walks the Solana on-chain history of every treasury wallet stored in the
 * local SQLite DB and writes a comprehensive CSV ledger covering:
 *   - outgoing payments (payouts to staff / participants)
 *   - incoming deposits (top-ups to the treasury)
 *   - per-transaction Solana network fees
 *
 * Designed for monthly bank-audit exports. Pulls from the same `payroll.db`
 * file the bot/backend uses, so the output is reconciled with internal
 * records (signature, original USD amount, etc.).
 *
 * Usage (from the discord-crypto-task-payroll-bot folder):
 *   node scripts/generate-audit-report.js                 # all-time, all guilds
 *   node scripts/generate-audit-report.js --guild=123     # one guild
 *   node scripts/generate-audit-report.js --from=2026-04-01 --to=2026-04-30
 *   node scripts/generate-audit-report.js --out=./reports/april.csv
 *   node scripts/generate-audit-report.js --no-sync       # use cached DB only
 *
 * Environment:
 *   DB_PATH or DCB_DB_PATH   path to payroll.db
 *   SOLANA_RPC_URL           defaults to https://api.mainnet-beta.solana.com
 */

const fs = require('fs')
const path = require('path')
const sqlite3 = require('sqlite3')
const axios = require('axios')

const LAMPORTS_PER_SOL = 1_000_000_000
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

// ── CLI args ────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]
  })
)
const guildFilter = args.guild || null
const from = args.from || null
const to = args.to || null
const noSync = !!args['no-sync']
const fullRescan = !!args.full
const hardCap = Number(args['hard-cap']) || 20000
const outPath = args.out
  ? path.resolve(args.out)
  : path.resolve(process.cwd(), `dcb-audit-${guildFilter || 'all'}_${from || 'all-time'}_to_${to || 'now'}_${new Date().toISOString().slice(0,10)}.csv`)

// ── DB connection ───────────────────────────────────────────────────────────
const dbPath =
  process.env.DB_PATH ||
  process.env.DCB_DB_PATH ||
  (fs.existsSync('/data/payroll.db') ? '/data/payroll.db' : path.join(__dirname, '..', 'payroll.db'))

if (!fs.existsSync(dbPath)) {
  console.error(`[audit] DB file not found at ${dbPath}. Set DB_PATH env to override.`)
  process.exit(1)
}

const db = new sqlite3.Database(dbPath)
const dbAll = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)))
const dbGet = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)))
const dbRun = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this) }))

// Migrations — same set the backend applies, idempotent.
async function ensureColumns() {
  const cols = [
    `ALTER TABLE transactions ADD COLUMN currency TEXT DEFAULT 'SOL'`,
    `ALTER TABLE transactions ADD COLUMN original_amount REAL`,
    `ALTER TABLE transactions ADD COLUMN original_currency TEXT`,
    `ALTER TABLE transactions ADD COLUMN network_fee REAL`,
    `ALTER TABLE transactions ADD COLUMN block_time INTEGER`,
    `ALTER TABLE transactions ADD COLUMN slot INTEGER`,
    `ALTER TABLE transactions ADD COLUMN direction TEXT`,
    `ALTER TABLE transactions ADD COLUMN counterparty TEXT`,
    `ALTER TABLE transactions ADD COLUMN treasury_address TEXT`,
    `ALTER TABLE transactions ADD COLUMN audit_synced_at DATETIME`,
  ]
  for (const sql of cols) { try { await dbRun(sql) } catch (_) {} }
}

// ── Solana RPC helpers ──────────────────────────────────────────────────────
const RPC_DELAY_MS = Number(args['rpc-delay']) || 120  // pause between RPC calls (public RPC ≈ 5 req/s safe)
const RPC_MAX_RETRIES = Number(args['rpc-retries']) || 6
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function rpc(method, params, timeout = 25000) {
  let attempt = 0
  let backoff = 500
  while (true) {
    try {
      const res = await axios.post(SOLANA_RPC_URL, { jsonrpc: '2.0', id: 1, method, params }, { timeout })
      if (res.data?.error) throw new Error(res.data.error.message || 'rpc_error')
      if (RPC_DELAY_MS) await sleep(RPC_DELAY_MS)
      return res.data?.result
    } catch (err) {
      const status = err?.response?.status
      const retriable = status === 429 || status === 502 || status === 503 || status === 504 || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT'
      if (!retriable || attempt >= RPC_MAX_RETRIES) throw err
      const wait = backoff + Math.floor(Math.random() * 250)
      if (status === 429) console.log(`[audit]   rate-limited (429), waiting ${wait}ms (attempt ${attempt + 1}/${RPC_MAX_RETRIES})`)
      await sleep(wait)
      backoff = Math.min(backoff * 2, 10000)
      attempt++
    }
  }
}

async function fetchAllSignatures(address, untilSignature) {
  const out = []
  let before = null
  while (out.length < hardCap) {
    const params = [address, { limit: 1000, ...(before ? { before } : {}) }]
    let page
    try { page = await rpc('getSignaturesForAddress', params) }
    catch (err) { console.warn(`[audit]   sig page failed: ${err.message}`); break }
    if (!Array.isArray(page) || !page.length) break
    let stop = false
    for (const it of page) {
      if (untilSignature && it.signature === untilSignature) { stop = true; break }
      out.push(it)
    }
    if (stop || page.length < 1000) break
    before = page[page.length - 1].signature
  }
  return out
}

function classifyTx(tx, treasury) {
  const accountKeys = tx.transaction?.message?.accountKeys || []
  const idx = accountKeys.findIndex(k => (typeof k === 'string' ? k : k?.pubkey) === treasury)
  if (idx === -1) return null
  const pre = tx.meta?.preBalances?.[idx] ?? 0
  const post = tx.meta?.postBalances?.[idx] ?? 0
  const fee = tx.meta?.fee ?? 0
  const isFeePayer = idx === 0
  const netLamports = post - pre
  const transferLamports = isFeePayer ? netLamports + fee : netLamports
  const sol = transferLamports / LAMPORTS_PER_SOL
  const feeSol = isFeePayer ? fee / LAMPORTS_PER_SOL : 0
  let direction = 'self'
  if (transferLamports < 0) direction = 'payout'
  else if (transferLamports > 0) direction = 'deposit'
  else if (isFeePayer && fee > 0) direction = 'fee_only'

  let counterparty = null, bestDelta = 0
  const pres = tx.meta?.preBalances || []
  const posts = tx.meta?.postBalances || []
  for (let i = 0; i < accountKeys.length; i++) {
    if (i === idx) continue
    const key = typeof accountKeys[i] === 'string' ? accountKeys[i] : accountKeys[i]?.pubkey
    if (!key) continue
    const delta = (posts[i] ?? 0) - (pres[i] ?? 0)
    if (transferLamports < 0 && delta > 0 && delta > bestDelta) { bestDelta = delta; counterparty = key }
    if (transferLamports > 0 && delta < 0 && -delta > bestDelta) { bestDelta = -delta; counterparty = key }
  }
  return { direction, sol: Math.abs(sol), fee: feeSol, counterparty, slot: tx.slot ?? null, blockTime: tx.blockTime ?? null }
}

// ── Sync ────────────────────────────────────────────────────────────────────
async function syncWallet(guildId, walletAddress) {
  let untilSig = null
  if (!fullRescan) {
    const last = await dbGet(
      `SELECT signature FROM transactions
        WHERE guild_id = ? AND treasury_address = ? AND audit_synced_at IS NOT NULL AND block_time IS NOT NULL
        ORDER BY block_time DESC LIMIT 1`,
      [guildId, walletAddress]
    )
    untilSig = last?.signature || null
  }
  const sigs = await fetchAllSignatures(walletAddress, untilSig)
  console.log(`[audit] ${walletAddress} → ${sigs.length} new signatures${untilSig ? ` since ${untilSig.slice(0,8)}…` : ''}`)
  let inserted = 0, updated = 0
  for (let i = 0; i < sigs.length; i++) {
    const sigInfo = sigs[i]
    if (sigInfo.err) continue
    let tx
    try { tx = await rpc('getTransaction', [sigInfo.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]) }
    catch (err) { console.warn(`[audit]   getTransaction failed ${sigInfo.signature}: ${err.message}`); continue }
    if (!tx?.meta || !tx?.transaction) continue
    const c = classifyTx(tx, walletAddress)
    if (!c) continue
    if (c.direction === 'self' && !c.fee) continue

    const fromAddr = c.direction === 'deposit' ? (c.counterparty || '') : walletAddress
    const toAddr = c.direction === 'payout' ? (c.counterparty || '') : walletAddress
    const blockIso = c.blockTime ? new Date(c.blockTime * 1000).toISOString() : null

    const existing = await dbGet('SELECT id FROM transactions WHERE signature = ?', [sigInfo.signature])
    if (existing) {
      await dbRun(
        `UPDATE transactions SET network_fee = ?, block_time = ?, slot = ?, direction = ?,
                                 counterparty = ?, treasury_address = ?, audit_synced_at = CURRENT_TIMESTAMP
          WHERE signature = ?`,
        [c.fee, c.blockTime, c.slot, c.direction, c.counterparty, walletAddress, sigInfo.signature]
      )
      updated++
    } else {
      await dbRun(
        `INSERT INTO transactions
           (guild_id, from_address, to_address, amount, signature, status, currency,
            created_at, network_fee, block_time, slot, direction, counterparty, treasury_address, audit_synced_at)
         VALUES (?, ?, ?, ?, ?, 'confirmed', 'SOL', COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(signature) DO NOTHING`,
        [guildId, fromAddr, toAddr, c.sol, sigInfo.signature, blockIso, c.fee, c.blockTime, c.slot, c.direction, c.counterparty, walletAddress]
      )
      inserted++
    }
    if ((i + 1) % 50 === 0) console.log(`[audit]   ${i + 1}/${sigs.length} processed`)
  }
  return { inserted, updated, scanned: sigs.length }
}

// ── CSV writer ──────────────────────────────────────────────────────────────
function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

async function writeReport() {
  const where = []
  const params = []
  if (guildFilter) { where.push('t.guild_id = ?'); params.push(guildFilter) }
  if (from) { where.push(`(COALESCE(datetime(t.block_time, 'unixepoch'), t.created_at) >= datetime(?))`); params.push(from) }
  if (to) { where.push(`(COALESCE(datetime(t.block_time, 'unixepoch'), t.created_at) <= datetime(?, '+1 day'))`); params.push(to) }
  const sql = `
    SELECT t.id, t.guild_id, t.signature, t.direction, t.from_address, t.to_address,
           t.counterparty, t.treasury_address, t.amount, t.currency,
           t.original_amount, t.original_currency, t.network_fee, t.status,
           t.block_time, t.slot,
           COALESCE(datetime(t.block_time, 'unixepoch'), t.created_at) AS occurred_at,
           t.created_at, t.audit_synced_at,
           gw.label AS treasury_label
      FROM transactions t
      LEFT JOIN guild_wallets gw
             ON gw.guild_id = t.guild_id AND gw.wallet_address = t.treasury_address
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY occurred_at ASC, t.id ASC
  `
  const rows = await dbAll(sql, params)

  // Infer direction for legacy rows lacking it.
  const treasuriesByGuild = {}
  for (const r of await dbAll('SELECT guild_id, wallet_address FROM guild_wallets WHERE wallet_address IS NOT NULL AND guild_id IS NOT NULL')) {
    (treasuriesByGuild[r.guild_id] ||= new Set()).add(r.wallet_address)
  }
  const enriched = rows.map(r => {
    let direction = r.direction
    const tset = treasuriesByGuild[r.guild_id] || new Set()
    if (!direction) {
      if (tset.has(r.from_address)) direction = 'payout'
      else if (tset.has(r.to_address)) direction = 'deposit'
      else direction = 'unknown'
    }
    const counterparty = r.counterparty || (direction === 'payout' ? r.to_address : direction === 'deposit' ? r.from_address : null)
    const treasury = r.treasury_address || (tset.has(r.from_address) ? r.from_address : tset.has(r.to_address) ? r.to_address : null)
    return { ...r, direction, counterparty, treasury_address: treasury }
  })

  let totalPayouts = 0, totalDeposits = 0, totalFees = 0
  let payoutCount = 0, depositCount = 0, unknownCount = 0
  for (const r of enriched) {
    const amt = Number(r.amount) || 0
    const fee = Number(r.network_fee) || 0
    if (r.direction === 'payout') { totalPayouts += amt; payoutCount++ }
    else if (r.direction === 'deposit') { totalDeposits += amt; depositCount++ }
    else unknownCount++
    totalFees += fee
  }
  const netOutflow = totalPayouts + totalFees - totalDeposits

  const lines = []
  lines.push('# DCB Treasury Audit Report')
  lines.push(`# Generated,${new Date().toISOString()}`)
  lines.push(`# GuildFilter,${csvEscape(guildFilter || 'ALL')}`)
  lines.push(`# Range,${from || 'all-time'} to ${to || 'now'}`)
  lines.push(`# RowCount,${enriched.length}`)
  lines.push(`# TotalPayoutsSOL,${totalPayouts.toFixed(9)}`)
  lines.push(`# TotalDepositsSOL,${totalDeposits.toFixed(9)}`)
  lines.push(`# TotalNetworkFeesSOL,${totalFees.toFixed(9)}`)
  lines.push(`# NetOutflowSOL,${netOutflow.toFixed(9)}`)
  lines.push(`# PayoutsCount,${payoutCount}`)
  lines.push(`# DepositsCount,${depositCount}`)
  lines.push(`# UnknownCount,${unknownCount}`)
  lines.push('')
  const headers = [
    'occurred_at', 'block_time_unix', 'slot', 'direction',
    'amount_sol', 'network_fee_sol', 'currency',
    'original_amount', 'original_currency',
    'treasury_address', 'treasury_label', 'counterparty',
    'from_address', 'to_address',
    'signature', 'status', 'guild_id',
    'recorded_at', 'audit_synced_at',
  ]
  lines.push(headers.join(','))
  for (const r of enriched) {
    lines.push([
      r.occurred_at, r.block_time, r.slot, r.direction,
      r.amount, r.network_fee ?? '', r.currency || 'SOL',
      r.original_amount ?? '', r.original_currency ?? '',
      r.treasury_address ?? '', r.treasury_label ?? '', r.counterparty ?? '',
      r.from_address, r.to_address,
      r.signature ?? '', r.status ?? '', r.guild_id,
      r.created_at, r.audit_synced_at ?? '',
    ].map(csvEscape).join(','))
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, lines.join('\r\n') + '\r\n')

  console.log('')
  console.log('═══════════════════════════════════════════════════')
  console.log(`  Audit report written: ${outPath}`)
  console.log('═══════════════════════════════════════════════════')
  console.log(`  Rows:            ${enriched.length}`)
  console.log(`  Payouts:         ${payoutCount} (${totalPayouts.toFixed(6)} SOL)`)
  console.log(`  Deposits:        ${depositCount} (${totalDeposits.toFixed(6)} SOL)`)
  console.log(`  Network fees:    ${totalFees.toFixed(9)} SOL`)
  console.log(`  Net outflow:     ${netOutflow.toFixed(9)} SOL`)
  if (unknownCount) console.log(`  Unknown rows:    ${unknownCount} (run with --full to enrich)`)
}

// ── main ────────────────────────────────────────────────────────────────────
;(async () => {
  await ensureColumns()

  if (!noSync) {
    const wallets = guildFilter
      ? await dbAll('SELECT guild_id, wallet_address FROM guild_wallets WHERE guild_id = ? AND wallet_address IS NOT NULL AND guild_id IS NOT NULL', [guildFilter])
      : await dbAll('SELECT guild_id, wallet_address FROM guild_wallets WHERE wallet_address IS NOT NULL AND guild_id IS NOT NULL')
    if (!wallets.length) {
      console.warn(`[audit] no treasury wallets found${guildFilter ? ` for guild ${guildFilter}` : ''}`)
    }
    let totalIns = 0, totalUpd = 0, totalScan = 0
    for (const w of wallets) {
      try {
        const r = await syncWallet(w.guild_id, w.wallet_address)
        totalIns += r.inserted; totalUpd += r.updated; totalScan += r.scanned
      } catch (err) {
        console.warn(`[audit] wallet ${w.wallet_address} sync failed: ${err.message}`)
      }
    }
    console.log(`[audit] sync done — inserted=${totalIns} updated=${totalUpd} scanned=${totalScan}`)
  } else {
    console.log('[audit] --no-sync set; using cached DB data only')
  }

  await writeReport()
  db.close()
})().catch(err => {
  console.error('[audit] fatal:', err)
  db.close()
  process.exit(1)
})
