import React, { useEffect, useState, useRef } from 'react'
import { api } from '../api'
import { formatTimeAgo } from './Countdown'

type TickerItem = {
  id: number
  type: 'vote' | 'race'
  title: string
  status: string
  prize_amount: number
  currency: string
  participants: number
  detail: string
  winners: number
  created_at: string
  ends_at: string
}

type TickerStats = {
  total_events: number
  completed_events: number
  active_events: number
  cancelled_events: number
  total_prize_paid: number
  total_participants: number
}

type Props = {
  guildId: string
}

export default function EventTicker({ guildId }: Props) {
  const [items, setItems] = useState<TickerItem[]>([])
  const [stats, setStats] = useState<TickerStats | null>(null)
  const [paused, setPaused] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)

  const load = () => {
    if (!guildId) return
    api.get(`/admin/guilds/${guildId}/ticker`)
      .then(r => {
        setItems(r.data?.items || [])
        setStats(r.data?.stats || null)
      })
      .catch(() => {})
  }

  useEffect(() => { load() }, [guildId])

  // Auto-refresh every 60s
  useEffect(() => {
    if (!guildId) return
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [guildId])

  if (!items.length) return null

  const typeIcon = (item: TickerItem) => {
    if (item.type === 'race') return '🏇'
    return '🗳️'
  }

  const statusIcon = (s: string) => {
    switch (s) {
      case 'ended': case 'completed': return '✅'
      case 'cancelled': return '❌'
      case 'active': return '🟢'
      default: return '📋'
    }
  }

  const statusColor = (s: string) => {
    switch (s) {
      case 'ended': case 'completed': return 'var(--success)'
      case 'cancelled': return 'var(--danger)'
      case 'active': return 'var(--accent)'
      default: return 'var(--text-muted)'
    }
  }

  // Calculate animation duration based on items (more items = slower scroll)
  const duration = Math.max(20, items.length * 8)

  return (
    <div className="event-ticker-wrap" style={{ marginBottom: 20 }}>
      {/* Aggregate stats bar */}
      {stats && (
        <div className="event-ticker-stats">
          <span className="ticker-stat">
            <span className="ticker-stat-label">Total Events</span>
            <span className="ticker-stat-value">{stats.total_events}</span>
          </span>
          <span className="ticker-stat">
            <span className="ticker-stat-label">Active</span>
            <span className="ticker-stat-value" style={{ color: 'var(--accent)' }}>{stats.active_events || 0}</span>
          </span>
          <span className="ticker-stat">
            <span className="ticker-stat-label">Completed</span>
            <span className="ticker-stat-value" style={{ color: 'var(--success)' }}>{stats.completed_events}</span>
          </span>
          <span className="ticker-stat">
            <span className="ticker-stat-label">Cancelled</span>
            <span className="ticker-stat-value" style={{ color: 'var(--danger)' }}>{stats.cancelled_events || 0}</span>
          </span>
          <span className="ticker-stat">
            <span className="ticker-stat-label">Total Paid</span>
            <span className="ticker-stat-value" style={{ color: 'var(--accent)' }}>
              {(stats.total_prize_paid || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </span>
          <span className="ticker-stat">
            <span className="ticker-stat-label">Participants</span>
            <span className="ticker-stat-value">{stats.total_participants || 0}</span>
          </span>
        </div>
      )}

      {/* Scrolling ticker */}
      <div
        className="event-ticker"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="event-ticker-label">📜 EVENTS</div>
        <div className="event-ticker-track-wrapper">
          <div
            ref={trackRef}
            className="event-ticker-track"
            style={{
              animationDuration: `${duration}s`,
              animationPlayState: paused ? 'paused' : 'running',
            }}
          >
            {/* Duplicate items for seamless loop */}
            {[...items, ...items].map((ev, i) => (
              <div className="event-ticker-item" key={`${ev.type}-${ev.id}-${i}`}>
                <span className="ticker-item-icon">{statusIcon(ev.status)}</span>
                <span className="ticker-item-icon" style={{ fontSize: 11 }}>{typeIcon(ev)}</span>
                <span className="ticker-item-title">{ev.title}</span>
                <span className="ticker-item-sep">·</span>
                <span className="ticker-item-detail">
                  👥 {ev.participants || 0}
                </span>
                <span className="ticker-item-sep">·</span>
                <span className="ticker-item-detail">
                  {ev.detail}
                </span>
                {ev.winners > 0 && (
                  <>
                    <span className="ticker-item-sep">·</span>
                    <span className="ticker-item-detail" style={{ color: 'var(--success)' }}>
                      🏆 {ev.winners} winner{ev.winners > 1 ? 's' : ''}
                    </span>
                  </>
                )}
                <span className="ticker-item-sep">·</span>
                <span className="ticker-item-detail" style={{ color: 'var(--accent)' }}>
                  💰 {ev.prize_amount?.toFixed?.(2) ?? ev.prize_amount} {ev.currency || 'SOL'}
                </span>
                <span className="ticker-item-sep">·</span>
                <span className="ticker-item-time" style={{ color: statusColor(ev.status) }}>
                  {ev.status === 'active' ? '🔴 LIVE' : formatTimeAgo(ev.ends_at || ev.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
