import React, { useEffect, useState, useRef } from 'react'
import { api } from '../api'
import { formatTimeAgo } from './Countdown'

type HistoryEvent = {
  id: number
  title: string
  status: string
  prize_amount: number
  currency: string
  current_participants: number
  total_participants: number
  total_votes: number
  total_winners: number
  created_at: string
  ends_at: string
}

type HistoryStats = {
  total_events: number
  completed_events: number
  cancelled_events: number
  total_prize_paid: number
  total_participants_all: number
}

type Props = {
  guildId: string
}

export default function EventTicker({ guildId }: Props) {
  const [events, setEvents] = useState<HistoryEvent[]>([])
  const [stats, setStats] = useState<HistoryStats | null>(null)
  const [paused, setPaused] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)

  const load = () => {
    if (!guildId) return
    api.get(`/admin/guilds/${guildId}/vote-events/history`)
      .then(r => {
        setEvents(r.data?.events || [])
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

  if (!events.length) return null

  const statusIcon = (s: string) => {
    switch (s) {
      case 'ended': case 'completed': return '✅'
      case 'cancelled': return '❌'
      default: return '📋'
    }
  }

  const statusColor = (s: string) => {
    switch (s) {
      case 'ended': case 'completed': return 'var(--success)'
      case 'cancelled': return 'var(--danger)'
      default: return 'var(--text-muted)'
    }
  }

  // Calculate animation duration based on items (more items = slower scroll)
  const duration = Math.max(20, events.length * 8)

  return (
    <div className="event-ticker-wrap" style={{ marginBottom: 20 }}>
      {/* Aggregate stats bar */}
      {stats && (
        <div className="event-ticker-stats">
          <span className="ticker-stat">
            <span className="ticker-stat-label">Events Run</span>
            <span className="ticker-stat-value">{stats.total_events}</span>
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
            <span className="ticker-stat-value">{stats.total_participants_all || 0}</span>
          </span>
        </div>
      )}

      {/* Scrolling ticker */}
      <div
        className="event-ticker"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="event-ticker-label">📜 PAST EVENTS</div>
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
            {[...events, ...events].map((ev, i) => (
              <div className="event-ticker-item" key={`${ev.id}-${i}`}>
                <span className="ticker-item-icon">{statusIcon(ev.status)}</span>
                <span className="ticker-item-title">{ev.title}</span>
                <span className="ticker-item-sep">·</span>
                <span className="ticker-item-detail">
                  👥 {ev.total_participants || ev.current_participants || 0}
                </span>
                <span className="ticker-item-sep">·</span>
                <span className="ticker-item-detail">
                  🗳️ {ev.total_votes || 0} votes
                </span>
                {ev.total_winners > 0 && (
                  <>
                    <span className="ticker-item-sep">·</span>
                    <span className="ticker-item-detail" style={{ color: 'var(--success)' }}>
                      🏆 {ev.total_winners} winner{ev.total_winners > 1 ? 's' : ''}
                    </span>
                  </>
                )}
                <span className="ticker-item-sep">·</span>
                <span className="ticker-item-detail" style={{ color: 'var(--accent)' }}>
                  💰 {ev.prize_amount} {ev.currency || 'SOL'}
                </span>
                <span className="ticker-item-sep">·</span>
                <span className="ticker-item-time" style={{ color: statusColor(ev.status) }}>
                  {formatTimeAgo(ev.ends_at || ev.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
