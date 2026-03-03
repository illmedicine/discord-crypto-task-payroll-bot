/**
 * Client-side E2E transport encryption for private keys.
 *
 * Uses Web Crypto API (AES-256-GCM) to encrypt the private key in the browser
 * before sending it to the backend. The backend strips this transport layer
 * and re-encrypts with its at-rest key.
 *
 * Format: e2e:<iv_base64>:<authTag_base64>:<ciphertext_base64>
 *
 * The transport key is derived from the E2E_TRANSPORT_KEY env var (set at build time)

 * or falls back to a shared key derived from the user's session.
 */

const E2E_PREFIX = 'e2e:'

/**
 * Derive AES-256 key from a hex string using Web Crypto API.
 */
async function hexToKey(hex: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt'])
}

/**
 * Get the transport encryption key.
 * Uses VITE_E2E_TRANSPORT_KEY (64-hex-char build-time env var).
 * Falls back to VITE_ENCRYPTION_KEY.
 * If neither is set, returns null (key will be sent over plain HTTPS).
 */
async function getTransportKey(): Promise<CryptoKey | null> {
  try {
    const meta = import.meta as any
    const transportHex = meta.env?.VITE_E2E_TRANSPORT_KEY
    if (transportHex && transportHex.length === 64) return hexToKey(transportHex)
    const encHex = meta.env?.VITE_ENCRYPTION_KEY
    if (encHex && encHex.length === 64) return hexToKey(encHex)
  } catch (_) {}
  return null
}

/**
 * Encrypt a plaintext private key with E2E transport encryption.
 * Returns the e2e:iv:tag:ciphertext string, or the raw value if no key is configured.
 */
export async function encryptForTransport(plaintext: string): Promise<string> {
  const key = await getTransportKey()
  if (!key) {
    // No transport key configured — backend will accept raw value over HTTPS
    return plaintext
  }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  // AES-GCM appends 16-byte auth tag to ciphertext
  const cipherArr = new Uint8Array(cipherBuf)
  const ciphertext = cipherArr.slice(0, cipherArr.length - 16)
  const authTag = cipherArr.slice(cipherArr.length - 16)
  const b64 = (arr: Uint8Array) => btoa(String.fromCharCode(...arr))
  return `${E2E_PREFIX}${b64(iv)}:${b64(authTag)}:${b64(ciphertext)}`
}

/**
 * Check if encryption is available in this browser.
 */
export function isE2EAvailable(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined'
}
