import axios from 'axios'

const API_BASE = (import.meta as any).env?.VITE_API_BASE || ''
const API_PREFIX = API_BASE ? `${API_BASE.replace(/\/$/, '')}/api` : '/api'

export const api = axios.create({
  baseURL: API_PREFIX,
})

export const getAuthUrl = (path = '/auth/discord') => {
  const base = API_BASE || ''
  return `${base.replace(/\/$/, '')}${path}`
}
