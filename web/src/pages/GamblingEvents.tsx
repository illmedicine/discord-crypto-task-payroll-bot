import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import Countdown, { useTick, formatTimeAgo } from '../components/Countdown'
import GamblingEventRow from '../components/GamblingEventRow'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type GamblingEvent = {
  id: number
  title: string
  description: string
  mode: string
  prize_amount: number
  currency: string
  entry_fee: number
  min_players: number
  max_players: number
  current_players: number
  num_slots: number
  winning_slot: number | null
  status: string
  channel_id: string
  message_id: string | null
  ends_at: string | null
  created_at: string
}

type Channel = { id: string; name: string }

type SlotEntry = { label: string; color: string }

type Props = { guildId: string; isOwner?: boolean }

const DEFAULT_SLOTS: SlotEntry[] = [
  { label: '🔴 Crimson Blaze',    color: '#E74C3C' },
  { label: '⚫ Shadow Runner',    color: '#2C3E50' },
  { label: '🟢 Emerald Thunder',  color: '#27AE60' },
  { label: '🔵 Sapphire Storm',   color: '#3498DB' },
  { label: '🟡 Golden Lightning', color: '#F1C40F' },
  { label: '🟣 Violet Fury',      color: '#9B59B6' },
]

function badgeClass(status: string): string {
  switch (status) {
    case 'active':    return 'badge badge-active'
    case 'ended':     return 'badge badge-ended'
    case 'completed': return 'badge badge-completed'
    case 'cancelled': return 'badge badge-ended'
    default:          return 'badge badge-open'
  }
}

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */
export default function GamblingEvents({ guildId, isOwner = true }: Props) {
  useTick(1000)

  /* ---- data state ---- */
  const [events, setEvents] = useState<GamblingEvent[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)

  /* ---- create-form state ---- */
  const [channelId, setChannelId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<'house' | 'pot'>('house')
  const [prizeAmount, setPrizeAmount] = useState('')
  const [currency, setCurrency] = useState('SOL')
  const [entryFee, setEntryFee] = useState('')
  const [minPlayers, setMinPlayers] = useState('1')
  const [maxPlayers, setMaxPlayers] = useState('10')
  const [durationMinutes, setDurationMinutes] = useState('')
  const [numSlots, setNumSlots] = useState(6)
  const [slots, setSlots] = useState<SlotEntry[]>(DEFAULT_SLOTS.slice(0, 6))

  /* ---- publish state ---- */
  const [publishChannelId, setPublishChannelId] = useState('')
  const [publishing, setPublishing] = useState<number | null>(null)

  /* ---- expanded detail ---- */
  const [expandedId, setExpandedId] = useState<number | null>(null)

  /* ================================================================ */
  /*  Data loading                                                     */
  /* ================================================================ */
  const load = useCallback(async () => {
    if (!guildId) return
    setLoading(true)
    try {
      const [evRes, chRes] = await Promise.all([
        api.get(`/admin/guilds/${guildId}/gambling-events`),
        api.get(`/admin/guilds/${guildId}/channels`),
      ])
      setEvents(evRes.data || [])
      setChannels(chRes.data || [])
      if (!channelId && (chRes.data || []).length) {
        setChannelId(chRes.data[0].id)
        setPublishChannelId(chRes.data[0].id)
      }
    } finally {
      setLoading(false)
    }
  }, [guildId])

  useEffect(() => {
    setEvents([])
    setChannels([])
    setChannelId('')
    setPublishChannelId('')
    if (guildId) load()
  }, [guildId, load])

  /* ---- Auto-poll every 15s ---- */
  useEffect(() => {
    if (!guildId) return
    const id = setInterval(() => {
      api.get(`/admin/guilds/${guildId}/gambling-events`)
        .then(r => setEvents(r.data || []))
        .catch(() => {})
    }, 15000)
    return () => clearInterval(id)
  }, [guildId])

  /* ---- Slot management ---- */
  const handleNumSlotsChange = (n: number) => {
    const clamped = Math.max(2, Math.min(6, n))
    setNumSlots(clamped)
    setSlots(prev => {
      if (clamped > prev.length) {
        const extended = [...prev]
        for (let i = prev.length; i < clamped; i++) {
          extended.push(DEFAULT_SLOTS[i] || { label: `Slot ${i + 1}`, color: '#888' })
        }
        return extended
      }
      return prev.slice(0, clamped)
    })
  }

  const updateSlotLabel = (idx: number, label: string) => {
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, label } : s))
  }

  /* ================================================================ */
  /*  Create                                                           */
  /* ================================================================ */
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guildId || !title || slots.length < 2) {
      alert('Title and at least 2 slots are required.')
      return
    }

    await api.post(`/admin/guilds/${guildId}/gambling-events`, {
      channel_id: channelId,
      title,
      description,
      mode,
      prize_amount: mode === 'house' ? (prizeAmount ? Number(prizeAmount) : 0) : 0,
      currency,
      entry_fee: mode === 'pot' ? (entryFee ? Number(entryFee) : 0) : 0,
      min_players: Number(minPlayers) || 1,
      max_players: Number(maxPlayers) || 10,
      duration_minutes: durationMinutes ? Number(durationMinutes) : null,
      slots: slots.map(s => ({ label: s.label, color: s.color })),
    })

    setTitle('')
    setDescription('')
    setPrizeAmount('')
    setEntryFee('')
    setMinPlayers('1')
    setMaxPlayers('10')
    setDurationMinutes('')
    setNumSlots(6)
    setSlots(DEFAULT_SLOTS.slice(0, 6))
    await load()
  }

  /* ================================================================ */
  /*  Publish                                                          */
  /* ================================================================ */
  const handlePublish = async (eventId: number) => {
    if (!guildId) return
    setPublishing(eventId)
    try {
      await api.post(`/admin/guilds/${guildId}/gambling-events/${eventId}/publish`, {
        channel_id: publishChannelId || channelId,
      })
      await load()
    } catch (err: any) {
      console.error('Publish failed:', err)
      const detail = err?.response?.data?.detail || err?.message || 'Unknown error'
      alert(`Failed to publish: ${detail}`)
    } finally {
      setPublishing(null)
    }
  }

  /* ================================================================ */
  /*  Delete                                                           */
  /* ================================================================ */
  const handleDelete = async (eventId: number) => {
    if (!confirm('Delete this horse race event? This cannot be undone.')) return
    try {
      await api.delete(`/admin/guilds/${guildId}/gambling-events/${eventId}`)
      await load()
    } catch (_) {
      alert('Failed to delete event.')
    }
  }

  /* ================================================================ */
  /*  Cancel                                                           */
  /* ================================================================ */
  const handleCancel = async (eventId: number) => {
    if (!confirm('Cancel this horse race event?')) return
    try {
      await api.patch(`/admin/guilds/${guildId}/gambling-events/${eventId}/cancel`)
      await load()
    } catch (_) {
      alert('Failed to cancel event.')
    }
  }

  /* ================================================================ */
  /*  Render: empty state                                              */
  /* ================================================================ */
  if (!guildId) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state-icon">�</div>
          <div className="empty-state-text">Select a server to manage horse race events.</div>
        </div>
      </div>
    )
  }

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  return (
    <div className="container">
      <div className="section-header">
        <h2 style={{ marginBottom: 0 }}>� Horse Race Gambling</h2>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Refresh'}
        </button>
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Create horse race betting events. Riders pick a horse, the race runs with animated results, and winners earn crypto rewards instantly.
      </p>

      {/* ============================================================ */}
      {/*  Existing Events List                                         */}
      {/* ============================================================ */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">All Horse Race Events ({events.length})</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Publish to:</span>
            <select className="form-select" style={{ width: 160, fontSize: 12 }} value={publishChannelId} onChange={e => setPublishChannelId(e.target.value)}>
              {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </div>
        </div>

        {events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">�</div>
            <div className="empty-state-text">No horse race events yet. Create one below.</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Mode</th>
                <th>Prize</th>
                <th>Players</th>
                <th>Status</th>
                <th>Time Left</th>
                <th>Winner</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <React.Fragment key={ev.id}>
                  <tr>
                    <td>#{ev.id}</td>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}
                        onClick={() => setExpandedId(expandedId === ev.id ? null : ev.id)}>
                      {ev.title}
                      <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--text-secondary)' }}>
                        {expandedId === ev.id ? '▾' : '▸'}
                      </span>
                    </td>
                    <td><span style={{ fontSize: 11 }}>{ev.mode === 'pot' ? '🏦 Pot' : '🏠 House'}</span></td>
                    <td>
                      <span className="sol-badge">
                        {ev.mode === 'pot' ? `${ev.entry_fee} ${ev.currency}/bet` : `${ev.prize_amount} ${ev.currency}`}
                      </span>
                    </td>
                    <td>{ev.current_players}/{ev.max_players}</td>
                    <td><span className={badgeClass(ev.status)}>{ev.status}</span></td>
                    <td style={{ fontSize: 12 }}><Countdown endsAt={ev.ends_at} prefix='⏱️ ' endedText='—' /></td>
                    <td style={{ fontSize: 12 }}>{ev.winning_slot ? `🏆 Horse #${ev.winning_slot}` : '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {isOwner && ev.status === 'active' && !ev.message_id && (
                          <button className="btn btn-primary btn-sm"
                                  disabled={publishing === ev.id}
                                  onClick={() => handlePublish(ev.id)}>
                            {publishing === ev.id ? '...' : 'Publish'}
                          </button>
                        )}
                        {ev.message_id && (
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '4px 6px' }}>✅ Published</span>
                        )}
                        {isOwner && ev.status === 'active' && (
                          <button className="btn btn-secondary btn-sm" onClick={() => handleCancel(ev.id)} style={{ color: '#f0ad4e' }}>
                            Cancel
                          </button>
                        )}
                        {isOwner && (
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(ev.id)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* Expanded detail */}
                  {expandedId === ev.id && (
                    <tr>
                      <td colSpan={9} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                        <div style={{ padding: 16 }}>
                          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                            <div>
                              <strong style={{ fontSize: 13 }}>Description</strong>
                              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0' }}>
                                {ev.description || '(none)'}
                              </p>
                            </div>
                            <div>
                              <strong style={{ fontSize: 13 }}>Details</strong>
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                                <div>Mode: {ev.mode === 'pot' ? 'Pot Split' : 'House-funded'}</div>
                                <div>Horses: {ev.num_slots}</div>
                                <div>Min riders: {ev.min_players}</div>
                                <div>Created: {formatTimeAgo(ev.created_at)}</div>
                                {ev.winning_slot && <div style={{ color: 'var(--accent-green)', fontWeight: 600 }}>Winning Horse: #{ev.winning_slot}</div>}
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ============================================================ */}
      {/*  Create Gambling Event Form (owner only)                      */}
      {/* ============================================================ */}
      {isOwner && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Create New Horse Race Event</div>
          </div>

          <form onSubmit={handleCreate}>
            {/* Row 1: Title + Channel */}
            <div className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Title *</label>
                <input className="form-input" value={title} onChange={e => setTitle(e.target.value)}
                       placeholder="e.g. Friday Night Derby" required />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Channel *</label>
                <select className="form-select" value={channelId} onChange={e => setChannelId(e.target.value)}>
                  {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                </select>
              </div>
            </div>

            {/* Description */}
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-textarea" value={description} onChange={e => setDescription(e.target.value)}
                        placeholder="Describe the horse race event..." rows={2} />
            </div>

            {/* Row 2: Mode + Prize/Fee */}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Mode</label>
                <select className="form-select" value={mode} onChange={e => setMode(e.target.value as 'house' | 'pot')}>
                  <option value="house">🏠 House-funded (you set prize)</option>
                  <option value="pot">🏦 Pot Split (entry fees pooled)</option>
                </select>
              </div>
              {mode === 'house' ? (
                <div className="form-group">
                  <label className="form-label">Prize Pool</label>
                  <input className="form-input" type="number" step="any" min="0" value={prizeAmount}
                         onChange={e => setPrizeAmount(e.target.value)} placeholder="0" />
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">Entry Fee</label>
                  <input className="form-input" type="number" step="any" min="0" value={entryFee}
                         onChange={e => setEntryFee(e.target.value)} placeholder="0.01" />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Currency</label>
                <select className="form-select" value={currency} onChange={e => setCurrency(e.target.value)}>
                  <option value="SOL">SOL</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>

            {/* Row 3: Players + Duration */}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Min Players</label>
                <input className="form-input" type="number" min="1" value={minPlayers}
                       onChange={e => setMinPlayers(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Max Players</label>
                <input className="form-input" type="number" min="2" value={maxPlayers}
                       onChange={e => setMaxPlayers(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Duration (min)</label>
                <input className="form-input" type="number" min="1" value={durationMinutes}
                       onChange={e => setDurationMinutes(e.target.value)} placeholder="∞" />
              </div>
            </div>

            {/* Horse configuration */}
            <div className="form-group">
              <label className="form-label">Horses ({numSlots})</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input className="form-input" type="number" min="2" max="6" value={numSlots}
                       onChange={e => handleNumSlotsChange(Number(e.target.value))}
                       style={{ width: 80 }} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>2–6 horses</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {slots.map((slot, idx) => (
                  <div key={idx} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'var(--bg-secondary)', padding: '6px 10px',
                    borderRadius: 8, border: '1px solid var(--border-color)',
                    borderLeft: `4px solid ${slot.color}`,
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 16 }}>{idx + 1}.</span>
                    <input
                      className="form-input"
                      value={slot.label}
                      onChange={e => updateSlotLabel(idx, e.target.value)}
                      style={{ width: 120, fontSize: 13, padding: '4px 8px' }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Submit */}
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="submit" className="btn btn-primary"
                      disabled={slots.length < 2 || !title}>
                Create Horse Race
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {!title ? 'Enter a title' : slots.length < 2 ? 'Need at least 2 horses' : '✅ Ready'}
              </span>
            </div>
          </form>
        </div>
      )}

      {/* ============================================================ */}
      {/*  How Gambling Events Work                                     */}
      {/* ============================================================ */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <div className="card-title">How DCB Horse Race Gambling Works</div>
        </div>
        <div style={{ padding: '4px 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <p><strong>1. Create</strong> — Set up horses (names/colors), choose house-funded or pot-split mode, and set rider limits.</p>
          <p><strong>2. Publish</strong> — An interactive Discord post is sent with horse buttons for riders to bet on.</p>
          <p><strong>3. Bet</strong> — Riders click a horse button to pick their horse. One pick per rider.</p>
          <p><strong>4. Race</strong> — When all riders are in or time runs out, an animated horse race plays in Discord! 🏇</p>
          <p><strong>5. Instant Payouts</strong> — The winning horse crosses the finish line first. Riders who picked it split the prize. 💰</p>
          <p style={{ marginTop: 8 }}><strong>Modes:</strong></p>
          <p>🏠 <strong>House-funded</strong> — You set a fixed prize pool from the guild treasury.</p>
          <p>🏦 <strong>Pot Split</strong> — Each rider pays an entry fee; the pot is split among winners.</p>
        </div>
      </div>
    </div>
  )
}
