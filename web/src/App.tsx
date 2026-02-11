import React, { useEffect, useState } from 'react'
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import VoteEvents from './pages/VoteEvents'
import Contests from './pages/Contests'
import BulkTasks from './pages/BulkTasks'
import Events from './pages/Events'
import History from './pages/History'
import Treasury from './pages/Treasury'
import Workers from './pages/Workers'

const ScheduledPosts = React.lazy(() => import('./pages/ScheduledPosts'))
const Proofs = React.lazy(() => import('./pages/Proofs'))

import PerformanceMonitor from './components/PerformanceMonitor'
import ProfilerLogger from './components/ProfilerLogger'
import { api, API_BASE, getAuthUrl } from './api'

type Page = 'dashboard' | 'tasks' | 'bulk_tasks' | 'votes' | 'contests' | 'events' | 'history' | 'treasury' | 'workers' | 'scheduled' | 'proofs'

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'treasury', label: 'Treasury', icon: '💰' },
  { id: 'workers', label: 'Workers', icon: '👥' },
  { id: 'tasks', label: 'Tasks', icon: '📋' },
  { id: 'bulk_tasks', label: 'Bulk Tasks', icon: '📦' },
  { id: 'contests', label: 'Contests', icon: '🏆' },
  { id: 'votes', label: 'Vote Events', icon: '🗳️' },
  { id: 'events', label: 'Events', icon: '📅' },
  { id: 'history', label: 'History', icon: '📜' },
  { id: 'scheduled', label: 'Scheduled Posts', icon: '⏰' },
  { id: 'proofs', label: 'Proofs', icon: '✅' },
]

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [user, setUser] = useState<{ id: string; username: string; discriminator: string } | null>(null)
  const [guilds, setGuilds] = useState<{ id: string; name: string }[]>([])
  const [guildId, setGuildId] = useState<string>('')

  useEffect(() => {
    // Handle hash-based navigation
    const hash = window.location.hash.replace('#', '') as Page
    if (hash && NAV_ITEMS.some(n => n.id === hash)) setPage(hash)

    try {
      const url = new URL(window.location.href)
      const token = url.searchParams.get('dcb_token')
      if (token) {
        window.localStorage.setItem('dcb_token', token)
        url.searchParams.delete('dcb_token')
        window.history.replaceState({}, '', url.toString())
      }
    } catch (_) {}

    api.get('/auth/me')
      .then(r => {
        setUser(r.data.user)
        return api.get('/admin/guilds')
      })
      .then(r => {
        const gs = (r.data || []) as { id: string; name: string }[]
        setGuilds(gs)
        if (!guildId && gs.length) setGuildId(gs[0].id)
      })
      .catch(() => {
        setUser(null)
        setGuilds([])
        setGuildId('')
      })
  }, [])

  const navigate = (p: Page) => {
    setPage(p)
    window.location.hash = p
  }

  // Not logged in - show login screen
  if (!user) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div style={{ marginBottom: 16 }}>
            <div className="sidebar-brand-icon" style={{ width: 56, height: 56, fontSize: 28, margin: '0 auto 12px' }}>D</div>
          </div>
          <h1>DiscryptoBank</h1>
          <p>Discord Crypto Task & Payroll Manager</p>
          {API_BASE ? (
            <a className="btn btn-primary" href={getAuthUrl()} style={{ padding: '12px 32px', fontSize: 15 }}>
              Login with Discord
            </a>
          ) : (
            <button className="btn btn-secondary" disabled>Login with Discord (backend required)</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">D</div>
          <span className="sidebar-brand-text">DiscryptoBank</span>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`sidebar-nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user.username}</div>
            <div className="sidebar-user-tag">#{user.discriminator}</div>
          </div>
          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => { await api.post('/auth/logout'); location.reload() }}
            title="Logout"
          >
            ↪
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="main-content">
        <div className="top-bar">
          <select
            className="top-bar-guild-select"
            value={guildId}
            onChange={e => setGuildId(e.target.value)}
          >
            {guilds.length === 0 && <option value="">No servers</option>}
            {guilds.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <div className="top-bar-actions">
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </div>

        <main>
          <PerformanceMonitor />
          <ProfilerLogger id="App">
            {page === 'dashboard' && <Dashboard guildId={guildId} onNavigate={navigate} />}
            {page === 'tasks' && <Tasks guildId={guildId} />}
            {page === 'bulk_tasks' && <BulkTasks guildId={guildId} />}
            {page === 'votes' && <VoteEvents guildId={guildId} />}
            {page === 'contests' && <Contests guildId={guildId} />}
            {page === 'events' && <Events guildId={guildId} />}
            {page === 'history' && <History guildId={guildId} />}
            {page === 'treasury' && <Treasury guildId={guildId} />}
            {page === 'workers' && <Workers guildId={guildId} />}
            {page === 'scheduled' && <React.Suspense fallback={<div className="container"><div className="spinner" /></div>}><ScheduledPosts /></React.Suspense>}
            {page === 'proofs' && <React.Suspense fallback={<div className="container"><div className="spinner" /></div>}><Proofs /></React.Suspense>}
          </ProfilerLogger>
        </main>

        <footer className="app-footer">
          DiscryptoBank &copy; {new Date().getFullYear()}. All rights reserved.
        </footer>
      </div>
    </div>
  )
}
