// Helper for OAuth flows inside the Capacitor Android/iOS app.
// Bundled statically (not lazy-loaded) so the appUrlOpen listener is
// guaranteed to be active before the OAuth Custom Tab fires the deep link.

import { App as CapApp } from '@capacitor/app'
import { Browser as CapBrowser } from '@capacitor/browser'
import { IS_CAPACITOR } from './api'

let installed = false
let processedUrls = new Set<string>()

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
  try { window.localStorage.setItem('dcb_token', token) } catch (_) {}
  try { await CapBrowser.close() } catch (_) {}
  // Strip dcb_token from any visible query and reload so /auth/me runs with the new Bearer header.
  console.log('[mobileAuth] token captured via', source, '— reloading')
  try {
    setTimeout(() => { try { window.location.reload() } catch (_) {} }, 100)
  } catch (_) {}
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

  // Primary handler: fired by Capacitor when the activity receives a new
  // intent matching our intent-filter (custom URL scheme).
  CapApp.addListener('appUrlOpen', async (event: { url: string }) => {
    const url = event?.url || ''
    if (!url || processedUrls.has(url)) return
    processedUrls.add(url)
    const token = extractToken(url)
    if (token) await applyToken(token, 'appUrlOpen')
  }).catch((err) => console.error('[mobileAuth] appUrlOpen listener failed:', err))

  // Fallback: if Capacitor was killed/restored mid-OAuth, getLaunchUrl()
  // returns the URL the activity was started with.
  checkLaunchUrl('startup')

  // Resume fallback: when the user returns to the app from the in-app browser,
  // re-check getLaunchUrl in case the appUrlOpen event was missed.
  CapApp.addListener('appStateChange', (state: { isActive: boolean }) => {
    if (state?.isActive) {
      checkLaunchUrl('resume')
    }
  }).catch((err) => console.error('[mobileAuth] appStateChange listener failed:', err))

  // Also listen for resume directly
  CapApp.addListener('resume', () => {
    checkLaunchUrl('resume-event')
  }).catch(() => {})
}

export async function startMobileLogin(url: string): Promise<boolean> {
  if (!IS_CAPACITOR) return false
  try {
    installGlobalDeepLinkHandler()
    await CapBrowser.open({ url, presentationStyle: 'fullscreen' })
    return true
  } catch (err) {
    console.error('[mobileAuth] failed to open in-app browser:', err)
    return false
  }
}
