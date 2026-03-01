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
    if (h.endsWith('github.io') || p.startsWith('/discord-crypto-task-payroll-bot')) {
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
