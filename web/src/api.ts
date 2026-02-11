import axios from 'axios'

const ENV_API_BASE = (import.meta as any).env?.VITE_API_BASE || ''

const DEFAULT_PROD_API_BASE = 'https://dcb-payroll-backend-production.up.railway.app'

export const API_BASE = (() => {
  if (ENV_API_BASE) return ENV_API_BASE
  if (typeof window !== 'undefined' && window.location?.hostname?.endsWith('github.io')) return DEFAULT_PROD_API_BASE
  return ''
})()
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

export const getAuthUrl = (path = '/auth/discord') => {
  let base = API_BASE || ''
  if (!base && typeof window !== 'undefined' && window.location?.hostname?.endsWith('github.io')) {
    base = DEFAULT_PROD_API_BASE
  }
  return `${base.replace(/\/$/, '')}${path}`
}

export const getGoogleAuthUrl = () => getAuthUrl('/auth/google')
export const getGoogleLinkUrl = () => getAuthUrl('/auth/google/link')
