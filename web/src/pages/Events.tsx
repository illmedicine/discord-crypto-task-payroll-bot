import React, { useEffect, useState } from 'react'
import { api } from '../api'

type Event = {
  id: number
  title: string
  description: string
  event_type: string
  prize_amount: number
  currency: string
  max_participants: number | null
  current_participants: number
  status: string
  starts_at: string | null
  ends_at: string | null
  created_at: string
}

type Channel = { id: string; name: string }

type Props = {
  guildId: string
}

function badgeClass(status: string): string {
  switch (status) {
    case 'active': return 'badge badge-active'
    case 'scheduled': return 'badge badge-scheduled'
    case 'completed': return 'badge badge-completed'
    case 'cancelled': return 'badge badge-ended'
    default: return 'badge badge-open'
  }
}

export default function Events({ guildId }: Props) {
  const [events, setEvents] = useState<Event[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)

  // Form state
  const [channelId, setChannelId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [eventType, setEventType] = useState('general')
  const [prizeAmount, setPrizeAmount] = useState('')
  const [currency, setCurrency] = useState('SOL')
  const [maxParticipants, setMaxParticipants] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')

  const load = async () => {
    if (!guildId) return
    setLoading(true)
    try {
      const [evRes, chRes] = await Promise.all([
        api.get(`/admin/guilds/${guildId}/events`),
        api.get(`/admin/guilds/${guildId}/channels`),
      ])
      setEvents(evRes.data || [])
      setChannels(chRes.data || [])
      if (!channelId && (chRes.data || []).length) setChannelId(chRes.data[0].id)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setEvents([])
    setChannels([])
    setChannelId('')
    if (guildId) load()
  }, [guildId])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guildId || !title) return

    await api.post(`/admin/guilds/${guildId}/events`, {
      channel_id: channelId || undefined,
      title,
      description,
      event_type: eventType,
      prize_amount: prizeAmount ? Number(prizeAmount) : 0,
      currency,
      max_participants: maxParticipants ? Number(maxParticipants) : null,
      starts_at: startsAt || null,
      ends_at: endsAt || null,
    })

    setTitle('')
    setDescription('')
    setPrizeAmount('')
    setMaxParticipants('')
    setStartsAt('')
    setEndsAt('')
    await load()
  }

  const updateStatus = async (eventId: number, status: string) => {
    await api.patch(`/admin/guilds/${guildId}/events/${eventId}/status`, { status })
    await load()
  }

  const deleteEvent = async (eventId: number) => {
    if (!confirm('Delete this event?')) return
    await api.delete(`/admin/guilds/${guildId}/events/${eventId}`)
    await load()
  }

  if (!guildId) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state-icon">📅</div>
          <div className="empty-state-text">Select a server to manage events.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <div className="section-header">
        <h2 style={{ marginBottom: 0 }}>Events</h2>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Refresh'}
        </button>
      </div>

      {/* Events List */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">All Events ({events.length})</div>
        </div>

        {events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📅</div>
            <div className="empty-state-text">No events created yet. Create one below.</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Type</th>
                <th>Prize</th>
                <th>Participants</th>
                <th>Status</th>
                <th>Ends</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <tr key={ev.id}>
                  <td>#{ev.id}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{ev.title}</td>
                  <td>{ev.event_type}</td>
                  <td><span className="sol-badge">{ev.prize_amount} {ev.currency}</span></td>
                  <td>{ev.current_participants}{ev.max_participants ? `/${ev.max_participants}` : ''}</td>
                  <td><span className={badgeClass(ev.status)}>{ev.status}</span></td>
                  <td style={{ fontSize: 12 }}>{ev.ends_at ? new Date(ev.ends_at).toLocaleDateString() : '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {ev.status === 'scheduled' && (
                        <button className="btn btn-success btn-sm" onClick={() => updateStatus(ev.id, 'active')}>
                          Start
                        </button>
                      )}
                      {ev.status === 'active' && (
                        <button className="btn btn-sm btn-secondary" onClick={() => updateStatus(ev.id, 'completed')}>
                          End
                        </button>
                      )}
                      <button className="btn btn-danger btn-sm" onClick={() => deleteEvent(ev.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Event Form */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Schedule New Event</div>
        </div>
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Title *</label>
              <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" required />
            </div>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-select" value={eventType} onChange={e => setEventType(e.target.value)}>
                <option value="general">General</option>
                <option value="meetup">Meetup</option>
                <option value="workshop">Workshop</option>
                <option value="ama">AMA</option>
                <option value="giveaway">Giveaway</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Channel</label>
              <select className="form-select" value={channelId} onChange={e => setChannelId(e.target.value)}>
                <option value="">None</option>
                {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="form-textarea" value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the event..." />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Prize Amount</label>
              <input className="form-input" type="number" value={prizeAmount} onChange={e => setPrizeAmount(e.target.value)} placeholder="0" step="any" />
            </div>
            <div className="form-group">
              <label className="form-label">Currency</label>
              <select className="form-select" value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="SOL">SOL</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Max Participants</label>
              <input className="form-input" type="number" value={maxParticipants} onChange={e => setMaxParticipants(e.target.value)} placeholder="Unlimited" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Starts At</label>
              <input className="form-input" type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Ends At</label>
              <input className="form-input" type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} />
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            <button type="submit" className="btn btn-primary">Create Event</button>
          </div>
        </form>
      </div>
    </div>
  )
}
