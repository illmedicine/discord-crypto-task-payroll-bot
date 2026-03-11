import React, { useEffect, useState, useCallback } from 'react'
import api from '../api'

interface Track {
  title: string
  url: string
  duration: string
  requestedBy: string | null
}

interface MusicState {
  playing: boolean
  paused: boolean
  current: Track | null
  queue: Track[]
  loop: boolean
}

export default function ServerMusic({ guildId }: { guildId: string }) {
  const [state, setState] = useState<MusicState>({ playing: false, paused: false, current: null, queue: [], loop: false })
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [botConnected, setBotConnected] = useState<boolean | null>(null)
  const [botError, setBotError] = useState('')

  const fetchState = useCallback(async () => {
    if (!guildId) return
    try {
      const res = await api.get(`/music/state/${guildId}`)
      setState(res.data)
      setBotConnected(true)
      setBotError('')
    } catch (err: any) {
      const status = err?.response?.status
      const msg = err?.response?.data?.error || ''
      if (status === 502 || status === 503 || status === 504) {
        setBotConnected(false)
        setBotError(msg || 'Bot API is unreachable')
      }
    }
  }, [guildId])

  useEffect(() => {
    fetchState()
    const interval = setInterval(fetchState, botConnected === false ? 10000 : 3000) // slower poll when bot unreachable
    return () => clearInterval(interval)
  }, [fetchState, botConnected])

  const handlePlay = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.post('/music/play', { guildId, query: query.trim() })
      setSuccess(`Added ${res.data.added} track(s) to queue`)
      setQuery('')
      fetchState()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to add track')
    } finally {
      setLoading(false)
    }
  }

  const sendAction = async (action: string, body?: any) => {
    try {
      await api.post(`/music/${action}`, { guildId, ...body })
      fetchState()
    } catch (err: any) {
      setError(err.response?.data?.error || `Failed: ${action}`)
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <span>🎵</span> Server Music
      </h2>

      {botConnected === false && (
        <div style={{ padding: '12px 16px', marginBottom: 16, background: '#3a2000', border: '1px solid #ff9800', borderRadius: 8, fontSize: 13, color: '#ffb74d', lineHeight: 1.5 }}>
          <strong>⚠️ Bot API Unreachable</strong>
          <div style={{ marginTop: 4 }}>{botError || 'The music bot service is not responding. Music features will not work until the bot is back online.'}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#ff9800' }}>The page will keep trying to reconnect automatically.</div>
        </div>
      )}

      {/* Add Track / Playlist */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 12px' }}>Add Music</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
          Paste any <strong>YouTube</strong>, <strong>SoundCloud</strong>, or <strong>Spotify</strong> URL — including playlists. Or type a search query.
        </p>
        <form onSubmit={handlePlay} style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Paste a URL or playlist link, or search for a song..."
            style={{
              flex: 1,
              padding: '12px 14px',
              borderRadius: 8,
              border: '1px solid var(--border-color, #333)',
              background: 'var(--bg-secondary, #1a1e2e)',
              color: 'var(--text-primary, #fff)',
              fontSize: 14,
              outline: 'none',
            }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !query.trim()}
            style={{ padding: '12px 24px', fontSize: 14, whiteSpace: 'nowrap' }}
          >
            {loading ? '...' : '▶ Play'}
          </button>
        </form>
        {error && <p style={{ color: '#ff6b6b', fontSize: 13, marginTop: 8 }}>{error}</p>}
        {success && <p style={{ color: '#14F195', fontSize: 13, marginTop: 8 }}>{success}</p>}
      </div>

      {/* Now Playing */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 12px' }}>Now Playing</h3>
        {state.current ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <span style={{ fontSize: 32 }}>{state.paused ? '⏸' : '🎵'}</span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{state.current.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {state.current.duration} — Requested by {state.current.requestedBy || 'Unknown'}
                </div>
              </div>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={() => sendAction(state.paused ? 'resume' : 'pause')} style={{ padding: '8px 16px' }}>
                {state.paused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button className="btn btn-primary" onClick={() => sendAction('skip')} style={{ padding: '8px 16px' }}>
                ⏭ Skip
              </button>
              <button className="btn btn-secondary" onClick={() => sendAction('loop')} style={{ padding: '8px 16px' }}>
                {state.loop ? '🔁 Loop On' : '➡️ Loop Off'}
              </button>
              <button className="btn btn-secondary" onClick={() => sendAction('clear')} style={{ padding: '8px 16px' }}>
                🗑️ Clear Queue
              </button>
              <button className="btn" onClick={() => sendAction('stop')} style={{ padding: '8px 16px', background: '#ff4444', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                ⏹ Stop
              </button>
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: '20px 0', textAlign: 'center' }}>
            <span style={{ fontSize: 32, display: 'block', marginBottom: 8 }}>🔇</span>
            Nothing is playing. Use <code>/music play</code> in Discord to connect the bot to a voice channel, then add music here or via commands.
          </div>
        )}
      </div>

      {/* Queue */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Queue</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}>{state.queue.length} track(s)</span>
        </h3>
        {state.queue.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
            Queue is empty — add tracks above
          </p>
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {state.queue.map((track, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--border-color, #222)',
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {i + 1}. {track.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {track.duration} — {track.requestedBy || '?'}
                  </div>
                </div>
                <button
                  onClick={() => sendAction('remove', { position: i })}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ff6b6b',
                    cursor: 'pointer',
                    fontSize: 16,
                    padding: '4px 8px',
                    flexShrink: 0,
                  }}
                  title="Remove from queue"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--bg-secondary, #1a1e2e)', borderRadius: 8, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong>💡 Tips:</strong>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          <li>The bot must be in a voice channel first — use <code>/music play [url]</code> in Discord to connect it.</li>
          <li>Paste full YouTube/SoundCloud/Spotify playlist URLs to add entire playlists at once.</li>
          <li>To stop hearing the music personally, use <code>/music mute</code> in Discord or click the 🔇 Mute Me button — this deafens only you while music keeps playing for everyone else.</li>
        </ul>
      </div>
    </div>
  )
}
