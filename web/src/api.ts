import axios from 'axios'

const PROD_API_BASE = 'https://dcb-payroll-backend-production.up.railway.app'

function resolveApiBase(): string {
  // 1. Check Vite env var (set at build time)
  try {
    const envBase = import.meta.env.VITE_API_BASE
    if (envBase) return envBase
  } catch (_) {}
  // 2. Detect GitHub Pages or Capacitor (mobile app) at runtime
  if (typeof window !== 'undefined') {
    const h = window.location.hostname || ''
    const p = window.location.pathname || ''
    const proto = window.location.protocol || ''
    // Capacitor Android serves from https://localhost, Capacitor iOS from capacitor://localhost
    // Also detect file:// protocol for fallback
    const isCapacitor = proto === 'capacitor:' || proto === 'file:' || (h === 'localhost' && !p.startsWith('/api'))
    if (isCapacitor) {
      return PROD_API_BASE
    }
    if (h.endsWith('github.io') || p.startsWith('/discord-crypto-task-payroll-bot') || h.endsWith('dcb-games.com')) {
      return PROD_API_BASE
    }
  }
  // 3. Local dev — use relative /api
  return ''
}

export const API_BASE = resolveApiBase()
const API_PREFIX = API_BASE ? `${API_BASE.replace(/\/$/, '')}/api` : '/api'

export const api = axios.create({
  baseURL: API_PREFIX,
  withCredentials: true,
  timeout: 15000, // 15s timeout to prevent hanging requests
})

// ---- Request throttling & deduplication for DDoS resilience ----
const pendingGets = new Map<string, Promise<any>>()

/** Deduplicated GET — identical in-flight GETs share one request */
export function deduplicatedGet<T = any>(url: string, config?: any): Promise<T> {
  const key = url + (config?.params ? JSON.stringify(config.params) : '')
  if (pendingGets.has(key)) return pendingGets.get(key)!
  const p = api.get(url, config).then(r => { pendingGets.delete(key); return r as T })
    .catch(err => { pendingGets.delete(key); throw err })
  pendingGets.set(key, p)
  return p
}

// Retry with exponential backoff for 429/5xx errors
api.interceptors.response.use(undefined, async (error) => {
  const config = error.config
  if (!config || config._retryCount >= 3) return Promise.reject(error)
  const status = error?.response?.status
  if (status === 429 || (status >= 500 && status < 600)) {
    config._retryCount = (config._retryCount || 0) + 1
    const delay = Math.min(1000 * Math.pow(2, config._retryCount), 8000)
    await new Promise(r => setTimeout(r, delay))
    return api(config)
  }
  return Promise.reject(error)
})

api.interceptors.request.use((config) => {
  try {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('dcb_token') : null
    if (token) {
      config.headers = config.headers || {}
      ;(config.headers as any).Authorization = `Bearer ${token}`
    }
  } catch (_) {
  }
  return config
})

// Track consecutive 401s to prevent infinite polling
let consecutive401s = 0
api.interceptors.response.use(
  (response) => { consecutive401s = 0; return response },
  (error) => {
    if (error?.response?.status === 401) {
      consecutive401s++
      // After 3 consecutive 401s, clear token to force re-login
      if (consecutive401s >= 3) {
        try { window.localStorage.removeItem('dcb_token') } catch (_) {}
      }
    } else {
      consecutive401s = 0
    }
    return Promise.reject(error)
  }
)

export const getAuthUrl = (path = '/auth/discord') => {
  const base = API_BASE || resolveApiBase()
  return `${base.replace(/\/$/, '')}${path}`
}

export const getGoogleAuthUrl = () => getAuthUrl('/auth/google')
export const getGoogleLinkUrl = () => getAuthUrl('/auth/google/link')
export const getDiscordLinkUrl = () => getAuthUrl('/auth/discord/link')

export default api
