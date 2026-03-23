import React, { useState, useEffect } from 'react'
import api from '../../api'

interface Props {
  game: { id: string; name: string; img: string }
  guildId: string
  onClose: () => void
}

/**
 * Discord Share Modal – lets users share/post game screenshots or info
 * to their preferred Discord server/channel.
 */
export default function BeastDiscordShare({ game, guildId, onClose }: Props) {
  const [guilds, setGuilds] = useState<{ id: string; name: string }[]>([])
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([])
  const [selectedGuild, setSelectedGuild] = useState(guildId)
  const [selectedChannel, setSelectedChannel] = useState('')
  const [shareType, setShareType] = useState<'live' | 'thumb'>('thumb')
  const [message, setMessageText] = useState(`Playing ${game.name} on illy Beast Gaming! �🎮`)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  // Load guilds on mount
  useEffect(() => {
    api.get('/admin/guilds')
      .then(r => {
        const gs = r.data || []
        setGuilds(gs)
        if (gs.length > 0 && !gs.find((g: any) => g.id === selectedGuild)) {
          setSelectedGuild(gs[0].id)
        }
      })
      .catch(() => {})
  }, [])

  // Load channels when guild changes
  useEffect(() => {
    if (!selectedGuild) return
    api.get(`/admin/guilds/${selectedGuild}/channels`)
      .then(r => {
        const chs = (r.data || []).filter((c: any) => c.type === 0) // text channels only
        setChannels(chs)
        if (chs.length > 0) setSelectedChannel(chs[0].id)
      })
      .catch(() => setChannels([]))
  }, [selectedGuild])

  const handleShare = async () => {
    if (!selectedChannel) {
      setError('Select a channel to post to')
      return
    }
    setSending(true)
    setError('')
    try {
      await api.post('/beast/share-to-discord', {
        guildId: selectedGuild,
        channelId: selectedChannel,
        gameId: game.id,
        gameName: game.name,
        gameEmoji: game.img,
        shareType,
        message: message.trim().slice(0, 500),
      })
      setSent(true)
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to share')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="beast-share-overlay" onClick={onClose}>
      <div className="beast-share-modal" onClick={e => e.stopPropagation()}>
        <div className="beast-share-header">
          <h3>📤 Share to Discord</h3>
          <button className="beast-share-close" onClick={onClose}>✕</button>
        </div>

        {sent ? (
          <div className="beast-share-success">
            <div className="beast-share-success-icon">✅</div>
            <h3>Shared!</h3>
            <p>Your {game.name} game was posted to Discord!</p>
            <button className="beast-wallet-action-btn" onClick={onClose}>Close</button>
          </div>
        ) : (
          <div className="beast-share-content">
            {/* Game Preview */}
            <div className="beast-share-preview">
              <div className="beast-share-preview-card">
                <span className="beast-share-game-emoji">{game.img}</span>
                <div>
                  <strong>{game.name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>illy Beast Gaming</div>
                </div>
              </div>
            </div>

            {/* Share Type */}
            <div className="beast-share-field">
              <label>Share Type</label>
              <div className="beast-share-types">
                <button
                  className={`beast-share-type ${shareType === 'thumb' ? 'active' : ''}`}
                  onClick={() => setShareType('thumb')}
                >
                  🖼️ Thumbnail
                </button>
                <button
                  className={`beast-share-type ${shareType === 'live' ? 'active' : ''}`}
                  onClick={() => setShareType('live')}
                >
                  📺 Live View
                </button>
              </div>
            </div>

            {/* Server Selection */}
            <div className="beast-share-field">
              <label>Discord Server</label>
              <select
                value={selectedGuild}
                onChange={e => setSelectedGuild(e.target.value)}
                className="beast-share-select"
              >
                {guilds.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>

            {/* Channel Selection */}
            <div className="beast-share-field">
              <label>Channel</label>
              <select
                value={selectedChannel}
                onChange={e => setSelectedChannel(e.target.value)}
                className="beast-share-select"
              >
                {channels.map(c => (
                  <option key={c.id} value={c.id}>#{c.name}</option>
                ))}
              </select>
            </div>

            {/* Custom Message */}
            <div className="beast-share-field">
              <label>Message</label>
              <textarea
                value={message}
                onChange={e => setMessageText(e.target.value)}
                className="beast-share-textarea"
                rows={3}
                maxLength={500}
              />
              <div className="beast-share-charcount">{message.length}/500</div>
            </div>

            {error && <div className="beast-share-error">{error}</div>}

            <button className="beast-wallet-action-btn" onClick={handleShare} disabled={sending}>
              {sending ? 'Posting...' : '📤 Post to Discord'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
