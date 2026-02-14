import React, { useEffect, useState } from 'react'
import { api } from '../api'

type BulkTask = {
  id: number
  title: string
  description?: string
  payout_amount: number
  payout_currency: string
  total_slots: number
  filled_slots: number
  status: string
}

type Channel = { id: string, name: string }

type Props = {
  guildId: string
}

export default function BulkTasks({ guildId }: Props) {
  const [tasks, setTasks] = useState<BulkTask[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)

  const [channelId, setChannelId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [payoutAmount, setPayoutAmount] = useState('')
  const [payoutCurrency, setPayoutCurrency] = useState<'SOL' | 'USD'>('SOL')
  const [totalSlots, setTotalSlots] = useState('')

  const load = async () => {
    if (!guildId) return
    setLoading(true)
    try {
      const [tRes, chRes] = await Promise.all([
        api.get(`/admin/guilds/${guildId}/bulk-tasks`),
        api.get(`/admin/guilds/${guildId}/channels`),
      ])
      setTasks(tRes.data || [])
      setChannels(chRes.data || [])
      if (!channelId && (chRes.data || []).length) setChannelId(chRes.data[0].id)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setTasks([])
    setChannels([])
    setChannelId('')
    if (guildId) load()
  }, [guildId])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guildId) return

    await api.post(`/admin/guilds/${guildId}/bulk-tasks`, {
      title,
      description,
      payout_amount: Number(payoutAmount),
      payout_currency: payoutCurrency,
      total_slots: Number(totalSlots),
    })

    setTitle('')
    setDescription('')
    setPayoutAmount('')
    setTotalSlots('')
    await load()
  }

  const publish = async (taskId: number) => {
    if (!guildId) return
    await api.post(`/admin/guilds/${guildId}/bulk-tasks/${taskId}/publish`, { channel_id: channelId })
    await load()
  }

  if (!guildId) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state-icon">📦</div>
          <div className="empty-state-text">Select a server to manage bulk tasks.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <div className="section-header" style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 0 }}>Bulk Tasks</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <select className="form-select" value={channelId} onChange={(ev: React.ChangeEvent<HTMLSelectElement>) => setChannelId(ev.target.value)} style={{ minWidth: 160 }}>
              {channels.map((c: Channel) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-icon blue">📦</div>
          <div className="stat-info">
            <div className="stat-label">Total Tasks</div>
            <div className="stat-value">{tasks.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">✅</div>
          <div className="stat-info">
            <div className="stat-label">Active</div>
            <div className="stat-value">{tasks.filter(t => t.status === 'active' || t.status === 'open').length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon purple">🎫</div>
          <div className="stat-info">
            <div className="stat-label">Total Slots</div>
            <div className="stat-value">{tasks.reduce((s, t) => s + Number(t.total_slots), 0)}</div>
          </div>
        </div>
      </div>

      {/* Tasks list */}
      {tasks.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <div className="empty-state-text">{loading ? 'Loading...' : 'No bulk tasks created yet.'}</div>
          </div>
        </div>
      ) : (
        <div className="item-cards" style={{ marginBottom: 28 }}>
          {tasks.map(t => {
            const available = Number(t.total_slots) - Number(t.filled_slots)
            const pct = t.total_slots > 0 ? (t.filled_slots / t.total_slots) * 100 : 0
            return (
              <div key={t.id} className="item-card">
                <div className="item-card-header">
                  <span className={`badge ${t.status === 'active' || t.status === 'open' ? 'badge-active' : t.status === 'completed' ? 'badge-completed' : 'badge-pending'}`}>{t.status}</span>
                  <span className="sol-badge">{t.payout_amount} {t.payout_currency}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>ID: {t.id}</span>
                </div>
                <div className="item-card-title" style={{ marginBottom: 8 }}>{t.title}</div>
                {t.description && <div className="item-card-desc">{t.description}</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 6, background: 'rgba(8,14,28,0.6)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: 'var(--gradient-green)', borderRadius: 4, transition: 'width 0.4s' }} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{t.filled_slots}/{t.total_slots} slots filled ({available} available)</div>
                  </div>
                  <button className="btn btn-sm btn-primary" onClick={() => publish(t.id)} disabled={!channelId}>Publish</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create form */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Create Bulk Task</div>
        </div>
        <form onSubmit={create}>
          <div className="form-row" style={{ marginBottom: 14 }}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Title</label>
              <input className="form-input" value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} placeholder="Task title" required />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label className="form-label">Description</label>
            <textarea className="form-textarea" value={description} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)} placeholder="Brief description of the task" required />
          </div>
          <div className="form-row" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Payout Amount</label>
              <input className="form-input" value={payoutAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayoutAmount(e.target.value)} placeholder="0.5" type="number" step="any" required />
            </div>
            <div className="form-group">
              <label className="form-label">Currency</label>
              <select className="form-select" value={payoutCurrency} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPayoutCurrency(e.target.value as 'SOL' | 'USD')}>
                <option value="SOL">SOL</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Total Slots</label>
              <input className="form-input" value={totalSlots} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTotalSlots(e.target.value)} placeholder="10" type="number" required />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={!channelId}>Create</button>
        </form>
      </div>
    </div>
  )
}
