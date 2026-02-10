import React, { useEffect, useState } from 'react'
import ContestRow from '../components/ContestRow'
import { FixedSizeList as List } from 'react-window'
import { api } from '../api'

type Contest = {
  id: number
  title: string
  prize_amount: number
  currency: string
  status: string
  channel_id?: string
  message_id?: string
}

type Channel = { id: string, name: string }

type Props = {
  guildId: string
}

export default function Contests({ guildId }: Props) {
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

  return (
    <div className="container">
      <h2>Contests</h2>

      {!guildId ? (
        <p>Select a server (guild) above.</p>
      ) : (
        <>
          <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={load} disabled={loading}>Refresh</button>
            <div>
              <span style={{ marginRight: 8 }}>Publish Channel:</span>
              <select value={channelId} onChange={e => setChannelId(e.target.value)}>
                {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
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
              itemCount={contests.length}
              itemSize={56}
              width={'100%'}
              itemKey={index => contests[index].id}
            >
              {({ index, style }) => (
                <div style={style}>
                  <ContestRow contest={contests[index]} />
                  <div style={{ paddingLeft: 8, paddingBottom: 8 }}>
                    <button onClick={() => publish(contests[index].id)} disabled={!channelId}>Publish</button>
                  </div>
                </div>
              )}
            </List>
          </div>

          <h3>Create Contest</h3>
          <form onSubmit={handleCreate} className="mini-form">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" required />
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description" required />
            <input value={prizeAmount} onChange={e => setPrizeAmount(e.target.value)} placeholder="Prize Amount" type="number" required />
            <select value={currency} onChange={e => setCurrency(e.target.value)}>
              <option value="SOL">SOL</option>
              <option value="USD">USD</option>
            </select>
            <input value={numWinners} onChange={e => setNumWinners(e.target.value)} placeholder="Number of Winners" type="number" required />
            <input value={maxEntries} onChange={e => setMaxEntries(e.target.value)} placeholder="Max Entries" type="number" required />
            <input value={durationHours} onChange={e => setDurationHours(e.target.value)} placeholder="Duration (hours)" type="number" required />
            <input value={referenceUrl} onChange={e => setReferenceUrl(e.target.value)} placeholder="Reference URL" required />
            <button type="submit" disabled={!channelId}>Create</button>
          </form>
        </>
      )}
    </div>
  )
}