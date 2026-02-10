import React, { useEffect, useState } from 'react'
import { api } from '../api'

type Stats = {
  activeTasks: number
  pendingProofs: number
  workers: number
  liveContests: number
  activeEvents: number
}

type Activity = {
  id: number
  type: string
  title: string
  description: string
  user_tag: string
  amount: number
  currency: string
  created_at: string
}

type Task = {
  id: number
  title: string
  description: string
  payout_amount: number
  payout_currency: string
  status: string
  filled_slots: number
  total_slots: number
}

type Contest = {
  id: number
  title: string
  description: string
  prize_amount: number
  currency: string
  status: string
  current_entries: number
  max_entries: number
  ends_at: string
}

type Transaction = {
  id: number
  from_address: string
  to_address: string
  amount: number
  status: string
  created_at: string
}

type Props = {
  guildId: string
  onNavigate: (page: string) => void
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function badgeClass(status: string): string {
  switch (status) {
    case 'active': return 'badge badge-active'
    case 'open': return 'badge badge-open'
    case 'in progress': case 'assigned': return 'badge badge-progress'
    case 'completed': return 'badge badge-completed'
    case 'ended': return 'badge badge-ended'
    case 'scheduled': return 'badge badge-scheduled'
    case 'pending': return 'badge badge-pending'
    default: return 'badge badge-open'
  }
}

export default function Dashboard({ guildId, onNavigate }: Props) {
  const [stats, setStats] = useState<Stats>({ activeTasks: 0, pendingProofs: 0, workers: 0, liveContests: 0, activeEvents: 0 })
  const [activity, setActivity] = useState<Activity[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [contests, setContests] = useState<Contest[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [activityFilter, setActivityFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)

  useEffect(() => {
    if (!guildId) return
    setLoading(true)
    Promise.all([
      api.get(`/admin/guilds/${guildId}/dashboard/stats`).catch(() => ({ data: {} })),
      api.get(`/admin/guilds/${guildId}/dashboard/activity?limit=10`).catch(() => ({ data: [] })),
      api.get(`/admin/guilds/${guildId}/bulk-tasks`).catch(() => ({ data: [] })),
      api.get(`/admin/guilds/${guildId}/contests`).catch(() => ({ data: [] })),
      api.get(`/admin/guilds/${guildId}/transactions?limit=5`).catch(() => ({ data: [] })),
      api.get(`/admin/guilds/${guildId}/dashboard/balance`).catch(() => ({ data: {} })),
    ]).then(([statsRes, actRes, tasksRes, contestsRes, txRes, balRes]) => {
      setStats(statsRes.data as Stats)
      setActivity(actRes.data as Activity[])
      setTasks((tasksRes.data || []).slice(0, 3) as Task[])
      setContests((contestsRes.data || []).slice(0, 3) as Contest[])
      setTransactions((txRes.data || []) as Transaction[])
      setWalletAddress(balRes.data?.wallet_address || null)
    }).finally(() => setLoading(false))
  }, [guildId])

  useEffect(() => {
    if (!guildId) return
    api.get(`/admin/guilds/${guildId}/dashboard/activity?limit=10&type=${activityFilter}`)
      .then(r => setActivity(r.data || []))
      .catch(() => {})
  }, [activityFilter, guildId])

  if (!guildId) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <div className="empty-state-text">Login and select a server to view dashboard.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      {/* Balance Card */}
      <div className="balance-card">
        <div className="balance-label">
          <span className="live-dot" />
          Live Balance
        </div>
        <div className="balance-value">
          {walletAddress ? '◎ --' : '$0.00'}
          <span className="balance-change positive">+12.5%</span>
        </div>
        <div className="balance-sub">
          {walletAddress ? `Wallet: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'No wallet configured'}
        </div>
        <div className="balance-actions">
          <button className="balance-btn primary">Send</button>
          <button className="balance-btn primary">Deposit</button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">📋</div>
          <div className="stat-info">
            <div className="stat-label">Active Tasks</div>
            <div className="stat-value">{loading ? '-' : stats.activeTasks}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon yellow">⏳</div>
          <div className="stat-info">
            <div className="stat-label">Pending</div>
            <div className="stat-value">{loading ? '-' : stats.pendingProofs}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">👥</div>
          <div className="stat-info">
            <div className="stat-label">Workers</div>
            <div className="stat-value">{loading ? '-' : stats.workers}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon purple">🏆</div>
          <div className="stat-info">
            <div className="stat-label">Live Contests</div>
            <div className="stat-value">{loading ? '-' : stats.liveContests}</div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">Quick Actions</div>
        </div>
        <div className="quick-actions">
          <button className="quick-action-btn" onClick={() => onNavigate('tasks')}>
            <span className="qa-icon">📋</span>
            Create Task
          </button>
          <button className="quick-action-btn" onClick={() => onNavigate('history')}>
            <span className="qa-icon">💸</span>
            Send Payment
          </button>
          <button className="quick-action-btn" onClick={() => onNavigate('contests')}>
            <span className="qa-icon">🏆</span>
            Start Contest
          </button>
          <button className="quick-action-btn" onClick={() => onNavigate('events')}>
            <span className="qa-icon">📅</span>
            Schedule Event
          </button>
        </div>
      </div>

      {/* Dashboard Grid */}
      <div className="dashboard-grid">
        {/* Live Activity */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Live Activity</div>
          </div>
          <div className="activity-tabs">
            {['all', 'task', 'payment', 'contest'].map(f => (
              <button
                key={f}
                className={`activity-tab ${activityFilter === f ? 'active' : ''}`}
                onClick={() => setActivityFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
                {f === 'all' ? '' : 's'}
              </button>
            ))}
          </div>
          <div className="activity-list">
            {activity.length === 0 && (
              <div className="empty-state" style={{ padding: 20 }}>
                <div className="empty-state-text">No recent activity</div>
              </div>
            )}
            {activity.map(a => (
              <div key={a.id} className="activity-item">
                <div className={`activity-dot ${a.type}`} />
                <div className="activity-text">
                  <strong>{a.title}</strong> {a.user_tag || ''}
                </div>
                {a.amount ? (
                  <span className={`activity-amount ${a.amount >= 0 ? 'positive' : 'negative'}`}>
                    {a.amount >= 0 ? '+' : ''}{a.amount} {a.currency}
                  </span>
                ) : null}
                <span className="activity-time">{timeAgo(a.created_at)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Active Tasks */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Active Tasks</div>
            <button className="view-all" onClick={() => onNavigate('bulk_tasks')}>View All</button>
          </div>
          <div className="item-cards">
            {tasks.length === 0 && (
              <div className="empty-state" style={{ padding: 20 }}>
                <div className="empty-state-text">No active tasks</div>
              </div>
            )}
            {tasks.map(t => (
              <div key={t.id} className="item-card">
                <div className="item-card-header">
                  <span className={badgeClass(t.status)}>{t.status}</span>
                  <span className="sol-badge">{t.payout_amount} {t.payout_currency}</span>
                </div>
                <div className="item-card-title">{t.title}</div>
                <div className="item-card-desc">{t.description || 'No description'}</div>
                <div className="item-card-meta">
                  <span>Slots: {t.filled_slots}/{t.total_slots}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Active Contests */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Active Contests</div>
            <button className="view-all" onClick={() => onNavigate('contests')}>View All</button>
          </div>
          <div className="item-cards">
            {contests.length === 0 && (
              <div className="empty-state" style={{ padding: 20 }}>
                <div className="empty-state-text">No contests</div>
              </div>
            )}
            {contests.map(c => (
              <div key={c.id} className="item-card">
                <div className="item-card-header">
                  <span className={badgeClass(c.status)}>{c.status}</span>
                  <span className="sol-badge">{c.prize_amount} {c.currency}</span>
                </div>
                <div className="item-card-title">{c.title}</div>
                <div className="item-card-desc">{c.description || 'No description'}</div>
                <div className="item-card-meta">
                  <span>🎟️ {c.current_entries || 0}/{c.max_entries}</span>
                  {c.ends_at && <span>Ends: {new Date(c.ends_at).toLocaleDateString()}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Recent Transactions</div>
            <button className="view-all" onClick={() => onNavigate('history')}>View All</button>
          </div>
          <div className="tx-list">
            {transactions.length === 0 && (
              <div className="empty-state" style={{ padding: 20 }}>
                <div className="empty-state-text">No transactions yet</div>
              </div>
            )}
            {transactions.map(tx => {
              const isOutgoing = true // from guild wallet
              return (
                <div key={tx.id} className="tx-item">
                  <div className={`tx-icon ${isOutgoing ? 'outgoing' : 'incoming'}`}>
                    {isOutgoing ? '↗' : '↙'}
                  </div>
                  <div className="tx-details">
                    <div className="tx-title">
                      {tx.to_address ? `To ${tx.to_address.slice(0, 6)}...${tx.to_address.slice(-4)}` : 'Payment'}
                    </div>
                    <div className="tx-sub">{timeAgo(tx.created_at)}</div>
                  </div>
                  <div className={`tx-amount ${isOutgoing ? 'negative' : 'positive'}`}>
                    {isOutgoing ? '-' : '+'}{tx.amount} SOL
                  </div>
                  <span className="badge badge-completed">{tx.status}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
