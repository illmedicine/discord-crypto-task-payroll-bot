import React, { useEffect, useMemo, useState } from 'react'
import VoteEventRow from '../components/VoteEventRow'
import { FixedSizeList as List } from 'react-window'
import { api } from '../api'

type VoteEvent = {
  id: number
  title: string
  prize_amount: number
  currency: string
  status: string
}

type Channel = { id: string, name: string }

type Props = {
  guildId: string
}

export default function VoteEvents({ guildId }: Props) {
  const [events, setEvents] = useState<VoteEvent[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)

  const [channelId, setChannelId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [prizeAmount, setPrizeAmount] = useState('')
  const [currency, setCurrency] = useState('SOL')
  const [minParticipants, setMinParticipants] = useState('')
  const [maxParticipants, setMaxParticipants] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('')

  const [imageUrlsRaw, setImageUrlsRaw] = useState('')

  const imageUrls = useMemo(() => {
    return imageUrlsRaw
      .split('\n')
      .map((s: string) => s.trim())
      .filter(Boolean)
  }, [imageUrlsRaw])

  const load = async () => {
    if (!guildId) return
    setLoading(true)
    try {
      const [evRes, chRes] = await Promise.all([
        api.get(`/admin/guilds/${guildId}/vote-events`),
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

  const handleCreate = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!guildId) return

    if (imageUrls.length < 2) {
      alert('Please provide at least 2 image URLs (one per line).')
      return
    }

    const images = imageUrls.map((url: string, idx: number) => ({
      id: `WEB-${Date.now()}-${idx + 1}`,
      url
    }))

    await api.post(`/admin/guilds/${guildId}/vote-events`, {
      channel_id: channelId,
      title,
      description,
      prize_amount: prizeAmount ? Number(prizeAmount) : 0,
      currency,
      min_participants: Number(minParticipants),
      max_participants: Number(maxParticipants),
      duration_minutes: durationMinutes ? Number(durationMinutes) : null,
      images,
    })

    setTitle('')
    setDescription('')
    setPrizeAmount('')
    setMinParticipants('')
    setMaxParticipants('')
    setDurationMinutes('')
    setImageUrlsRaw('')
    await load()
  }

  const publish = async (eventId: number) => {
    if (!guildId) return
    await api.post(`/admin/guilds/${guildId}/vote-events/${eventId}/publish`, { channel_id: channelId })
    await load()
  }

  return (
    <div className="container">
      <h2>Vote Events</h2>

      {!guildId ? (
        <p>Select a server (guild) above.</p>
      ) : (
        <>
          <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={load} disabled={loading}>Refresh</button>
            <div>
              <span style={{ marginRight: 8 }}>Publish Channel:</span>
              <select value={channelId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setChannelId(e.target.value)}>
                {channels.map((c: Channel) => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="table">
            <div className="table-head">
              <div className="col col-id">ID</div>
              <div className="col col-title">Title</div>
              <div className="col col-prize">Prize</div>
              <div className="col col-status">Status</div>
              <div className="col col-actions">Actions</div>
            </div>
            <List
              height={300}
              itemCount={events.length}
              itemSize={56}
              width={'100%'}
              itemKey={(index: number) => events[index].id}
            >
              {({ index, style }: { index: number, style: React.CSSProperties }) => (
                <div style={style}>
                  <VoteEventRow event={events[index]} />
                  <div style={{ paddingLeft: 8, paddingBottom: 8 }}>
                    <button onClick={() => publish(events[index].id)} disabled={!channelId}>Publish</button>
                  </div>
                </div>
              )}
            </List>
          </div>

          <h3>Create Vote Event</h3>
          <form onSubmit={handleCreate} className="mini-form">
            <input value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} placeholder="Title" required />
            <input value={description} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)} placeholder="Description" required />
            <input value={prizeAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrizeAmount(e.target.value)} placeholder="Prize Amount" type="number" />
            <select value={currency} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCurrency(e.target.value)}>
              <option value="SOL">SOL</option>
              <option value="USD">USD</option>
            </select>
            <input value={minParticipants} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMinParticipants(e.target.value)} placeholder="Min Participants" type="number" required />
            <input value={maxParticipants} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxParticipants(e.target.value)} placeholder="Max Participants" type="number" required />
            <input value={durationMinutes} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDurationMinutes(e.target.value)} placeholder="Duration (minutes)" type="number" />
            <textarea value={imageUrlsRaw} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setImageUrlsRaw(e.target.value)} placeholder="Image URLs (one per line, at least 2)" style={{ width: '100%', height: 80 }} />
            <button type="submit" disabled={!channelId}>Create</button>
          </form>
        </>
      )}
    </div>
  )
}
