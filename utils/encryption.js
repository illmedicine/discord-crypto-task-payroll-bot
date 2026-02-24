/**
 * Shared AES-256-GCM encryption helpers for private key storage.
 *
 * Mirrors the backend's encryptSecret / decryptSecret (apps/backend/src/api.js).
 * Both services MUST share the same ENCRYPTION_KEY env var (64 hex chars = 256-bit key).
 *
 * End-to-end encryption layers:
 *   1. At-rest  — ENCRYPTION_KEY encrypts private keys stored in the database.
 *   2. Transit  — E2E_TRANSPORT_KEY (or ENCRYPTION_KEY fallback) adds a second
 *                 encryption layer when secrets travel between bot ↔ backend.
 *
 * Encrypted format: enc:<iv_base64>:<authTag_base64>:<ciphertext_base64>
 * Transit  format: e2e:<iv_base64>:<authTag_base64>:<ciphertext_base64>
 */

const crypto = require('crypto');

const ENCRYPTION_PREFIX = 'enc:';
const E2E_TRANSPORT_PREFIX = 'e2e:';

/**
 * Derive the 256-bit key from the ENCRYPTION_KEY environment variable (at-rest).
 * Returns null if the env var is missing or malformed.
 */
function _getEncKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, 'hex');
}

/**
 * Derive the 256-bit key used for transit (end-to-end) encryption.
 * Falls back to ENCRYPTION_KEY when E2E_TRANSPORT_KEY is not set.
 */
function _getTransportKey() {
  const hex = process.env.E2E_TRANSPORT_KEY;
  if (hex && hex.length === 64) return Buffer.from(hex, 'hex');
  return _getEncKey(); // fallback to at-rest key
}

/**
 * Check whether a stored value is already encrypted (starts with "enc:").
 */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENCRYPTION_PREFIX);
}

/**
 * Encrypt a plaintext secret using AES-256-GCM.
 * - If ENCRYPTION_KEY is not configured, returns the plaintext unchanged (graceful degradation).
 * - If the value is already encrypted, returns it unchanged (idempotent).
 * - Null / empty values pass through unchanged.
 */
function encryptSecret(plain) {
  if (!plain) return plain;
  if (isEncrypted(plain)) return plain; // already encrypted
  const key = _getEncKey();
  if (!key) return plain; // no key configured — store as-is
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(plain, 'utf8', 'base64');
  enc += cipher.final('base64');
  return `${ENCRYPTION_PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc}`;
}

/**
 * Decrypt an encrypted secret.
 * - If the value does not start with "enc:", it is assumed to be plaintext and returned as-is.
 * - If ENCRYPTION_KEY is not configured, returns null (cannot decrypt).
 * - If decryption fails (wrong key, corrupted data), returns null.
 */
function decryptSecret(stored) {
  if (!stored) return stored;
  if (!isEncrypted(stored)) return stored; // plaintext — return as-is
  const key = _getEncKey();
  if (!key) return null; // no key — cannot decrypt
  try {
    const payload = stored.slice(ENCRYPTION_PREFIX.length);
    const [ivB64, tagB64, cB64] = payload.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    let result = decipher.update(cB64, 'base64', 'utf8');
    result += decipher.final('utf8');
    return result;
  } catch (err) {
    console.error('[ENCRYPTION] Decryption failed:', err.message);
    return null;
  }
}

/**
 * Migrate a single value: if plaintext, encrypt it. If already encrypted, return unchanged.
 * Returns { encrypted: string|null, changed: boolean }
 */
function migrateValue(value) {
  if (!value) return { encrypted: value, changed: false };
  if (isEncrypted(value)) return { encrypted: value, changed: false };
  const encrypted = encryptSecret(value);
  return { encrypted, changed: encrypted !== value };
}

// ── End-to-End Transport Encryption ────────────────────────────────

/**
 * Check whether a value is wrapped with the E2E transport layer.
 */
function isTransportEncrypted(value) {
  return typeof value === 'string' && value.startsWith(E2E_TRANSPORT_PREFIX);
}

/**
 * Wrap a value with an additional E2E transport encryption layer (AES-256-GCM).
 * This is applied *on top of* the at-rest encryption before sending over the wire.
 * - If E2E_TRANSPORT_KEY (or ENCRYPTION_KEY fallback) is not set, returns the value as-is.
 * - Already transport-wrapped values pass through unchanged.
 */
function encryptTransport(value) {
  if (!value) return value;
  if (isTransportEncrypted(value)) return value; // already wrapped
  const key = _getTransportKey();
  if (!key) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(value, 'utf8', 'base64');
  enc += cipher.final('base64');
  return `${E2E_TRANSPORT_PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc}`;
}

/**
 * Unwrap the E2E transport encryption layer.
 * - Non-transport values pass through unchanged.
 * - Returns null if decryption fails (key mismatch, etc.).
 */
function decryptTransport(value) {
  if (!value) return value;
  if (!isTransportEncrypted(value)) return value; // not transport-wrapped
  const key = _getTransportKey();
  if (!key) return null;
  try {
    const payload = value.slice(E2E_TRANSPORT_PREFIX.length);
    const [ivB64, tagB64, cB64] = payload.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    let result = decipher.update(cB64, 'base64', 'utf8');
    result += decipher.final('utf8');
    return result;
  } catch (err) {
    console.error('[E2E-TRANSPORT] Decryption failed:', err.message);
    return null;
  }
}

// ── Startup Validation ─────────────────────────────────────────────

/**
 * Log the status of encryption environment variables at startup.
 * Call once from index.js to give operators clear visibility.
 */
function validateEncryptionEnv() {
  const encKey = process.env.ENCRYPTION_KEY;
  const transportKey = process.env.E2E_TRANSPORT_KEY;

  if (!encKey) {
    console.warn('[ENCRYPTION] ⚠️  ENCRYPTION_KEY is NOT set — private keys will be stored in PLAINTEXT.');
    console.warn('[ENCRYPTION]    Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  } else if (encKey.length !== 64) {
    console.error('[ENCRYPTION] ❌ ENCRYPTION_KEY is invalid (must be 64 hex chars / 256 bits). Got length:', encKey.length);
  } else {
    console.log('[ENCRYPTION] ✅ ENCRYPTION_KEY configured (at-rest encryption active)');
  }

  if (transportKey) {
    if (transportKey.length !== 64) {
      console.error('[ENCRYPTION] ❌ E2E_TRANSPORT_KEY is invalid (must be 64 hex chars / 256 bits). Got length:', transportKey.length);
    } else {
      console.log('[ENCRYPTION] ✅ E2E_TRANSPORT_KEY configured (separate transit encryption active)');
    }
  } else {
    console.log('[ENCRYPTION] ℹ️  E2E_TRANSPORT_KEY not set — using ENCRYPTION_KEY for transit encryption fallback');
  }
}

module.exports = {
  ENCRYPTION_PREFIX,
  E2E_TRANSPORT_PREFIX,
  isEncrypted,
  encryptSecret,
  decryptSecret,
  migrateValue,
  isTransportEncrypted,
  encryptTransport,
  decryptTransport,
  validateEncryptionEnv,
};
