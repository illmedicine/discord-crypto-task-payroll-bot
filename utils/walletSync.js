/**
 * Wallet Sync — shared helpers for bidirectional wallet sync between bot and backend.
 *
 * Backend (DCB Event Manager) is authoritative when reachable:
 *   - Backend has wallet → use it, sync to local
 *   - Backend reachable & no wallet → wallet was disconnected via web, clear local
 *   - Backend unreachable → fall back to local DB
 */

const db = require('./db');
const { decryptSecret, encryptSecret, isEncrypted, encryptTransport, decryptTransport, isTransportEncrypted } = require('./encryption');

const DCB_BACKEND_URL = process.env.DCB_BACKEND_URL || '';
const DCB_INTERNAL_SECRET = process.env.DCB_INTERNAL_SECRET || '';

/** Fire-and-forget push wallet change to backend (double-encrypts secret for E2E transit) */
function syncWalletToBackend(body) {
  if (!DCB_BACKEND_URL || !DCB_INTERNAL_SECRET) return;
  const url = `${DCB_BACKEND_URL.replace(/\/$/, '')}/api/internal/guild-wallet-sync`;
  // Layer 1: ensure at-rest encryption
  const safeBody = { ...body };
  if (safeBody.wallet_secret && !isEncrypted(safeBody.wallet_secret)) {
    safeBody.wallet_secret = encryptSecret(safeBody.wallet_secret);
  }
  // Layer 2: wrap with E2E transport encryption for the wire
  if (safeBody.wallet_secret) {
    safeBody.wallet_secret = encryptTransport(safeBody.wallet_secret);
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dcb-internal-secret': DCB_INTERNAL_SECRET },
    body: JSON.stringify(safeBody)
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
      // Backend has wallet — sync to local DB if anything differs (address, secret, etc.)
      // Peel all encryption layers: transport (e2e:) then at-rest (enc:), looping to handle
      // historically triple-encrypted values (enc:(e2e:(enc:(secret)))) from a prior sync bug.
      let rawSecret = result.wallet.wallet_secret || null;
      const MAX_DECRYPT_LAYERS = 5; // safety limit
      for (let i = 0; rawSecret && i < MAX_DECRYPT_LAYERS; i++) {
        if (isTransportEncrypted(rawSecret)) {
          rawSecret = decryptTransport(rawSecret);
          if (!rawSecret) { console.error(`[WALLET] Transport decryption failed at layer ${i + 1}`); break; }
          continue; // check for more layers
        }
        if (isEncrypted(rawSecret)) {
          rawSecret = decryptSecret(rawSecret);
          if (!rawSecret) { console.error(`[WALLET] At-rest decryption failed at layer ${i + 1} — ENCRYPTION_KEY may be wrong`); break; }
          continue; // check for more layers
        }
        break; // plaintext reached
      }
      const backendSecret = rawSecret || null;

      // Merge: prefer backend secret, fall back to local secret for same address
      // Note: localWallet.wallet_secret is already decrypted by getGuildWallet()
      const mergedSecret = backendSecret
        || (localWallet && localWallet.wallet_address === result.wallet.wallet_address ? localWallet.wallet_secret : null)
        || null;

      const needsSync = !localWallet
        || localWallet.wallet_address !== result.wallet.wallet_address
        || (mergedSecret && localWallet.wallet_secret !== mergedSecret)
        || (result.wallet.label && localWallet.label !== result.wallet.label);
      if (needsSync) {
        try {
          // setGuildWallet will encrypt mergedSecret before storing
          await db.setGuildWallet(
            guildId,
            result.wallet.wallet_address,
            result.wallet.configured_by,
            result.wallet.label,
            result.wallet.network,
            mergedSecret
          );
          console.log(`[WALLET] Synced wallet from backend for guild ${guildId} (secret: ${mergedSecret ? 'YES' : 'no'})`);
        } catch (syncErr) {
          console.warn('[WALLET] Local sync warning:', syncErr.message);
        }
      }
      // Return merged wallet with the correct secret for this guild
      return { ...result.wallet, wallet_secret: mergedSecret };
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
