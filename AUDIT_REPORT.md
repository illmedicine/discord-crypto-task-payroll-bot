# Treasury Audit Report (bank / accounting export)

This subsystem produces a comprehensive ledger of every Solana transaction
involving any DCB treasury wallet — outgoing payments to staff/participants,
incoming deposits to the treasury, and the per-transaction Solana network
fees the treasury paid. It is intentionally **not** exposed in the public
dashboard UI; access is restricted to guild owners (web endpoint) or local
operators (CLI script).

## What gets captured

For each on-chain transaction touching a treasury wallet:

| Column            | Meaning |
|-------------------|---------|
| `occurred_at`     | UTC timestamp from Solana `blockTime` (or DB record time if not yet synced) |
| `block_time_unix` | Raw on-chain unix seconds |
| `slot`            | Solana slot |
| `direction`       | `payout` (treasury → other), `deposit` (other → treasury), `fee_only`, `self`, or `unknown` (legacy rows) |
| `amount_sol`      | Net transfer amount, absolute SOL |
| `network_fee_sol` | Solana network fee paid by the treasury (only when treasury is fee payer) |
| `original_amount` / `original_currency` | If the bot dispatched a USD-denominated payment, the original USD figure |
| `treasury_address` / `treasury_label` | Which treasury wallet was involved |
| `counterparty`    | The non-treasury wallet on the other side of the transfer |
| `from_address` / `to_address` | Resolved sender/recipient |
| `signature`       | On-chain signature (unique) |
| `status`          | `confirmed` / `pending` |
| `recorded_at`     | When the bot first wrote the row |
| `audit_synced_at` | Last on-chain enrichment time |

A summary header at the top of every CSV gives the totals you actually care
about for an audit:

```
# TotalPayoutsSOL,...
# TotalDepositsSOL,...
# TotalNetworkFeesSOL,...
# NetOutflowSOL,...   (payouts + fees − deposits)
# PayoutsCount, DepositsCount, UnknownCount
```

## Web endpoint (preferred for monthly download)

Restricted to authenticated guild owners. Hit it from a browser with the
`dcb_session` cookie set (i.e. while logged into the dashboard).

```
GET /api/admin/guilds/:guildId/audit/report
        ?format=csv|json     (default csv → triggers browser download)
        &from=YYYY-MM-DD     (inclusive)
        &to=YYYY-MM-DD       (inclusive)
        &sync=1              (run on-chain sync before exporting)
        &full=1              (force full re-scan, otherwise incremental)
```

Examples:

```
# First run — capture everything from inception, with full on-chain enrichment:
/api/admin/guilds/123456789/audit/report?sync=1&full=1

# Monthly run for April 2026:
/api/admin/guilds/123456789/audit/report?sync=1&from=2026-04-01&to=2026-04-30
```

The CSV downloads as `dcb-audit-<guildId>_<from>_to_<to>_<date>.csv`.

A separate POST-only sync endpoint is also available if you'd rather do the
sync in one step and the export in another:

```
POST /api/admin/guilds/:guildId/audit/sync
Body: { "full": true }       (omit to do an incremental sync)
```

## CLI / file-generation (offline)

Run directly against the SQLite DB without going through the backend.
Useful when generating the report on a machine that has the DB volume
mounted (e.g. the Railway shell or your local box with `payroll.db`).

```
cd discord-crypto-task-payroll-bot

# All-time, all guilds — first run for the bank packet:
node scripts/generate-audit-report.js --full

# A specific guild and month, custom output path:
node scripts/generate-audit-report.js \
  --guild=123456789 \
  --from=2026-04-01 --to=2026-04-30 \
  --out=./reports/dcb-april-2026.csv

# Skip the on-chain sync (use only what's already in the DB):
node scripts/generate-audit-report.js --no-sync
```

Environment variables honored:

| Var | Default |
|-----|---------|
| `DB_PATH` / `DCB_DB_PATH` | `/data/payroll.db` if it exists, else `./payroll.db` |
| `SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` |

## How it works

1. **Sync.** For every wallet in `guild_wallets`, the syncer pages through
   `getSignaturesForAddress` (1000 at a time) until it either reaches the
   last signature it already enriched (incremental mode, default) or hits
   the `--hard-cap` (default 20 000). With `--full` it re-scans everything.
2. **Classification.** For each signature, it calls `getTransaction` and
   inspects `meta.preBalances` / `meta.postBalances` for the treasury
   account. The sign of the net change determines `direction`. If the
   treasury was the fee payer (`accountKeys[0]`), the network fee is
   recorded too.
3. **Persistence.** Rows are upserted into the existing `transactions`
   table — the same one the bot writes to via `/api/internal/log-transaction`,
   so internal records (USD original amount, etc.) are preserved and
   joined automatically.
4. **Export.** A query joins `transactions` with `guild_wallets` to attach
   the treasury label, infers `direction` for legacy pre-sync rows, and
   emits CSV (with summary header) or JSON.

## First-time setup checklist

1. Deploy the updated backend (it self-applies the column migrations).
2. Hit `POST /api/admin/guilds/:guildId/audit/sync` with `{ "full": true }`
   once per guild — this can take a few minutes per wallet on the public
   RPC. Set `SOLANA_RPC_URL` to a paid RPC (Helius, QuickNode, etc.) for
   substantially faster scans.
3. Pull `GET /api/admin/guilds/:guildId/audit/report` to download the
   all-time CSV for the bank.
4. For monthly runs, just call the report endpoint with `sync=1` and the
   month's `from` / `to` — the syncer skips signatures it has already
   enriched, so each subsequent run is fast.

## Caveats

- Only **SOL transfers** are classified. SPL-token transfers are not
  decoded yet; if the treasury is also used for SPL payouts, extend
  `classifyTx` to inspect `meta.preTokenBalances` / `meta.postTokenBalances`.
- Network fees are attributed to the treasury **only when the treasury is
  the fee payer** (which is the case for all `/pay` flows).
- "Net outflow" is `payouts + fees − deposits` in SOL. To convert to USD
  for the bank, multiply by the SOL/USD rate at the time of each row using
  your accounting software's FX import — the script does not embed FX rates.
