import React, { useEffect, useState } from 'react'
import axios from 'axios'

type VoteEvent = {
  id: number
  title: string
  prize_amount: number
  currency: string
  status: string
}

export default function VoteEvents() {
  const [events, setEvents] = useState<VoteEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')

  useEffect(() => {
    setLoading(true)
    axios.get('/api/vote-events').then(r => setEvents(r.data)).finally(() => setLoading(false))
  }, [])

  return (
    <div className="container">
      <h2>Vote Events</h2>
      {loading ? <p>Loading...</p> : (
        <table>
          <thead>
            <tr><th>ID</th><th>Title</th><th>Prize</th><th>Status</th></tr>
          </thead>
          <tbody>
            {events.map(e => (
              <tr key={e.id}>
                <td>{e.id}</td>
                <td>{e.title}</td>
                <td>{e.prize_amount} {e.currency}</td>
                <td>{e.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Create Vote Event</h3>
      <form onSubmit={async (ev) => { ev.preventDefault(); const res = await axios.post('/api/vote-events', { guild_id: 'TEST_GUILD', channel_id: 'TEST_CHANNEL', title, prize_amount: 0, currency: 'USD', min_participants: 2, max_participants: 10, duration_minutes: 60 }); setEvents(prev => [res.data, ...prev]); setTitle(''); }} className="mini-form">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" required />
        <button type="submit">Create</button>
      </form>
    </div>
  )
}
