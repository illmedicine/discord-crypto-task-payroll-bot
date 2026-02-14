import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type VoteEvent = {
  id: number
  title: string
  description: string
  prize_amount: number
  currency: string
  min_participants: number
  max_participants: number
  current_participants: number
  owner_favorite_image_id: string | null
  status: string
  channel_id: string
  message_id: string | null
  qualification_url: string | null
  ends_at: string | null
  created_at: string
}

type Channel = { id: string; name: string }

type DiscordMedia = {
  id: string
  url: string
  proxyURL: string
  name: string
  width?: number
  height?: number
  messageId: string
  authorTag: string
  postedAt: string
}

type ImageEntry = {
  id: string
  url: string
  source: 'upload' | 'discord' | 'url'
  name?: string
}

type Qualification = {
  id: number
  vote_event_id: number
  user_id: string
  username: string
  screenshot_url: string
  status: string
  submitted_at: string
  reviewed_at: string | null
  reviewed_by: string | null
}

type Props = { guildId: string }

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function badgeClass(status: string): string {
  switch (status) {
    case 'active':    return 'badge badge-active'
    case 'ended':     return 'badge badge-ended'
    case 'completed': return 'badge badge-completed'
    case 'cancelled': return 'badge badge-ended'
    default:          return 'badge badge-open'
  }
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */
export default function Events({ guildId }: Props) {
  /* ---- data state ---- */
  const [events, setEvents] = useState<VoteEvent[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)

  /* ---- create-form state ---- */
  const [channelId, setChannelId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [prizeAmount, setPrizeAmount] = useState('')
  const [currency, setCurrency] = useState('SOL')
  const [minParticipants, setMinParticipants] = useState('2')
  const [maxParticipants, setMaxParticipants] = useState('10')
  const [durationMinutes, setDurationMinutes] = useState('')
  const [qualificationUrl, setQualificationUrl] = useState('')
  const [images, setImages] = useState<ImageEntry[]>([])
  const [favoriteIdx, setFavoriteIdx] = useState<number | null>(null)

  /* ---- media picker state ---- */
  const [mediaChannelId, setMediaChannelId] = useState('')
  const [discordMedia, setDiscordMedia] = useState<DiscordMedia[]>([])
  const [mediaLoading, setMediaLoading] = useState(false)
  const [showMediaPicker, setShowMediaPicker] = useState(false)

  /* ---- upload state ---- */
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /* ---- expanded event detail ---- */
  const [expandedId, setExpandedId] = useState<number | null>(null)

  /* ---- publishing state ---- */
  const [publishChannelId, setPublishChannelId] = useState('')
  const [publishing, setPublishing] = useState<number | null>(null)

  /* ---- qualification review state ---- */
  const [qualifications, setQualifications] = useState<Qualification[]>([])
  const [qualLoading, setQualLoading] = useState(false)
  const [reviewingId, setReviewingId] = useState<number | null>(null)

  /* ================================================================ */
  /*  Data loading                                                     */
  /* ================================================================ */
  const load = useCallback(async () => {
    if (!guildId) return
    setLoading(true)
    try {
      const [evRes, chRes] = await Promise.all([
        api.get(`/admin/guilds/${guildId}/vote-events`),
        api.get(`/admin/guilds/${guildId}/channels`),
      ])
      setEvents(evRes.data || [])
      setChannels(chRes.data || [])
      if (!channelId && (chRes.data || []).length) {
        setChannelId(chRes.data[0].id)
        setMediaChannelId(chRes.data[0].id)
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
    setMediaChannelId('')
    setPublishChannelId('')
    if (guildId) load()
  }, [guildId, load])

  /* ================================================================ */
  /*  Discord media picker                                             */
  /* ================================================================ */
  const loadMedia = async () => {
    if (!guildId || !mediaChannelId) return
    setMediaLoading(true)
    try {
      const res = await api.get(`/admin/guilds/${guildId}/channels/${mediaChannelId}/media?limit=50`)
      setDiscordMedia(res.data || [])
    } catch (err) {
      console.error('Failed to load media:', err)
      setDiscordMedia([])
    } finally {
      setMediaLoading(false)
    }
  }

  const pickMedia = (m: DiscordMedia) => {
    if (images.some(i => i.id === m.id)) return
    if (images.length >= 5) return
    setImages(prev => [...prev, { id: m.id, url: m.url, source: 'discord', name: m.name }])
  }

  /* ================================================================ */
  /*  File upload                                                      */
  /* ================================================================ */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || !channelId || !guildId) return
    setUploading(true)
    try {
      for (let i = 0; i < files.length; i++) {
        if (images.length + i >= 5) break
        const file = files[i]
        if (!file.type.startsWith('image/')) continue
        const fd = new FormData()
        fd.append('image', file)
        fd.append('caption', `📸 Event image: ${file.name}`)
        const res = await api.post(`/admin/guilds/${guildId}/channels/${channelId}/upload`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        const data = res.data
        setImages(prev => [...prev, { id: data.id, url: data.url, source: 'upload', name: file.name }])
      }
    } catch (err) {
      console.error('Upload failed:', err)
      alert('Image upload failed. Make sure a channel is selected.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  /* ================================================================ */
  /*  Remove image                                                     */
  /* ================================================================ */
  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx))
    if (favoriteIdx === idx) setFavoriteIdx(null)
    else if (favoriteIdx !== null && favoriteIdx > idx) setFavoriteIdx(favoriteIdx - 1)
  }

  /* ================================================================ */
  /*  Create vote event                                                */
  /* ================================================================ */
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guildId || !title || images.length < 2) {
      alert('Title and at least 2 images are required.')
      return
    }
    if (favoriteIdx === null) {
      alert('Please select your winning image (click the star on one image).')
      return
    }

    const imgPayload = images.map((img, idx) => ({
      id: img.id || `WEB-${Date.now()}-${idx + 1}`,
      url: img.url,
    }))

    await api.post(`/admin/guilds/${guildId}/vote-events`, {
      channel_id: channelId,
      title,
      description,
      prize_amount: prizeAmount ? Number(prizeAmount) : 0,
      currency,
      min_participants: Number(minParticipants) || 2,
      max_participants: Number(maxParticipants) || 10,
      duration_minutes: durationMinutes ? Number(durationMinutes) : null,
      owner_favorite_image_id: imgPayload[favoriteIdx]?.id || null,
      images: imgPayload,
      qualification_url: qualificationUrl || null,
    })

    setTitle('')
    setDescription('')
    setPrizeAmount('')
    setMinParticipants('2')
    setMaxParticipants('10')
    setDurationMinutes('')
    setQualificationUrl('')
    setImages([])
    setFavoriteIdx(null)
    await load()
  }

  /* ================================================================ */
  /*  Publish                                                          */
  /* ================================================================ */
  const handlePublish = async (eventId: number) => {
    if (!guildId) return
    setPublishing(eventId)
    try {
      await api.post(`/admin/guilds/${guildId}/vote-events/${eventId}/publish`, {
        channel_id: publishChannelId || channelId,
      })
      await load()
    } catch (err) {
      console.error('Publish failed:', err)
      alert('Failed to publish. Check channel permissions.')
    } finally {
      setPublishing(null)
    }
  }

  /* ================================================================ */
  /*  Delete                                                           */
  /* ================================================================ */
  const handleDelete = async (eventId: number) => {
    if (!confirm('Delete this vote event? This cannot be undone.')) return
    try {
      await api.delete(`/admin/guilds/${guildId}/vote-events/${eventId}`)
      await load()
    } catch (_) {
      alert('Failed to delete event.')
    }
  }

  /* ================================================================ */
  /*  Qualification management                                         */
  /* ================================================================ */
  const loadQualifications = async (eventId: number) => {
    if (!guildId) return
    setQualLoading(true)
    try {
      const res = await api.get(`/admin/guilds/${guildId}/vote-events/${eventId}/qualifications`)
      setQualifications(res.data || [])
    } catch (_) {
      setQualifications([])
    } finally {
      setQualLoading(false)
    }
  }

  const handleReview = async (qualId: number, status: 'approved' | 'rejected') => {
    if (!guildId) return
    setReviewingId(qualId)
    try {
      await api.patch(`/admin/guilds/${guildId}/qualifications/${qualId}/review`, { status })
      // Reload qualifications for the expanded event
      if (expandedId) await loadQualifications(expandedId)
    } catch (_) {
      alert('Failed to review qualification.')
    } finally {
      setReviewingId(null)
    }
  }

  // Load qualifications when an event is expanded
  useEffect(() => {
    if (expandedId && guildId) {
      const ev = events.find(e => e.id === expandedId)
      if (ev?.qualification_url) loadQualifications(expandedId)
      else setQualifications([])
    } else {
      setQualifications([])
    }
  }, [expandedId, guildId])

  const getQualifyLink = (eventId: number) => {
    const base = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : ''
    return `${base}#qualify-${eventId}`
  }

  /* ================================================================ */
  /*  Render: empty state                                              */
  /* ================================================================ */
  if (!guildId) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state-icon">🗳️</div>
          <div className="empty-state-text">Select a server to manage vote events.</div>
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
        <h2 style={{ marginBottom: 0 }}>🗳️ Vote Events</h2>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Refresh'}
        </button>
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Create photo-based voting challenges. Participants earn crypto rewards for correctly predicting the owner-selected winning photo.
      </p>

      {/* ============================================================ */}
      {/*  Existing Events List                                         */}
      {/* ============================================================ */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">All Vote Events ({events.length})</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Publish to:</span>
            <select className="form-select" style={{ width: 160, fontSize: 12 }} value={publishChannelId} onChange={e => setPublishChannelId(e.target.value)}>
              {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </div>
        </div>

        {events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🗳️</div>
            <div className="empty-state-text">No vote events yet. Create one below.</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Prize</th>
                <th>Participants</th>
                <th>Status</th>
                <th>Created</th>
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
                    {ev.qualification_url && <span style={{ fontSize: 10, marginLeft: 4, color: 'var(--accent-purple)' }}>🔗</span>}
                    <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--text-secondary)' }}>
                      {expandedId === ev.id ? '▾' : '▸'}
                    </span>
                  </td>
                  <td><span className="sol-badge">{ev.prize_amount} {ev.currency}</span></td>
                  <td>{ev.current_participants}/{ev.max_participants}</td>
                  <td><span className={badgeClass(ev.status)}>{ev.status}</span></td>
                  <td style={{ fontSize: 12 }}>{timeAgo(ev.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {ev.status === 'active' && !ev.message_id && (
                        <button className="btn btn-primary btn-sm"
                                disabled={publishing === ev.id}
                                onClick={() => handlePublish(ev.id)}>
                          {publishing === ev.id ? '...' : 'Publish'}
                        </button>
                      )}
                      {ev.message_id && (
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '4px 6px' }}>✅ Published</span>
                      )}
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(ev.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                {/* Expanded detail row with qualification review */}
                {expandedId === ev.id && (
                  <tr>
                    <td colSpan={7} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                      <div style={{ padding: 16 }}>
                        {/* Qualification info */}
                        {ev.qualification_url ? (
                          <div style={{ marginBottom: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                              <strong style={{ fontSize: 14 }}>🔗 Qualification Required</strong>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                  const link = getQualifyLink(ev.id)
                                  navigator.clipboard?.writeText(link)
                                  alert('Qualification link copied!\n\n' + link)
                                }}
                              >
                                📋 Copy Link
                              </button>
                            </div>
                            <div style={{
                              background: 'var(--bg-tertiary)', borderRadius: 8, padding: '8px 12px',
                              fontSize: 12, wordBreak: 'break-all', color: 'var(--text-primary)',
                              border: '1px solid var(--border-color)', marginBottom: 12,
                            }}>
                              URL: {ev.qualification_url}
                            </div>

                            {/* Qualification submissions table */}
                            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                              📸 Qualification Submissions ({qualifications.length})
                              <button className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }}
                                      onClick={() => loadQualifications(ev.id)} disabled={qualLoading}>
                                {qualLoading ? <span className="spinner" /> : '🔄'}
                              </button>
                            </div>
                            {qualifications.length === 0 ? (
                              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No qualifications submitted yet.</p>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {qualifications.map(q => (
                                  <div key={q.id} className="item-card" style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    padding: '10px 14px', margin: 0,
                                  }}>
                                    <img src={q.screenshot_url} alt="proof"
                                         style={{ width: 56, height: 56, borderRadius: 6, objectFit: 'cover', cursor: 'pointer', border: '2px solid var(--border-color)' }}
                                         onClick={() => window.open(q.screenshot_url, '_blank')} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{q.username || q.user_id}</div>
                                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                        Submitted {new Date(q.submitted_at).toLocaleString()}
                                      </div>
                                    </div>
                                    <span className={`badge ${q.status === 'approved' ? 'badge-completed' : q.status === 'rejected' ? 'badge-ended' : 'badge-open'}`}>
                                      {q.status}
                                    </span>
                                    {q.status === 'pending' && (
                                      <div style={{ display: 'flex', gap: 4 }}>
                                        <button className="btn btn-primary btn-sm"
                                                disabled={reviewingId === q.id}
                                                onClick={() => handleReview(q.id, 'approved')}>
                                          ✅
                                        </button>
                                        <button className="btn btn-danger btn-sm"
                                                disabled={reviewingId === q.id}
                                                onClick={() => handleReview(q.id, 'rejected')}>
                                          ❌
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            No qualification required for this event. Participants can join directly on Discord.
                          </p>
                        )}
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
      {/*  Create Vote Event Form                                       */}
      {/* ============================================================ */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Create New Vote Event</div>
        </div>

        <form onSubmit={handleCreate}>
          {/* Row 1: Title + Channel */}
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Title *</label>
              <input className="form-input" value={title} onChange={e => setTitle(e.target.value)}
                     placeholder="e.g. Best Meme of the Week" required />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Channel *</label>
              <select className="form-select" value={channelId} onChange={e => { setChannelId(e.target.value); setMediaChannelId(e.target.value) }}>
                {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
          </div>

          {/* Description */}
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="form-textarea" value={description} onChange={e => setDescription(e.target.value)}
                      placeholder="Describe the voting challenge..." rows={2} />
          </div>

          {/* Row 2: Prize, Currency, Min, Max, Duration */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Prize Pool</label>
              <input className="form-input" type="number" step="any" min="0" value={prizeAmount}
                     onChange={e => setPrizeAmount(e.target.value)} placeholder="0" />
            </div>
            <div className="form-group">
              <label className="form-label">Currency</label>
              <select className="form-select" value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="SOL">SOL</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Min Seats</label>
              <input className="form-input" type="number" min="2" value={minParticipants}
                     onChange={e => setMinParticipants(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Max Seats</label>
              <input className="form-input" type="number" min="2" value={maxParticipants}
                     onChange={e => setMaxParticipants(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Duration (min)</label>
              <input className="form-input" type="number" min="1" value={durationMinutes}
                     onChange={e => setDurationMinutes(e.target.value)} placeholder="∞" />
            </div>
          </div>

          {/* Qualification URL */}
          <div className="form-group">
            <label className="form-label">Qualification URL (optional)</label>
            <input className="form-input" type="url" value={qualificationUrl}
                   onChange={e => setQualificationUrl(e.target.value)}
                   placeholder="https://example.com/page-to-visit" />
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              If set, participants must visit this URL and submit a screenshot proof before they can join the event.
            </p>
          </div>

          {/* ======================================================== */}
          {/*  Image selection area                                      */}
          {/* ======================================================== */}
          <div className="form-group">
            <label className="form-label">Images * (min 2, max 5)</label>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 8px' }}>
              Upload from your PC or pick images already posted in the selected Discord channel. Click the ⭐ to mark your secret winning pick.
            </p>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={uploading || images.length >= 5}
                      onClick={() => fileInputRef.current?.click()}>
                {uploading ? 'Uploading...' : '📤 Upload from PC'}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                     onChange={handleFileUpload} />
              <button type="button" className="btn btn-secondary btn-sm" disabled={images.length >= 5}
                      onClick={() => { setShowMediaPicker(!showMediaPicker); if (!showMediaPicker) loadMedia() }}>
                {showMediaPicker ? '✕ Close Picker' : '🖼️ Pick from Discord'}
              </button>
            </div>

            {/* Discord Media Picker */}
            {showMediaPicker && (
              <div className="card" style={{ marginBottom: 12, padding: 12, background: 'var(--bg-secondary)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Discord Channel Media</span>
                  <select className="form-select" style={{ width: 180, fontSize: 12 }}
                          value={mediaChannelId} onChange={e => { setMediaChannelId(e.target.value) }}>
                    {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                  </select>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={loadMedia} disabled={mediaLoading}>
                    {mediaLoading ? <span className="spinner" /> : '🔄 Load'}
                  </button>
                </div>

                {discordMedia.length === 0 && !mediaLoading && (
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No images found in this channel. Post images there first, then click Load.</p>
                )}

                <div className="ve-media-grid">
                  {discordMedia.map(m => {
                    const alreadyPicked = images.some(i => i.id === m.id)
                    return (
                      <div key={m.id} className={`ve-media-thumb ${alreadyPicked ? 've-media-picked' : ''}`}
                           onClick={() => !alreadyPicked && pickMedia(m)}
                           title={`${m.name}\nBy: ${m.authorTag}\n${m.postedAt ? new Date(m.postedAt).toLocaleString() : ''}`}>
                        <img src={m.proxyURL || m.url} alt={m.name} loading="lazy" />
                        {alreadyPicked && <div className="ve-media-check">✓</div>}
                        <div className="ve-media-label">ID: {m.id.slice(0, 8)}…</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Selected images preview with star-to-nominate-winner */}
            {images.length > 0 && (
              <div className="ve-selected-images">
                {images.map((img, idx) => (
                  <div key={img.id} className={`ve-img-card ${favoriteIdx === idx ? 've-img-winner' : ''}`}>
                    <img src={img.url} alt={`Image ${idx + 1}`} className="ve-img-preview" />
                    <div className="ve-img-overlay">
                      <span className="ve-img-num">#{idx + 1}</span>
                      <div className="ve-img-actions">
                        <button type="button" className={`ve-star-btn ${favoriteIdx === idx ? 'active' : ''}`}
                                onClick={() => setFavoriteIdx(favoriteIdx === idx ? null : idx)}
                                title="Set as winning image (private)">
                          {favoriteIdx === idx ? '⭐' : '☆'}
                        </button>
                        <button type="button" className="ve-remove-btn" onClick={() => removeImage(idx)} title="Remove image">
                          ✕
                        </button>
                      </div>
                    </div>
                    <div className="ve-img-meta">
                      <span className={`ve-img-source ${img.source}`}>
                        {img.source === 'upload' ? '📤 Uploaded' : img.source === 'discord' ? '🖼️ Discord' : '🔗 URL'}
                      </span>
                      {favoriteIdx === idx && <span className="ve-winner-badge">🏆 Winner Pick</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {favoriteIdx === null && images.length >= 2 && (
              <p style={{ fontSize: 12, color: '#e67e22', marginTop: 4 }}>⚠️ Click the ⭐ on one image to set it as your secret winning pick.</p>
            )}
          </div>

          {/* Submit */}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="submit" className="btn btn-primary"
                    disabled={images.length < 2 || favoriteIdx === null || !title}>
              Create Vote Event
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {images.length < 2 ? `Need ${2 - images.length} more image(s)` : favoriteIdx === null ? 'Select a winner' : '✅ Ready'}
            </span>
          </div>
        </form>
      </div>

      {/* ============================================================ */}
      {/*  How DCB Events Work                                          */}
      {/* ============================================================ */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <div className="card-title">How DCB Vote Events Work</div>
        </div>
        <div style={{ padding: '4px 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <p><strong>1. Create</strong> — Upload images, set a prize pool, and secretly nominate your winning image.</p>
          <p><strong>2. Publish</strong> — An interactive Discord post is sent with image thumbnails and vote buttons.</p>
          <p><strong>3. Participate</strong> — Members click <em>Join Event</em> then vote for their favorite image by clicking its button.</p>
          <p><strong>4. Auto-start</strong> — Once all seats fill, voting locks automatically.</p>
          <p><strong>5. Instant Payouts</strong> — Winners who matched your pick get paid from the treasury. No delays. 💰</p>
        </div>
      </div>
    </div>
  )
}
