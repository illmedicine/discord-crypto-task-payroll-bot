import React, { useEffect, useState } from 'react'
import axios from 'axios'

type Post = { id: number, content: string, scheduled_at: string, status: string }

export default function ScheduledPosts() {
  const [posts, setPosts] = useState<Post[]>([])
  const [guildId, setGuildId] = useState('TEST_GUILD')
  const [channelId, setChannelId] = useState('TEST_CHANNEL')
  const [content, setContent] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')

  useEffect(() => { load(); }, [])

  const load = async () => {
    const res = await axios.get('/api/scheduled-posts', { params: { guild_id: guildId } })
    setPosts(res.data || [])
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await axios.post('/api/scheduled-posts', { guild_id: guildId, channel_id: channelId, content, scheduled_at: scheduledAt });
    setContent(''); setScheduledAt(''); load();
  }

  return (
    <div className="container">
      <h2>Scheduled Posts</h2>
      <form className="mini-form" onSubmit={create}>
        <input placeholder="Guild ID" value={guildId} onChange={e => setGuildId(e.target.value)} />
        <input placeholder="Channel ID" value={channelId} onChange={e => setChannelId(e.target.value)} />
        <input placeholder="Content" value={content} onChange={e => setContent(e.target.value)} />
        <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
        <button type="submit">Schedule</button>
      </form>

      <table>
        <thead><tr><th>ID</th><th>Content</th><th>Time</th><th>Status</th></tr></thead>
        <tbody>
          {posts.map(p => (
            <tr key={p.id}><td>{p.id}</td><td>{p.content}</td><td>{p.scheduled_at}</td><td>{p.status}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
