import React, { useEffect, useState } from 'react'
import { api } from '../api'
import Countdown, { useTick } from '../components/Countdown'

type Contest = {
  id: number
  title: string
  description?: string
  prize_amount: number
  currency: string
  status: string
  current_entries?: number
  max_entries: number
  num_winners?: number
  ends_at?: string
  channel_id?: string
  message_id?: string
}

type Channel = { id: string, name: string }

type Props = {
  guildId: string
}

// timeLeft is now handled by the Countdown component (auto-updating)

export default function Contests({ guildId }: Props) {
  useTick(1000)

  const [contests, setContests] = useState<Contest[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)

  const [channelId, setChannelId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [prizeAmount, setPrizeAmount] = useState('')
  const [currency, setCurrency] = useState('SOL')
  const [numWinners, setNumWinners] = useState('')
  const [maxEntries, setMaxEntries] = useState('')
  const [durationHours, setDurationHours] = useState('')
  const [referenceUrl, setReferenceUrl] = useState('')

  const load = async () => {
    if (!guildId) return
    setLoading(true)
    try {
      const [cRes, chRes] = await Promise.all([
        api.get(`/admin/guilds/${guildId}/contests`),
        api.get(`/admin/guilds/${guildId}/channels`),
      ])
      setContests(cRes.data || [])
      setChannels(chRes.data || [])
      if (!channelId && (chRes.data || []).length) setChannelId(chRes.data[0].id)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setContests([])
    setChannels([])
    setChannelId('')
    if (guildId) load()
  }, [guildId])

  /* ---- Auto-poll every 15s ---- */
  useEffect(() => {
    if (!guildId) return
    const id = setInterval(() => {
      api.get(`/admin/guilds/${guildId}/contests`)
        .then(r => setContests(r.data || []))
        .catch(() => {})
    }, 15000)
    return () => clearInterval(id)
  }, [guildId])

  const handleCreate = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!guildId) return

    await api.post(`/admin/guilds/${guildId}/contests`, {
      channel_id: channelId,
      title,
      description,
      prize_amount: Number(prizeAmount),
      currency,
      num_winners: Number(numWinners || 1),
      max_entries: Number(maxEntries),
      duration_hours: Number(durationHours),
      reference_url: referenceUrl,
    })

    setTitle('')
    setDescription('')
    setPrizeAmount('')
    setNumWinners('')
    setMaxEntries('')
    setDurationHours('')
    setReferenceUrl('')
    await load()
  }

  const publish = async (contestId: number) => {
    if (!guildId) return
    await api.post(`/admin/guilds/${guildId}/contests/${contestId}/publish`, { channel_id: channelId })
    await load()
  }

  if (!guildId) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state-icon">🏆</div>
          <div className="empty-state-text">Select a server to manage contests.</div>
        </div>
      </div>
    )
  }

  const active = contests.filter(c => c.status === 'active' || c.status === 'open')
  const ended = contests.filter(c => c.status !== 'active' && c.status !== 'open')

  return (
    <div className="container">
      <div className="section-header" style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 0 }}>Contests</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select className="form-select" value={channelId} onChange={e => setChannelId(e.target.value)} style={{ minWidth: 160 }}>
            {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-icon yellow">🏆</div>
          <div className="stat-info">
            <div className="stat-label">Total Contests</div>
            <div className="stat-value">{contests.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">🔥</div>
          <div className="stat-info">
            <div className="stat-label">Active</div>
            <div className="stat-value">{active.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon purple">💎</div>
          <div className="stat-info">
            <div className="stat-label">Total Prizes</div>
            <div className="stat-value">{contests.reduce((s, c) => s + c.prize_amount, 0).toFixed(1)}</div>
          </div>
        </div>
      </div>

      {/* Contest cards */}
      {contests.length === 0 ? (
        <div className="card" style={{ marginBottom: 28 }}>
          <div className="empty-state">
            <div className="empty-state-icon">🏆</div>
            <div className="empty-state-text">{loading ? 'Loading...' : 'No contests yet. Create one below!'}</div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginBottom: 28 }}>
          {contests.map(c => (
            <div key={c.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Header band */}
              <div style={{ padding: '14px 18px', background: c.status === 'active' || c.status === 'open' ? 'rgba(52,211,153,0.06)' : 'rgba(92,107,130,0.06)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className={`badge ${c.status === 'active' || c.status === 'open' ? 'badge-active' : c.status === 'ended' || c.status === 'completed' ? 'badge-completed' : 'badge-pending'}`}>{c.status}</span>
                <span className="sol-badge">{c.prize_amount} {c.currency}</span>
              </div>
              <div style={{ padding: '16px 18px' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{c.title}</div>
                {c.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.4 }}>{c.description}</div>}
                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, flexWrap: 'wrap' }}>
                  <span>🎟️ {c.current_entries || 0}/{c.max_entries} entries</span>
                  {c.num_winners && <span>👑 {c.num_winners} winner{c.num_winners > 1 ? 's' : ''}</span>}
                  {c.ends_at && <Countdown endsAt={c.ends_at} prefix='⏰ ' />}
                </div>
                <button className="btn btn-sm btn-primary" onClick={() => publish(c.id)} disabled={!channelId} style={{ width: '100%' }}>Publish to Channel</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create form */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Create Contest</div>
        </div>
        <form onSubmit={handleCreate}>
          <div className="form-row" style={{ marginBottom: 14 }}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Title</label>
              <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Contest title" required />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label className="form-label">Description</label>
            <textarea className="form-textarea" value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the contest rules and prizes" required />
          </div>
          <div className="form-row" style={{ marginBottom: 14 }}>
            <div className="form-group">
              <label className="form-label">Prize Amount</label>
              <input className="form-input" value={prizeAmount} onChange={e => setPrizeAmount(e.target.value)} placeholder="1.0" type="number" step="any" required />
            </div>
            <div className="form-group">
              <label className="form-label">Currency</label>
              <select className="form-select" value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="SOL">SOL</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Winners</label>
              <input className="form-input" value={numWinners} onChange={e => setNumWinners(e.target.value)} placeholder="1" type="number" required />
            </div>
          </div>
          <div className="form-row" style={{ marginBottom: 14 }}>
            <div className="form-group">
              <label className="form-label">Max Entries</label>
              <input className="form-input" value={maxEntries} onChange={e => setMaxEntries(e.target.value)} placeholder="50" type="number" required />
            </div>
            <div className="form-group">
              <label className="form-label">Duration (hours)</label>
              <input className="form-input" value={durationHours} onChange={e => setDurationHours(e.target.value)} placeholder="24" type="number" required />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Reference URL</label>
            <input className="form-input" value={referenceUrl} onChange={e => setReferenceUrl(e.target.value)} placeholder="https://..." required />
          </div>
          <button type="submit" className="btn btn-primary" disabled={!channelId}>Create Contest</button>
        </form>
      </div>
    </div>
  )
}