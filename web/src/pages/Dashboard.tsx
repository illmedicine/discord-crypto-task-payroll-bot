import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { api, getAuthUrl } from '../api'

type Contest = {
  id: number
  title: string
  prize_amount: number
  currency: string
  status: string
  guild_id?: string
  channel_id?: string
  message_id?: string
}

export default function Dashboard() {
  const [contests, setContests] = useState<Contest[]>([])
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<{ username: string, discriminator: string } | null>(null)

  useEffect(() => {
    setLoading(true)
    api.get('/contests')
      .then(r => setContests(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))

    // check auth
    api.get('/auth/me').then(r => setUser(r.data.user)).catch(() => setUser(null))
  }, [])

  return (
    <div className="container">
      <h2>Contests</h2>

      <div style={{ marginBottom: 12 }}>
        {user ? (
          <div>
            <span style={{ marginRight: 8 }}>Logged in as <strong>{user.username}#{user.discriminator}</strong></span>
            <button onClick={async () => { await api.post('/auth/logout'); setUser(null); }}>Logout</button>
          </div>
        ) : (
          (import.meta as any).env?.VITE_API_BASE ? (
            <a className="btn" href={getAuthUrl()}>Login with Discord</a>
          ) : (
            <button className="btn" disabled title="Requires backend URL (set VITE_API_BASE)">Login with Discord (backend required)</button>
          )
        )}
      </div>

      {loading ? <p>Loading...</p> : (
        <table>
          <thead>
            <tr><th>ID</th><th>Title</th><th>Prize</th><th>Status</th></tr>
          </thead>
          <tbody>
            {contests.map(c => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td>{c.title}</td>
                <td>{c.prize_amount} {c.currency}</td>
                <td>{c.status}</td>
                <td>
                  <button onClick={async () => {
                    await api.post(`/contests/${c.id}/process`);
                    // refresh
                    setLoading(true); api.get('/contests').then(r => setContests(r.data)).finally(() => setLoading(false));
                  }}>Process Now</button>
                  {!c.message_id && <button style={{ marginLeft:8 }} onClick={async () => {
                    // quick publish
                    await api.post('/publish', { guild_id: c.guild_id, channel_id: c.channel_id, content: `🎉 **${c.title}** has started! Prize: ${c.prize_amount} ${c.currency}` });
                    setLoading(true); api.get('/contests').then(r => setContests(r.data)).finally(() => setLoading(false));
                  }}>Publish</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Create Contest (Quick)</h3>
      <CreateContestForm onCreated={(contest: Contest) => setContests(prev => [contest, ...prev])} />
    </div>
  )
}

function CreateContestForm({ onCreated }: { onCreated: (c: Contest) => void }) {
  const [title, setTitle] = useState('')
  const [prize, setPrize] = useState('10')
  const [currency, setCurrency] = useState('USD')
  const [publishNow, setPublishNow] = useState(true)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await axios.post('/api/contests', { guild_id: 'TEST_GUILD', channel_id: 'TEST_CHANNEL', title, prize_amount: parseFloat(prize), currency, duration_hours: 1, num_winners: 1, max_entries: 100, reference_url: '', publish: publishNow })
    onCreated(res.data)
    setTitle('')
  }

  return (
    <form onSubmit={submit} className="mini-form">
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" required />
      <input value={prize} onChange={e => setPrize(e.target.value)} placeholder="Prize" required />
      <select value={currency} onChange={e => setCurrency(e.target.value)}>
        <option>USD</option>
        <option>SOL</option>
      </select>
      <label style={{ marginLeft: 8 }}><input type="checkbox" checked={publishNow} onChange={e => setPublishNow(e.target.checked)} /> Publish now</label>
      <button type="submit">Create</button>
    </form>
  )
}
