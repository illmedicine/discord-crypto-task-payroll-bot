import React, { useEffect, useRef, useState } from 'react'
import Dashboard from './pages/Dashboard'
import Events from './pages/Events'
import History from './pages/History'
import Treasury from './pages/Treasury'
import Workers from './pages/Workers'
import QualifyPage from './pages/QualifyPage'

const Proofs = React.lazy(() => import('./pages/Proofs'))

import PerformanceMonitor from './components/PerformanceMonitor'
import ProfilerLogger from './components/ProfilerLogger'
import api, { API_BASE, getAuthUrl, getGoogleAuthUrl, getGoogleLinkUrl, getDiscordLinkUrl } from './api'

type Page = 'dashboard' | 'votes' | 'history' | 'treasury' | 'workers' | 'proofs' | 'qualify'

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'treasury', label: 'Treasury', icon: '💰' },
  { id: 'workers', label: 'Workers', icon: '👥' },
  { id: 'votes', label: 'Vote Events', icon: '🗳️' },
  { id: 'history', label: 'History', icon: '📜' },
  { id: 'proofs', label: 'Proofs', icon: '✅' },
]

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [user, setUser] = useState<{ id: string; username: string; discriminator: string; avatar?: string; auth_provider?: string; google_email?: string; google_picture?: string; google_id?: string } | null>(null)
  const [guilds, setGuilds] = useState<{ id: string; name: string }[]>([])
  const [guildId, setGuildId] = useState<string>('')
  const [accountInfo, setAccountInfo] = useState<{ discord_linked: boolean; google_linked: boolean; google_email?: string } | null>(null)
  const [authProviders, setAuthProviders] = useState<{ discord: boolean; google: boolean }>({ discord: true, google: false })
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [qualifyEventId, setQualifyEventId] = useState<number | null>(null)
  const profileRef = useRef<HTMLDivElement>(null)

  // Close profile menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false)
      }
    }
    if (profileMenuOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [profileMenuOpen])

  // Save preferences to backend whenever guild or page changes
  const savePrefs = async (gid: string, p: string) => {
    try {
      await api.put('/user/preferences', { selected_guild_id: gid, selected_page: p })
    } catch (_) {}
    // Also save to localStorage as fallback
    try {
      localStorage.setItem('dcb_selected_guild', gid)
      localStorage.setItem('dcb_selected_page', p)
    } catch (_) {}
  }

  useEffect(() => {
    // Handle hash-based navigation
    const hash = window.location.hash.replace(/^#/, '')
    // Check for qualify-{eventId} hash
    const qualifyMatch = hash.match(/^qualify-(\d+)$/)
    if (qualifyMatch) {
      setQualifyEventId(Number(qualifyMatch[1]))
      setPage('qualify')
    } else if (hash && NAV_ITEMS.some(n => n.id === hash)) {
      setPage(hash as Page)
    }

    try {
      const url = new URL(window.location.href)
      const token = url.searchParams.get('dcb_token')
      if (token) {
        window.localStorage.setItem('dcb_token', token)
        url.searchParams.delete('dcb_token')
        window.history.replaceState({}, '', url.toString())
      }
    } catch (_) {}

    // Check which auth providers are available
    api.get('/auth/providers').then(r => setAuthProviders(r.data || { discord: true, google: false })).catch(() => {})

    api.get('/auth/me')
      .then(async (r) => {
        setUser(r.data.user)

        // Load saved preferences (backend first, localStorage fallback)
        let savedGuild = ''
        let savedPage = ''
        try {
          const prefRes = await api.get('/user/preferences')
          if (prefRes.data?.selected_guild_id) savedGuild = prefRes.data.selected_guild_id
          if (prefRes.data?.selected_page) savedPage = prefRes.data.selected_page
        } catch (_) {}
        if (!savedGuild) savedGuild = localStorage.getItem('dcb_selected_guild') || ''
        if (!savedPage) savedPage = localStorage.getItem('dcb_selected_page') || ''

        // Load account info (linked providers)
        try {
          const accRes = await api.get('/user/account')
          setAccountInfo(accRes.data)
        } catch (_) {}

        return api.get('/admin/guilds').then(r2 => {
          const gs = (r2.data || []) as { id: string; name: string }[]
          setGuilds(gs)
          // Restore saved guild if it still exists, otherwise pick first
          const restored = savedGuild && gs.some(g => g.id === savedGuild) ? savedGuild : (gs[0]?.id || '')
          setGuildId(restored)
          // Restore saved page
          if (savedPage && NAV_ITEMS.some(n => n.id === savedPage)) {
            setPage(savedPage as Page)
            window.location.hash = savedPage
          }
          setPrefsLoaded(true)
        })
      })
      .catch(() => {
        setUser(null)
        setGuilds([])
        setGuildId('')
        setPrefsLoaded(true)
      })
  }, [])

  const navigate = (p: Page) => {
    setPage(p)
    window.location.hash = p
    if (prefsLoaded) savePrefs(guildId, p)
  }

  const handleGuildChange = (newGuildId: string) => {
    setGuildId(newGuildId)
    if (prefsLoaded) savePrefs(newGuildId, page)
  }

  // Not logged in - show login screen
  if (!user) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div style={{ marginBottom: 20 }}>
            <img src="https://illmedicine.github.io/DisCryptoBankWebSite/assets/discryptobank-logo.png" alt="DCB" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 14px', display: 'block', boxShadow: '0 8px 24px rgba(99,140,255,0.3)' }} />
          </div>
          <h1>DCB Event Manager</h1>
          <p>Discord Crypto Task & Payroll Manager</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8, width: '100%', maxWidth: 300, margin: '0 auto' }}>
            {API_BASE ? (
              <>
                {authProviders.google ? (
                  <a className="btn btn-primary" href={getGoogleAuthUrl()} onClick={() => localStorage.removeItem('dcb_token')} style={{ padding: '13px 32px', fontSize: 15, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                    Sign in with Google
                  </a>
                ) : (
                  <button className="btn btn-primary" disabled style={{ padding: '13px 32px', fontSize: 15, opacity: 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#999" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#999" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#999" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#999" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                    Google Sign-In (not configured)
                  </button>
                )}
                <a className="btn btn-secondary" href={getAuthUrl()} onClick={() => localStorage.removeItem('dcb_token')} style={{ padding: '13px 32px', fontSize: 15, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
                  Login with Discord
                </a>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center', lineHeight: 1.5 }}>
                  Sign in with Google to retain settings across sessions.<br />
                  Link Discord after for full guild access.
                </p>
              </>
            ) : (
              <button className="btn btn-secondary" disabled>Login (backend required)</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src="https://illmedicine.github.io/DisCryptoBankWebSite/assets/discryptobank-logo.png" alt="DCB" className="sidebar-brand-logo" />
          <span className="sidebar-brand-text">DCB Event Manager</span>
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

        <div className="sidebar-user-wrapper" ref={profileRef}>
          <button className="sidebar-user" onClick={() => setProfileMenuOpen(v => !v)}>
            <div className="sidebar-user-avatar" title={user.auth_provider === 'google' ? `Google: ${user.google_email || ''}` : `Discord: ${user.username}`}>
              {user.auth_provider !== 'google' && user.avatar ? (
                <img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
              ) : user.google_picture ? (
                <img src={user.google_picture} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                user.username.charAt(0).toUpperCase()
              )}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user.username}</div>
              <div className="sidebar-user-tag">
                {user.auth_provider === 'google' ? 'Google' : 'Discord'}
                {accountInfo?.google_linked && accountInfo?.discord_linked && ' + linked'}
              </div>
            </div>
            <span className="sidebar-user-caret">{profileMenuOpen ? '▾' : '▸'}</span>
          </button>

          {profileMenuOpen && (
            <div className="profile-menu">
              <div className="profile-menu-header">
                <div className="profile-menu-avatar">
                  {user.auth_provider !== 'google' && user.avatar ? (
                    <img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`} alt="" />
                  ) : user.google_picture ? (
                    <img src={user.google_picture} alt="" />
                  ) : (
                    user.username.charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <div className="profile-menu-name">{user.username}</div>
                  <div className="profile-menu-provider">
                    {user.auth_provider === 'google' ? (
                      <><span className="provider-badge google">Google</span>{accountInfo?.discord_linked && <span className="provider-badge discord">Discord</span>}</>
                    ) : (
                      <><span className="provider-badge discord">Discord</span>{accountInfo?.google_linked && <span className="provider-badge google">Google</span>}</>
                    )}
                  </div>
                  {user.google_email && <div className="profile-menu-email">{user.google_email}</div>}
                </div>
              </div>

              <div className="profile-menu-divider" />

              {user.auth_provider === 'google' && !accountInfo?.discord_linked && (
                <a className="profile-menu-item" href={getDiscordLinkUrl()} onClick={() => localStorage.removeItem('dcb_token')}>
                  <span className="profile-menu-icon">🔗</span> Link Discord
                </a>
              )}
              {user.auth_provider !== 'google' && !accountInfo?.google_linked && authProviders.google && (
                <a className="profile-menu-item" href={getGoogleLinkUrl()} onClick={() => localStorage.removeItem('dcb_token')}>
                  <span className="profile-menu-icon">🔗</span> Link Google
                </a>
              )}

              <div className="profile-menu-divider" />

              <button
                className="profile-menu-item logout"
                onClick={async () => { localStorage.removeItem('dcb_token'); try { await api.post('/auth/logout') } catch(_) {}; location.reload() }}
              >
                <span className="profile-menu-icon">🚪</span> Logout
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="main-content">
        <div className="top-bar">
          <select
            className="top-bar-guild-select"
            value={guildId}
            onChange={e => handleGuildChange(e.target.value)}
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
            {page === 'qualify' && qualifyEventId && <QualifyPage eventId={qualifyEventId} />}
            {page === 'votes' && <Events guildId={guildId} />}
            {page === 'history' && <History guildId={guildId} />}
            {page === 'treasury' && <Treasury guildId={guildId} />}
            {page === 'workers' && <Workers guildId={guildId} />}
            {page === 'proofs' && <React.Suspense fallback={<div className="container"><div className="spinner" /></div>}><Proofs guildId={guildId} /></React.Suspense>}
          </ProfilerLogger>
        </main>

        <footer className="app-footer">
          DiscryptoBank &copy; {new Date().getFullYear()}. All rights reserved.
        </footer>
      </div>
    </div>
  )
}
