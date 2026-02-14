import React, { useEffect, useState } from 'react'
import { api } from '../api'

type Task = {
  id: number
  guild_id: string
  recipient_address: string
  amount: number
  status: string
}

type Props = {
  guildId: string
}

export default function Tasks({ guildId }: Props) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [addr, setAddr] = useState('')
  const [amount, setAmount] = useState('1')

  useEffect(() => {
    if (!guildId) {
      setTasks([])
      return
    }
    setLoading(true)
    api.get(`/admin/guilds/${guildId}/tasks`).then(r => setTasks(r.data)).finally(() => setLoading(false))
  }, [guildId])

  const handleExecute = async (id: number) => {
    await api.post(`/admin/guilds/${guildId}/tasks/${id}/execute`)
    setLoading(true)
    api.get(`/admin/guilds/${guildId}/tasks`).then(r => setTasks(r.data)).finally(() => setLoading(false))
  }

  return (
    <div className="container">
      <div className="section-header">
        <h2 style={{ marginBottom: 0 }}>Tasks</h2>
        <span className="badge badge-open" style={{ fontSize: 13, padding: '5px 14px' }}>{tasks.length} total</span>
      </div>

      {loading ? (
        <div className="loading-state"><span className="spinner" /> Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-text">No tasks created yet. Use the form below to create one.</div>
          </div>
        </div>
      ) : (
        <div className="item-cards" style={{ marginBottom: 28 }}>
          {tasks.map(t => (
            <div key={t.id} className="item-card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: '0 0 auto', width: 40, height: 40, borderRadius: 'var(--radius-sm)', background: 'rgba(99,140,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: 'var(--accent-blue)' }}>
                #{t.id}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                  {t.recipient_address ? `${t.recipient_address.slice(0, 8)}...${t.recipient_address.slice(-6)}` : 'No recipient'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Payout: {t.amount} SOL
                </div>
              </div>
              <span className={`badge ${t.status === 'completed' ? 'badge-completed' : t.status === 'pending' ? 'badge-pending' : 'badge-open'}`}>
                {t.status}
              </span>
              <button className="btn btn-sm btn-primary" onClick={() => handleExecute(t.id)} disabled={t.status === 'completed'}>
                Execute
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-title">Create Task</div>
        </div>
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (!guildId) return
          const res = await api.post(`/admin/guilds/${guildId}/tasks`, { recipient_address: addr, amount: parseFloat(amount) });
          setTasks(prev => [res.data, ...prev]); setAddr(''); setAmount('1');
        }}>
          <div className="form-row" style={{ marginBottom: 16 }}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Recipient Solana Address</label>
              <input className="form-input" placeholder="e.g. 9WzDX..." value={addr} onChange={e => setAddr(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Amount (SOL)</label>
              <input className="form-input" placeholder="1" value={amount} onChange={e => setAmount(e.target.value)} required type="number" step="any" />
            </div>
          </div>
          <button type="submit" className="btn btn-primary">Create Task</button>
        </form>
      </div>
    </div>
  )
}
