// Helper for OAuth flows inside the Capacitor Android/iOS app.
// Opens the OAuth URL in an in-app browser tab, then captures the
// `com.discryptobank.app://auth?dcb_token=...` deep link emitted by the
// backend callback and persists the JWT before closing the browser.

import { IS_CAPACITOR } from './api'

let globalListenerInstalled = false

function extractToken(rawUrl: string): string | null {
  if (!rawUrl) return null
  // Try URL parser first
  try {
    const u = new URL(rawUrl)
    const t = u.searchParams.get('dcb_token')
    if (t) return t
  } catch (_) {}
  // Fallback regex for environments where URL can't parse a custom scheme
  const m = rawUrl.match(/[?&#]dcb_token=([^&#]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

async function applyToken(token: string) {
  try { window.localStorage.setItem('dcb_token', token) } catch (_) {}
  try {
    const { Browser } = await import('@capacitor/browser')
    await Browser.close().catch(() => {})
  } catch (_) {}
  // Reload so the request interceptor picks up the new token and /auth/me runs.
  try { window.location.reload() } catch (_) {}
}

/**
 * Installed once at startup (from main.tsx). Listens globally for
 * appUrlOpen events so we never miss a deep link due to a race between
 * Browser.open() and listener registration.
 */
export async function installGlobalDeepLinkHandler(): Promise<void> {
  if (!IS_CAPACITOR || globalListenerInstalled) return
  globalListenerInstalled = true
  try {
    const { App } = await import('@capacitor/app')
    await App.addListener('appUrlOpen', async (event: { url: string }) => {
      const token = extractToken(event?.url || '')
      if (token) await applyToken(token)
    })
  } catch (err) {
    console.error('[mobileAuth] failed to install deep-link handler:', err)
  }
}

/**
 * Called when the user taps the Discord/Google login button inside the app.
 * Opens the OAuth URL in a Chrome Custom Tab (Android) / SFSafariViewController
 * (iOS). The global listener (installed at startup) handles the redirect.
 */
export async function startMobileLogin(url: string): Promise<boolean> {
  if (!IS_CAPACITOR) return false
  try {
    // Belt-and-suspenders: ensure global listener is attached before opening.
    await installGlobalDeepLinkHandler()
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url, presentationStyle: 'fullscreen' })
    return true
  } catch (err) {
    console.error('[mobileAuth] failed to open in-app browser:', err)
    return false
  }
}
