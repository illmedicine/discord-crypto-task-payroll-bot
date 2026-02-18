/**
 * Wallet Sync — shared helpers for bidirectional wallet sync between bot and backend.
 *
 * Backend (DCB Event Manager) is authoritative when reachable:
 *   - Backend has wallet → use it, sync to local
 *   - Backend reachable & no wallet → wallet was disconnected via web, clear local
 *   - Backend unreachable → fall back to local DB
 */

const db = require('./db');

const DCB_BACKEND_URL = process.env.DCB_BACKEND_URL || '';
const DCB_INTERNAL_SECRET = process.env.DCB_INTERNAL_SECRET || '';

/** Fire-and-forget push wallet change to backend */
function syncWalletToBackend(body) {
  if (!DCB_BACKEND_URL || !DCB_INTERNAL_SECRET) return;
  const url = `${DCB_BACKEND_URL.replace(/\/$/, '')}/api/internal/guild-wallet-sync`;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dcb-internal-secret': DCB_INTERNAL_SECRET },
    body: JSON.stringify(body)
  }).then(r => {
    if (!r.ok) console.error(`[WALLET-SYNC] backend push failed: ${r.status}`);
    else console.log(`[WALLET-SYNC] wallet synced to backend for guild ${body.guildId}`);
  }).catch(err => console.error('[WALLET-SYNC] push error:', err.message));
}

/**
 * Pull wallet from backend DB.
 * Returns: { reachable: true, wallet: {...} | null } or { reachable: false }
 */
async function fetchWalletFromBackend(guildId) {
  if (!DCB_BACKEND_URL || !DCB_INTERNAL_SECRET) return { reachable: false };
  try {
    const url = `${DCB_BACKEND_URL.replace(/\/$/, '')}/api/internal/guild-wallet/${guildId}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      headers: { 'x-dcb-internal-secret': DCB_INTERNAL_SECRET },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return { reachable: false };
    const data = await res.json();
    return { reachable: true, wallet: data?.wallet || null };
  } catch (err) {
    console.error('[WALLET] Backend wallet fetch error:', err.message);
    return { reachable: false };
  }
}

/**
 * Get guild wallet with backend fallback.
 * Backend is authoritative when reachable:
 *  - Backend has wallet → use it (sync to local)
 *  - Backend reachable but no wallet → wallet was disconnected, clear local too
 *  - Backend unreachable → fall back to local wallet
 */
async function getGuildWalletWithFallback(guildId) {
  const localWallet = await db.getGuildWallet(guildId);
  const result = await fetchWalletFromBackend(guildId);

  if (result.reachable) {
    if (result.wallet) {
      // Backend has wallet — sync to local DB if different
      if (!localWallet || localWallet.wallet_address !== result.wallet.wallet_address) {
        try {
          await db.setGuildWallet(
            guildId,
            result.wallet.wallet_address,
            result.wallet.configured_by,
            result.wallet.label,
            result.wallet.network
          );
          console.log(`[WALLET] Synced wallet from backend for guild ${guildId}`);
        } catch (syncErr) {
          console.warn('[WALLET] Local sync warning:', syncErr.message);
        }
      }
      return result.wallet;
    } else {
      // Backend is reachable and says NO wallet — respect the disconnect
      if (localWallet) {
        try {
          await db.deleteGuildWallet(guildId);
          console.log(`[WALLET] Removed local wallet for guild ${guildId} (disconnected via web)`);
        } catch (delErr) {
          console.warn('[WALLET] Local delete warning:', delErr.message);
        }
      }
      return null;
    }
  }

  // Backend unreachable — use local wallet as-is
  return localWallet;
}

module.exports = {
  syncWalletToBackend,
  fetchWalletFromBackend,
  getGuildWalletWithFallback
};
