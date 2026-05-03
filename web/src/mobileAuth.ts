// Helper for OAuth flows inside the Capacitor Android/iOS app.
// Opens the OAuth URL in an in-app browser tab, then captures the
// `com.discryptobank.app://auth?dcb_token=...` deep link emitted by the
// backend callback and persists the JWT before closing the browser.

import { IS_CAPACITOR } from './api'

let listenerRegistered = false

export async function startMobileLogin(url: string): Promise<boolean> {
  if (!IS_CAPACITOR) return false
  try {
    const [{ Browser }, { App }] = await Promise.all([
      import('@capacitor/browser'),
      import('@capacitor/app'),
    ])

    if (!listenerRegistered) {
      listenerRegistered = true
      App.addListener('appUrlOpen', async (event: { url: string }) => {
        try {
          const target = event?.url || ''
          if (!target) return
          // Accept both com.discryptobank.app://... and any URL containing dcb_token
          let token: string | null = null
          try {
            const u = new URL(target)
            token = u.searchParams.get('dcb_token')
          } catch (_) {
            const m = target.match(/[?&]dcb_token=([^&#]+)/)
            if (m) token = decodeURIComponent(m[1])
          }
          if (token) {
            try { window.localStorage.setItem('dcb_token', token) } catch (_) {}
            try { await Browser.close() } catch (_) {}
            // Reload so the app picks up the new auth state from /auth/me
            try { window.location.reload() } catch (_) {}
          }
        } catch (_) {}
      })
    }

    await Browser.open({ url, presentationStyle: 'fullscreen' })
    return true
  } catch (err) {
    console.error('[mobileAuth] failed to open in-app browser:', err)
    return false
  }
}
