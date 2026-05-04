// Helper for OAuth flows inside the Capacitor Android/iOS app.
// Uses a polling-based session exchange that does NOT rely on the
// fragile Custom-Tab → custom-scheme deep link delivery. The deep link
// is still honored as a fast-path if it does arrive.

import { App as CapApp } from '@capacitor/app'
import { Browser as CapBrowser } from '@capacitor/browser'
import { API_BASE, IS_CAPACITOR } from './api'

let installed = false
const processedUrls = new Set<string>()
let activePoll: { sessionId: string; cancel: () => void } | null = null

const TOKEN_APPLIED_EVENT = 'dcb-token-applied'

function extractToken(rawUrl: string): string | null {
  if (!rawUrl) return null
  try {
    const u = new URL(rawUrl)
    const t = u.searchParams.get('dcb_token')
    if (t) return t
  } catch (_) {}
  const m = rawUrl.match(/[?&#]dcb_token=([^&#]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

async function applyToken(token: string, source: string) {
  if (!token) return
  try { window.localStorage.setItem('dcb_token', token) } catch (_) {}
  try { await CapBrowser.close() } catch (_) {}
  // Cancel any in-flight polling — token already obtained.
  try { activePoll?.cancel() } catch (_) {}
  activePoll = null
  console.log('[mobileAuth] token captured via', source)
  // Notify React app to re-fetch /auth/me without a full reload.
  try { window.dispatchEvent(new CustomEvent(TOKEN_APPLIED_EVENT, { detail: { source } })) } catch (_) {}
  // Belt-and-suspenders: if the listener does not refresh state for any reason,
  // fall back to reload after a grace period.
  setTimeout(() => {
    try {
      // Only reload if no React-side handler has cleared this flag (it sets
      // window.__dcbAuthRefreshed = true after a successful /auth/me).
      if (!(window as any).__dcbAuthRefreshed) window.location.reload()
    } catch (_) {}
  }, 1500)
}

async function checkLaunchUrl(reason: string) {
  try {
    const res = await CapApp.getLaunchUrl()
    const url = (res as any)?.url || ''
    if (!url || processedUrls.has(url)) return
    const token = extractToken(url)
    if (token) {
      processedUrls.add(url)
      await applyToken(token, `getLaunchUrl(${reason})`)
    }
  } catch (_) {}
}

export function installGlobalDeepLinkHandler(): void {
  if (!IS_CAPACITOR || installed) return
  installed = true

  CapApp.addListener('appUrlOpen', async (event: { url: string }) => {
    const url = event?.url || ''
    if (!url || processedUrls.has(url)) return
    processedUrls.add(url)
    const token = extractToken(url)
    if (token) await applyToken(token, 'appUrlOpen')
  }).catch((err) => console.error('[mobileAuth] appUrlOpen listener failed:', err))

  checkLaunchUrl('startup')

  CapApp.addListener('appStateChange', (state: { isActive: boolean }) => {
    if (state?.isActive) checkLaunchUrl('resume')
  }).catch((err) => console.error('[mobileAuth] appStateChange listener failed:', err))

  CapApp.addListener('resume', () => {
    checkLaunchUrl('resume-event')
  }).catch(() => {})
}

// ── Polling-based mobile auth exchange ───────────────────────────────────────
// Robust against Custom-Tab deep-link failures. The backend stores the JWT
// keyed by a session_id we generate and pass through the OAuth flow; we then
// poll until the token is available.

function buildBackend(path: string): string {
  const base = (API_BASE || '').replace(/\/$/, '')
  return `${base}${path}`
}

async function startMobileSession(): Promise<string | null> {
  try {
    const res = await fetch(buildBackend('/auth/mobile/start'), {
      method: 'POST',
      credentials: 'omit',
    })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data?.session_id === 'string' ? data.session_id : null
  } catch (err) {
    console.error('[mobileAuth] startMobileSession failed:', err)
    return null
  }
}

function pollMobileSession(sessionId: string): { promise: Promise<string | null>; cancel: () => void } {
  let cancelled = false
  let timer: any = null
  const promise = new Promise<string | null>((resolve) => {
    const startedAt = Date.now()
    const MAX_MS = 5 * 60 * 1000 // 5 minutes
    const tick = async () => {
      if (cancelled) { resolve(null); return }
      if (Date.now() - startedAt > MAX_MS) { resolve(null); return }
      try {
        const r = await fetch(buildBackend(`/auth/mobile/poll?session_id=${encodeURIComponent(sessionId)}`), {
          credentials: 'omit',
        })
        if (cancelled) { resolve(null); return }
        if (r.status === 200) {
          const data = await r.json().catch(() => null)
          if (data?.token) { resolve(data.token); return }
        }
        // 202 (pending), 404 (not found yet — race), or other transient errors → keep polling
      } catch (_) {}
      timer = setTimeout(tick, 1500)
    }
    tick()
  })
  return {
    promise,
    cancel: () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    },
  }
}

export async function startMobileLogin(url: string): Promise<boolean> {
  if (!IS_CAPACITOR) return false
  try {
    installGlobalDeepLinkHandler()

    // Cancel any prior polling session
    try { activePoll?.cancel() } catch (_) {}
    activePoll = null

    // Create polling session and append session_id to OAuth start URL
    const sessionId = await startMobileSession()
    let finalUrl = url
    if (sessionId) {
      const sep = finalUrl.includes('?') ? '&' : '?'
      finalUrl = `${finalUrl}${sep}mobile_session=${encodeURIComponent(sessionId)}`
      const poll = pollMobileSession(sessionId)
      activePoll = { sessionId, cancel: poll.cancel }
      poll.promise.then((token) => {
        if (token) applyToken(token, 'poll')
      })
    }

    await CapBrowser.open({ url: finalUrl, presentationStyle: 'fullscreen' })
    return true
  } catch (err) {
    console.error('[mobileAuth] failed to open in-app browser:', err)
    return false
  }
}

export const MOBILE_TOKEN_APPLIED_EVENT = TOKEN_APPLIED_EVENT
