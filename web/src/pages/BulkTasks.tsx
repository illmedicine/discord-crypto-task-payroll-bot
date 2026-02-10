import React, { useEffect, useState } from 'react'
import { FixedSizeList as List } from 'react-window'
import { api } from '../api'

type BulkTask = {
  id: number
  title: string
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

  return (
    <div className="container">
      <h2>Bulk Tasks</h2>

      {!guildId ? (
        <p>Select a server (guild) above.</p>
      ) : (
        <>
          <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={load} disabled={loading}>Refresh</button>
            <div>
              <span style={{ marginRight: 8 }}>Publish Channel:</span>
              <select value={channelId} onChange={(ev: React.ChangeEvent<HTMLSelectElement>) => setChannelId(ev.target.value)}>
                {channels.map((c: Channel) => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="table">
            <div className="table-head">
              <div className="col col-id">ID</div>
              <div className="col col-title">Title</div>
              <div className="col col-prize">Payout</div>
              <div className="col col-status">Status</div>
              <div className="col col-actions">Actions</div>
            </div>
            <List
              height={300}
              itemCount={tasks.length}
              itemSize={72}
              width={'100%'}
              itemKey={(index: number) => tasks[index].id}
            >
              {({ index, style }: { index: number, style: React.CSSProperties }) => {
                const t = tasks[index]
                const available = Number(t.total_slots) - Number(t.filled_slots)
                return (
                  <div style={style} className="table-row">
                    <div className="col col-id">{t.id}</div>
                    <div className="col col-title">{t.title}</div>
                    <div className="col col-prize">{t.payout_amount} {t.payout_currency} ({available}/{t.total_slots})</div>
                    <div className="col col-status">{t.status}</div>
                    <div className="col col-actions">
                      <button onClick={() => publish(t.id)} disabled={!channelId}>Publish</button>
                    </div>
                  </div>
                )
              }}
            </List>
          </div>

          <h3>Create Bulk Task</h3>
          <form onSubmit={create} className="mini-form">
            <input value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} placeholder="Title" required />
            <input value={description} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)} placeholder="Description" required />
            <input value={payoutAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayoutAmount(e.target.value)} placeholder="Payout Amount" type="number" required />
            <select value={payoutCurrency} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPayoutCurrency(e.target.value as 'SOL' | 'USD')}>
              <option value="SOL">SOL</option>
              <option value="USD">USD</option>
            </select>
            <input value={totalSlots} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTotalSlots(e.target.value)} placeholder="Total Slots" type="number" required />
            <button type="submit" disabled={!channelId}>Create</button>
          </form>
        </>
      )}
    </div>
  )
}
