import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import Countdown, { useTick, formatTimeAgo } from '../components/Countdown'

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

/* --- Vote Event types --- */
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
  vote_event_id?: number
  gambling_event_id?: number
  user_id: string
  username: string
  screenshot_url: string
  status: string
  submitted_at: string
  reviewed_at: string | null
  reviewed_by: string | null
}

/* --- Gambling Event types --- */
type GamblingEvent = {
  id: number
  title: string
  description: string
  mode: string
  prize_amount: number
  currency: string
  entry_fee: number
  min_players: number
  max_players: number
  current_players: number
  num_slots: number
  winning_slot: number | null
  status: string
  channel_id: string
  message_id: string | null
  qualification_url: string | null
  ends_at: string | null
  created_at: string
}

type SlotEntry = { label: string; color: string }

/* --- Poker Event types --- */
type PokerEvent = {
  id: number
  title: string
  description: string
  mode: string
  buy_in: number
  currency: string
  small_blind: number
  big_blind: number
  starting_chips: number
  max_players: number
  turn_timer: number
  current_players: number
  status: string
  channel_id: string
  message_id: string | null
  ended_at: string | null
  created_at: string
}

/* --- Shared types --- */
type Channel = { id: string; name: string }
type EventTab = 'all' | 'vote' | 'race' | 'poker'
type Props = { guildId: string; isOwner?: boolean }

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */
const DEFAULT_SLOTS: SlotEntry[] = [
  { label: '🔴 Crimson Blaze',    color: '#E74C3C' },
  { label: '⚫ Shadow Runner',    color: '#2C3E50' },
  { label: '🟢 Emerald Thunder',  color: '#27AE60' },
  { label: '🔵 Sapphire Storm',   color: '#3498DB' },
  { label: '🟡 Golden Lightning', color: '#F1C40F' },
  { label: '🟣 Violet Fury',      color: '#9B59B6' },
]

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */
function badgeClass(status: string): string {
  switch (status) {
    case 'active':    return 'badge badge-active'
    case 'ended':     return 'badge badge-ended'
    case 'completed': return 'badge badge-completed'
    case 'cancelled': return 'badge badge-ended'
    default:          return 'badge badge-open'
  }
}

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */
export default function EventManager({ guildId, isOwner = true }: Props) {
  useTick(1000)

  /* ---- Tab state ---- */
  const [tab, setTab] = useState<EventTab>('all')
  const [createType, setCreateType] = useState<'vote' | 'race' | 'poker'>('vote')

  /* ---- Shared data ---- */
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)

  /* ==================================================================
   *  VOTE EVENT STATE
   * ================================================================ */
  const [voteEvents, setVoteEvents] = useState<VoteEvent[]>([])

  /* ---- vote create-form ---- */
  const [vChannelId, setVChannelId] = useState('')
  const [vTitle, setVTitle] = useState('')
  const [vDescription, setVDescription] = useState('')
  const [vPrizeAmount, setVPrizeAmount] = useState('')
  const [vCurrency, setVCurrency] = useState('SOL')
  const [vMinParticipants, setVMinParticipants] = useState('1')
  const [vMaxParticipants, setVMaxParticipants] = useState('10')
  const [vDurationMinutes, setVDurationMinutes] = useState('')
  const [vQualificationUrl, setVQualificationUrl] = useState('')
  const [images, setImages] = useState<ImageEntry[]>([])
  const [favoriteIdx, setFavoriteIdx] = useState<number | null>(null)

  /* ---- media picker ---- */
  const [mediaChannelId, setMediaChannelId] = useState('')
  const [discordMedia, setDiscordMedia] = useState<DiscordMedia[]>([])
  const [mediaLoading, setMediaLoading] = useState(false)
  const [showMediaPicker, setShowMediaPicker] = useState(false)

  /* ---- upload ---- */
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /* ---- vote expanded / publish / qualification ---- */
  const [vExpandedId, setVExpandedId] = useState<number | null>(null)
  const [vPublishChannelId, setVPublishChannelId] = useState('')
  const [vPublishing, setVPublishing] = useState<number | null>(null)
  const [qualifications, setQualifications] = useState<Qualification[]>([])
  const [qualLoading, setQualLoading] = useState(false)
  const [reviewingId, setReviewingId] = useState<number | null>(null)

  /* ==================================================================
   *  GAMBLING EVENT STATE
   * ================================================================ */
  const [raceEvents, setRaceEvents] = useState<GamblingEvent[]>([])

  /* ---- race create-form ---- */
  const [rChannelId, setRChannelId] = useState('')
  const [rTitle, setRTitle] = useState('')
  const [rDescription, setRDescription] = useState('')
  const [rMode, setRMode] = useState<'house' | 'pot'>('house')
  const [rPrizeAmount, setRPrizeAmount] = useState('')
  const [rCurrency, setRCurrency] = useState('SOL')
  const [rEntryFee, setREntryFee] = useState('')
  const [rMinPlayers, setRMinPlayers] = useState('1')
  const [rMaxPlayers, setRMaxPlayers] = useState('10')
  const [rDurationMinutes, setRDurationMinutes] = useState('')
  const [numSlots, setNumSlots] = useState(6)
  const [slots, setSlots] = useState<SlotEntry[]>(DEFAULT_SLOTS.slice(0, 6))

  /* ---- race expanded / publish ---- */
  const [rExpandedId, setRExpandedId] = useState<number | null>(null)
  const [rPublishChannelId, setRPublishChannelId] = useState('')
  const [rPublishing, setRPublishing] = useState<number | null>(null)
  const [rQualificationUrl, setRQualificationUrl] = useState('')
  const [rQualifications, setRQualifications] = useState<Qualification[]>([])
  const [rQualLoading, setRQualLoading] = useState(false)
  const [rReviewingId, setRReviewingId] = useState<number | null>(null)

  /* ==================================================================
   *  POKER EVENT STATE
   * ================================================================ */
  const [pokerEvents, setPokerEvents] = useState<PokerEvent[]>([])

  /* ---- poker create-form ---- */
  const [pChannelId, setPChannelId] = useState('')
  const [pTitle, setPTitle] = useState('')
  const [pDescription, setPDescription] = useState('')
  const [pMode, setPMode] = useState<'pot' | 'casual'>('pot')
  const [pBuyIn, setPBuyIn] = useState('0.1')
  const [pCurrency, setPCurrency] = useState('SOL')
  const [pSmallBlind, setPSmallBlind] = useState('5')
  const [pBigBlind, setPBigBlind] = useState('10')
  const [pStartingChips, setPStartingChips] = useState('1000')
  const [pMaxPlayers, setPMaxPlayers] = useState('6')
  const [pTurnTimer, setPTurnTimer] = useState('30')

  /* ---- poker publish ---- */
  const [pPublishChannelId, setPPublishChannelId] = useState('')
  const [pPublishing, setPPublishing] = useState<number | null>(null)

  /* ==================================================================
   *  DATA LOADING
   * ================================================================ */
  const load = useCallback(async () => {
    if (!guildId) return
    setLoading(true)
    try {
      const [veRes, geRes, peRes, chRes] = await Promise.all([
        api.get(`/admin/guilds/${guildId}/vote-events`),
        api.get(`/admin/guilds/${guildId}/gambling-events`),
        api.get(`/admin/guilds/${guildId}/poker-events`),
        api.get(`/admin/guilds/${guildId}/channels`),
      ])
      setVoteEvents(veRes.data || [])
      setRaceEvents(geRes.data || [])
      setPokerEvents(peRes.data || [])
      setChannels(chRes.data || [])
      const ch = chRes.data || []
      if (ch.length) {
        if (!vChannelId) { setVChannelId(ch[0].id); setMediaChannelId(ch[0].id); setVPublishChannelId(ch[0].id) }
        if (!rChannelId) { setRChannelId(ch[0].id); setRPublishChannelId(ch[0].id) }
        if (!pChannelId) { setPChannelId(ch[0].id); setPPublishChannelId(ch[0].id) }
      }
    } finally {
      setLoading(false)
    }
  }, [guildId])

  useEffect(() => {
    setVoteEvents([]); setRaceEvents([]); setPokerEvents([]); setChannels([])
    setVChannelId(''); setRChannelId(''); setPChannelId('')
    setMediaChannelId(''); setVPublishChannelId(''); setRPublishChannelId(''); setPPublishChannelId('')
    if (guildId) load()
  }, [guildId, load])

  /* ---- Auto-poll every 15s ---- */
  useEffect(() => {
    if (!guildId) return
    const id = setInterval(() => {
      Promise.all([
        api.get(`/admin/guilds/${guildId}/vote-events`),
        api.get(`/admin/guilds/${guildId}/gambling-events`),
        api.get(`/admin/guilds/${guildId}/poker-events`),
      ]).then(([ve, ge, pe]) => {
        setVoteEvents(ve.data || [])
        setRaceEvents(ge.data || [])
        setPokerEvents(pe.data || [])
      }).catch(() => {})
    }, 15000)
    return () => clearInterval(id)
  }, [guildId])

  /* ==================================================================
   *  VOTE EVENT HANDLERS
   * ================================================================ */

  /* ---- Discord media picker ---- */
  const loadMedia = async () => {
    if (!guildId || !mediaChannelId) return
    setMediaLoading(true)
    try {
      const res = await api.get(`/admin/guilds/${guildId}/channels/${mediaChannelId}/media?limit=50`)
      setDiscordMedia(res.data || [])
    } catch {
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

  /* ---- File upload ---- */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || !vChannelId || !guildId) return
    setUploading(true)
    try {
      for (let i = 0; i < files.length; i++) {
        if (images.length + i >= 5) break
        const file = files[i]
        if (!file.type.startsWith('image/')) continue
        const fd = new FormData()
        fd.append('image', file)
        fd.append('caption', `📸 Event image: ${file.name}`)
        const res = await api.post(`/admin/guilds/${guildId}/channels/${vChannelId}/upload`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        setImages(prev => [...prev, { id: res.data.id, url: res.data.url, source: 'upload', name: file.name }])
      }
    } catch {
      alert('Image upload failed. Make sure a channel is selected.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx))
    if (favoriteIdx === idx) setFavoriteIdx(null)
    else if (favoriteIdx !== null && favoriteIdx > idx) setFavoriteIdx(favoriteIdx - 1)
  }

  /* ---- Create vote event ---- */
  const handleCreateVote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guildId || !vTitle || images.length < 2) {
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
      channel_id: vChannelId,
      title: vTitle,
      description: vDescription,
      prize_amount: vPrizeAmount ? Number(vPrizeAmount) : 0,
      currency: vCurrency,
      min_participants: Number(vMinParticipants) || 1,
      max_participants: Number(vMaxParticipants) || 10,
      duration_minutes: vDurationMinutes ? Number(vDurationMinutes) : null,
      owner_favorite_image_id: imgPayload[favoriteIdx]?.id || null,
      images: imgPayload,
      qualification_url: vQualificationUrl || null,
    })
    setVTitle(''); setVDescription(''); setVPrizeAmount('')
    setVMinParticipants('1'); setVMaxParticipants('10'); setVDurationMinutes('')
    setVQualificationUrl(''); setImages([]); setFavoriteIdx(null)
    await load()
  }

  /* ---- Publish vote event ---- */
  const handlePublishVote = async (eventId: number) => {
    if (!guildId) return
    setVPublishing(eventId)
    try {
      await api.post(`/admin/guilds/${guildId}/vote-events/${eventId}/publish`, {
        channel_id: vPublishChannelId || vChannelId,
      })
      await load()
    } catch {
      alert('Failed to publish. Check channel permissions.')
    } finally {
      setVPublishing(null)
    }
  }

  /* ---- Delete vote event ---- */
  const handleDeleteVote = async (eventId: number) => {
    if (!confirm('Delete this vote event? This cannot be undone.')) return
    try {
      await api.delete(`/admin/guilds/${guildId}/vote-events/${eventId}`)
      await load()
    } catch {
      alert('Failed to delete event.')
    }
  }

  /* ---- Qualifications ---- */
  const loadQualifications = async (eventId: number) => {
    if (!guildId) return
    setQualLoading(true)
    try {
      const res = await api.get(`/admin/guilds/${guildId}/vote-events/${eventId}/qualifications`)
      setQualifications(res.data || [])
    } catch {
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
      if (vExpandedId) await loadQualifications(vExpandedId)
    } catch {
      alert('Failed to review qualification.')
    } finally {
      setReviewingId(null)
    }
  }

  useEffect(() => {
    if (vExpandedId && guildId) {
      const ev = voteEvents.find(e => e.id === vExpandedId)
      if (ev?.qualification_url) loadQualifications(vExpandedId)
      else setQualifications([])
    } else {
      setQualifications([])
    }
  }, [vExpandedId, guildId])

  const getQualifyLink = (eventId: number) => {
    const base = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : ''
    return `${base}#qualify-${eventId}`
  }

  /* ---- Race Qualifications ---- */
  const loadRaceQualifications = async (eventId: number) => {
    if (!guildId) return
    setRQualLoading(true)
    try {
      const res = await api.get(`/admin/guilds/${guildId}/gambling-events/${eventId}/qualifications`)
      setRQualifications(res.data || [])
    } catch {
      setRQualifications([])
    } finally {
      setRQualLoading(false)
    }
  }

  const handleRaceReview = async (qualId: number, status: 'approved' | 'rejected') => {
    if (!guildId) return
    setRReviewingId(qualId)
    try {
      await api.patch(`/admin/guilds/${guildId}/gambling-qualifications/${qualId}/review`, { status })
      if (rExpandedId) await loadRaceQualifications(rExpandedId)
    } catch {
      alert('Failed to review qualification.')
    } finally {
      setRReviewingId(null)
    }
  }

  useEffect(() => {
    if (rExpandedId && guildId) {
      const ev = raceEvents.find(e => e.id === rExpandedId)
      if (ev?.qualification_url) loadRaceQualifications(rExpandedId)
      else setRQualifications([])
    } else {
      setRQualifications([])
    }
  }, [rExpandedId, guildId])

  const getRaceQualifyLink = (eventId: number) => {
    const base = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : ''
    return `${base}#race-qualify-${eventId}`
  }

  /* ==================================================================
   *  GAMBLING EVENT HANDLERS
   * ================================================================ */

  /* ---- Slot management ---- */
  const handleNumSlotsChange = (n: number) => {
    const clamped = Math.max(2, Math.min(6, n))
    setNumSlots(clamped)
    setSlots(prev => {
      if (clamped > prev.length) {
        const extended = [...prev]
        for (let i = prev.length; i < clamped; i++) {
          extended.push(DEFAULT_SLOTS[i] || { label: `Slot ${i + 1}`, color: '#888' })
        }
        return extended
      }
      return prev.slice(0, clamped)
    })
  }

  const updateSlotLabel = (idx: number, label: string) => {
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, label } : s))
  }

  /* ---- Create gambling event ---- */
  const handleCreateRace = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guildId || !rTitle || slots.length < 2) {
      alert('Title and at least 2 slots are required.')
      return
    }
    await api.post(`/admin/guilds/${guildId}/gambling-events`, {
      channel_id: rChannelId,
      title: rTitle,
      description: rDescription,
      mode: rMode,
      prize_amount: rMode === 'house' ? (rPrizeAmount ? Number(rPrizeAmount) : 0) : 0,
      currency: rCurrency,
      entry_fee: rMode === 'pot' ? (rEntryFee ? Number(rEntryFee) : 0) : 0,
      min_players: Number(rMinPlayers) || 1,
      max_players: Number(rMaxPlayers) || 10,
      duration_minutes: rDurationMinutes ? Number(rDurationMinutes) : null,
      slots: slots.map(s => ({ label: s.label, color: s.color })),
      qualification_url: rQualificationUrl || null,
    })
    setRTitle(''); setRDescription(''); setRPrizeAmount('')
    setREntryFee(''); setRMinPlayers('1'); setRMaxPlayers('10')
    setRDurationMinutes(''); setNumSlots(6); setSlots(DEFAULT_SLOTS.slice(0, 6))
    setRQualificationUrl('')
    await load()
  }

  /* ---- Publish gambling event ---- */
  const handlePublishRace = async (eventId: number) => {
    if (!guildId) return
    setRPublishing(eventId)
    try {
      await api.post(`/admin/guilds/${guildId}/gambling-events/${eventId}/publish`, {
        channel_id: rPublishChannelId || rChannelId,
      })
      await load()
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Unknown error'
      alert(`Failed to publish: ${detail}`)
    } finally {
      setRPublishing(null)
    }
  }

  /* ---- Delete gambling event ---- */
  const handleDeleteRace = async (eventId: number) => {
    if (!confirm('Delete this horse race event? This cannot be undone.')) return
    try {
      await api.delete(`/admin/guilds/${guildId}/gambling-events/${eventId}`)
      await load()
    } catch {
      alert('Failed to delete event.')
    }
  }

  /* ---- Cancel gambling event ---- */
  const handleCancelRace = async (eventId: number) => {
    if (!confirm('Cancel this horse race event?')) return
    try {
      await api.patch(`/admin/guilds/${guildId}/gambling-events/${eventId}/cancel`)
      await load()
    } catch {
      alert('Failed to cancel event.')
    }
  }

  /* ==================================================================
   *  POKER EVENT HANDLERS
   * ================================================================ */

  /* ---- Create poker event ---- */
  const handleCreatePoker = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guildId || !pTitle) {
      alert('Title is required.')
      return
    }
    await api.post(`/admin/guilds/${guildId}/poker-events`, {
      channel_id: pChannelId,
      title: pTitle,
      description: pDescription,
      mode: pMode,
      buy_in: pMode === 'pot' ? (pBuyIn ? Number(pBuyIn) : 0) : 0,
      currency: pCurrency,
      small_blind: Number(pSmallBlind) || 5,
      big_blind: Number(pBigBlind) || 10,
      starting_chips: Number(pStartingChips) || 1000,
      max_players: Number(pMaxPlayers) || 6,
      turn_timer: Number(pTurnTimer) || 30,
    })
    setPTitle(''); setPDescription(''); setPBuyIn('0.1')
    setPSmallBlind('5'); setPBigBlind('10'); setPStartingChips('1000')
    setPMaxPlayers('6'); setPTurnTimer('30')
    await load()
  }

  /* ---- Publish poker event ---- */
  const handlePublishPoker = async (eventId: number) => {
    if (!guildId) return
    setPPublishing(eventId)
    try {
      await api.post(`/admin/guilds/${guildId}/poker-events/${eventId}/publish`, {
        channel_id: pPublishChannelId || pChannelId,
      })
      await load()
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Unknown error'
      alert(`Failed to publish: ${detail}`)
    } finally {
      setPPublishing(null)
    }
  }

  /* ---- Delete poker event ---- */
  const handleDeletePoker = async (eventId: number) => {
    if (!confirm('Delete this poker event? This cannot be undone.')) return
    try {
      await api.delete(`/admin/guilds/${guildId}/poker-events/${eventId}`)
      await load()
    } catch {
      alert('Failed to delete event.')
    }
  }

  /* ---- Cancel poker event ---- */
  const handleCancelPoker = async (eventId: number) => {
    if (!confirm('Cancel this poker event?')) return
    try {
      await api.patch(`/admin/guilds/${guildId}/poker-events/${eventId}/cancel`)
      await load()
    } catch {
      alert('Failed to cancel event.')
    }
  }

  /* ==================================================================
   *  UNIFIED STATS
   * ================================================================ */
  const totalVoteActive = voteEvents.filter(e => e.status === 'active').length
  const totalRaceActive = raceEvents.filter(e => e.status === 'active').length
  const totalPokerActive = pokerEvents.filter(e => e.status === 'active').length
  const totalEvents = voteEvents.length + raceEvents.length + pokerEvents.length
  const totalActive = totalVoteActive + totalRaceActive + totalPokerActive

  /* ==================================================================
   *  RENDER: empty
   * ================================================================ */
  if (!guildId) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state-icon">🎯</div>
          <div className="empty-state-text">Select a server to manage events.</div>
        </div>
      </div>
    )
  }

  /* ==================================================================
   *  RENDER
   * ================================================================ */
  return (
    <div className="container">
      {/* ---- Header ---- */}
      <div className="section-header">
        <h2 style={{ marginBottom: 0 }}>🎯 Event Manager</h2>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Refresh'}
        </button>
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Create and manage all events — photo-voting challenges, horse race betting, and poker tables — from one place.
      </p>

      {/* ---- Summary bar ---- */}
      <div className="em-summary-bar">
        <div className="em-stat">
          <span className="em-stat-value">{totalEvents}</span>
          <span className="em-stat-label">Total Events</span>
        </div>
        <div className="em-stat">
          <span className="em-stat-value em-stat-active">{totalActive}</span>
          <span className="em-stat-label">Active</span>
        </div>
        <div className="em-stat">
          <span className="em-stat-value">{voteEvents.length}</span>
          <span className="em-stat-label">🗳️ Vote</span>
        </div>
        <div className="em-stat">
          <span className="em-stat-value">{raceEvents.length}</span>
          <span className="em-stat-label">🏇 Race</span>
        </div>
        <div className="em-stat">
          <span className="em-stat-value">{pokerEvents.length}</span>
          <span className="em-stat-label">🃏 Poker</span>
        </div>
      </div>

      {/* ---- Filter tabs ---- */}
      <div className="em-tabs">
        <button className={`em-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
          All Events ({totalEvents})
        </button>
        <button className={`em-tab ${tab === 'vote' ? 'active' : ''}`} onClick={() => setTab('vote')}>
          🗳️ Vote Events ({voteEvents.length})
        <button className={`em-tab ${tab === 'poker' ? 'active' : ''}`} onClick={() => setTab('poker')}>
          🃏 Poker ({pokerEvents.length})
        </button>
        </button>
        <button className={`em-tab ${tab === 'race' ? 'active' : ''}`} onClick={() => setTab('race')}>
          🏇 Horse Race ({raceEvents.length})
        </button>
      </div>

      {/* ============================================================ */}
      {/*  VOTE EVENTS TABLE                                            */}
      {/* ============================================================ */}
      {(tab === 'all' || tab === 'vote') && (
        <div className="card em-section" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <div className="card-title">🗳️ Vote Events ({voteEvents.length})</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Publish to:</span>
              <select className="form-select" style={{ width: 160, fontSize: 12 }} value={vPublishChannelId} onChange={e => setVPublishChannelId(e.target.value)}>
                {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
          </div>

          {voteEvents.length === 0 ? (
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
                  <th>Time Left</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {voteEvents.map(ev => (
                  <React.Fragment key={ev.id}>
                    <tr>
                      <td>#{ev.id}</td>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}
                          onClick={() => setVExpandedId(vExpandedId === ev.id ? null : ev.id)}>
                        {ev.title}
                        {ev.qualification_url && <span style={{ fontSize: 10, marginLeft: 4, color: 'var(--accent-purple)' }}>🔗</span>}
                        <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--text-secondary)' }}>
                          {vExpandedId === ev.id ? '▾' : '▸'}
                        </span>
                      </td>
                      <td><span className="sol-badge">{ev.prize_amount} {ev.currency}</span></td>
                      <td>{ev.current_participants}/{ev.max_participants}</td>
                      <td><span className={badgeClass(ev.status)}>{ev.status}</span></td>
                      <td style={{ fontSize: 12 }}><Countdown endsAt={ev.ends_at} prefix='⏱️ ' endedText='—' /></td>
                      <td style={{ fontSize: 12 }}>{formatTimeAgo(ev.created_at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {isOwner && ev.status === 'active' && !ev.message_id && (
                            <button className="btn btn-primary btn-sm"
                                    disabled={vPublishing === ev.id}
                                    onClick={() => handlePublishVote(ev.id)}>
                              {vPublishing === ev.id ? '...' : 'Publish'}
                            </button>
                          )}
                          {ev.message_id && (
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '4px 6px' }}>✅ Published</span>
                          )}
                          {isOwner && (
                            <button className="btn btn-danger btn-sm" onClick={() => handleDeleteVote(ev.id)}>
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded detail with qualification review */}
                    {vExpandedId === ev.id && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                          <div style={{ padding: 16 }}>
                            {ev.qualification_url ? (
                              <div style={{ marginBottom: 16 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                  <strong style={{ fontSize: 14 }}>🔗 Qualification Required</strong>
                                  <button className="btn btn-secondary btn-sm" onClick={() => {
                                    const link = getQualifyLink(ev.id)
                                    navigator.clipboard?.writeText(link)
                                    alert('Qualification link copied!\n\n' + link)
                                  }}>
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
                                        {q.status === 'pending' && isOwner && (
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
      )}

      {/* ============================================================ */}
      {/*  HORSE RACE EVENTS TABLE                                      */}
      {/* ============================================================ */}
      {(tab === 'all' || tab === 'race') && (
        <div className="card em-section" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <div className="card-title">🏇 Horse Race Events ({raceEvents.length})</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Publish to:</span>
              <select className="form-select" style={{ width: 160, fontSize: 12 }} value={rPublishChannelId} onChange={e => setRPublishChannelId(e.target.value)}>
                {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
          </div>

          {raceEvents.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🏇</div>
              <div className="empty-state-text">No horse race events yet. Create one below.</div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Title</th>
                  <th>Mode</th>
                  <th>Prize</th>
                  <th>Players</th>
                  <th>Status</th>
                  <th>Time Left</th>
                  <th>Winner</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {raceEvents.map(ev => (
                  <React.Fragment key={ev.id}>
                    <tr>
                      <td>#{ev.id}</td>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}
                          onClick={() => setRExpandedId(rExpandedId === ev.id ? null : ev.id)}>
                        {ev.title}
                        <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--text-secondary)' }}>
                          {rExpandedId === ev.id ? '▾' : '▸'}
                        </span>
                      </td>
                      <td><span style={{ fontSize: 11 }}>{ev.mode === 'pot' ? '🏦 Pot' : '🏠 House'}</span></td>
                      <td>
                        <span className="sol-badge">
                          {ev.mode === 'pot' ? `${ev.entry_fee} ${ev.currency}/bet` : `${ev.prize_amount} ${ev.currency}`}
                        </span>
                      </td>
                      <td>{ev.current_players}/{ev.max_players}</td>
                      <td><span className={badgeClass(ev.status)}>{ev.status}</span></td>
                      <td style={{ fontSize: 12 }}><Countdown endsAt={ev.ends_at} prefix='⏱️ ' endedText='—' /></td>
                      <td style={{ fontSize: 12 }}>{ev.winning_slot ? `🏆 Horse #${ev.winning_slot}` : '—'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {isOwner && ev.status === 'active' && !ev.message_id && (
                            <button className="btn btn-primary btn-sm"
                                    disabled={rPublishing === ev.id}
                                    onClick={() => handlePublishRace(ev.id)}>
                              {rPublishing === ev.id ? '...' : 'Publish'}
                            </button>
                          )}
                          {ev.message_id && (
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '4px 6px' }}>✅ Published</span>
                          )}
                          {isOwner && ev.status === 'active' && (
                            <button className="btn btn-secondary btn-sm" onClick={() => handleCancelRace(ev.id)} style={{ color: '#f0ad4e' }}>
                              Cancel
                            </button>
                          )}
                          {isOwner && (
                            <button className="btn btn-danger btn-sm" onClick={() => handleDeleteRace(ev.id)}>
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded detail */}
                    {rExpandedId === ev.id && (
                      <tr>
                        <td colSpan={9} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                          <div style={{ padding: 16 }}>
                            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                              <div>
                                <strong style={{ fontSize: 13 }}>Description</strong>
                                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0' }}>
                                  {ev.description || '(none)'}
                                </p>
                              </div>
                              <div>
                                <strong style={{ fontSize: 13 }}>Details</strong>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                                  <div>Mode: {ev.mode === 'pot' ? 'Pot Split' : 'House-funded'}</div>
                                  <div>Horses: {ev.num_slots}</div>
                                  <div>Min riders: {ev.min_players}</div>
                                  <div>Created: {formatTimeAgo(ev.created_at)}</div>
                                  {ev.winning_slot && <div style={{ color: 'var(--accent-green)', fontWeight: 600 }}>Winning Horse: #{ev.winning_slot}</div>}
                                  {ev.qualification_url && (
                                    <div style={{ marginTop: 4 }}>
                                      🔗 <a href={ev.qualification_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue)' }}>Qualification URL</a>
                                      {' | '}
                                      <span style={{ cursor: 'pointer', color: 'var(--accent-blue)', textDecoration: 'underline' }}
                                            onClick={() => { navigator.clipboard.writeText(getRaceQualifyLink(ev.id)); alert('Qualify link copied!') }}>
                                        Copy qualify page link
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Qualification review for gambling events */}
                            {ev.qualification_url && (
                              <div style={{ marginTop: 16, borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
                                <strong style={{ fontSize: 13 }}>📸 Qualifications</strong>
                                {rQualLoading ? (
                                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Loading...</div>
                                ) : rQualifications.length === 0 ? (
                                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>No qualifications submitted yet.</div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                                    {rQualifications.map(q => (
                                      <div key={q.id} style={{
                                        display: 'flex', alignItems: 'center', gap: 12,
                                        padding: '8px 12px', background: 'var(--bg-primary)',
                                        borderRadius: 8, border: '1px solid var(--border-color)',
                                      }}>
                                        <img src={q.screenshot_url} alt="proof" style={{
                                          width: 48, height: 48, borderRadius: 6, objectFit: 'cover',
                                          border: '1px solid var(--border-color)', cursor: 'pointer',
                                        }} onClick={() => window.open(q.screenshot_url, '_blank')} />
                                        <div style={{ flex: 1 }}>
                                          <div style={{ fontSize: 13, fontWeight: 600 }}>{q.username || q.user_id}</div>
                                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                            {formatTimeAgo(q.submitted_at)} • <span className={`badge ${q.status === 'approved' ? 'badge-completed' : q.status === 'rejected' ? 'badge-ended' : 'badge-open'}`}>{q.status}</span>
                                          </div>
                                        </div>
                                        {isOwner && q.status === 'pending' && (
                                          <div style={{ display: 'flex', gap: 4 }}>
                                            <button className="btn btn-primary btn-sm"
                                                    disabled={rReviewingId === q.id}
                                                    onClick={() => handleRaceReview(q.id, 'approved')}>
                                              ✅
                                            </button>
                                            <button className="btn btn-danger btn-sm"
                                                    disabled={rReviewingId === q.id}
                                                    onClick={() => handleRaceReview(q.id, 'rejected')}>
                                              ❌
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
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
      )}

      {/* ============================================================ */}
      {/*  POKER EVENTS TABLE                                           */}
      {/* ============================================================ */}
      {(tab === 'all' || tab === 'poker') && (
        <div className="card em-section" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <div className="card-title">🃏 Poker Events ({pokerEvents.length})</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Publish to:</span>
              <select className="form-select" style={{ width: 160, fontSize: 12 }} value={pPublishChannelId} onChange={e => setPPublishChannelId(e.target.value)}>
                {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
          </div>

          {pokerEvents.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🃏</div>
              <div className="empty-state-text">No poker events yet. Create one below.</div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Title</th>
                  <th>Mode</th>
                  <th>Buy-in</th>
                  <th>Blinds</th>
                  <th>Seats</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pokerEvents.map(ev => (
                  <tr key={ev.id}>
                    <td>#{ev.id}</td>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{ev.title}</td>
                    <td><span style={{ fontSize: 11 }}>{ev.mode === 'pot' ? '🏦 Pot' : '🎮 Casual'}</span></td>
                    <td>
                      <span className="sol-badge">
                        {ev.mode === 'pot' && ev.buy_in > 0 ? `${ev.buy_in} ${ev.currency}` : 'Free'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>{ev.small_blind}/{ev.big_blind}</td>
                    <td>{ev.current_players}/{ev.max_players}</td>
                    <td><span className={badgeClass(ev.status)}>{ev.status}</span></td>
                    <td style={{ fontSize: 12 }}>{formatTimeAgo(ev.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {isOwner && ev.status === 'active' && !ev.message_id && (
                          <button className="btn btn-primary btn-sm"
                                  disabled={pPublishing === ev.id}
                                  onClick={() => handlePublishPoker(ev.id)}>
                            {pPublishing === ev.id ? '...' : 'Publish'}
                          </button>
                        )}
                        {ev.message_id && (
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '4px 6px' }}>✅ Published</span>
                        )}
                        {isOwner && ev.status === 'active' && (
                          <button className="btn btn-secondary btn-sm" onClick={() => handleCancelPoker(ev.id)} style={{ color: '#f0ad4e' }}>
                            Cancel
                          </button>
                        )}
                        {isOwner && (
                          <button className="btn btn-danger btn-sm" onClick={() => handleDeletePoker(ev.id)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  CREATE EVENT FORM (owner only)                               */}
      {/* ============================================================ */}
      {isOwner && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Create New Event</div>
            <div className="em-create-tabs">
              <button className={`em-create-tab ${createType === 'vote' ? 'active' : ''}`}
                      onClick={() => setCreateType('vote')}>
                🗳️ Vote Event
              </button>
              <button className={`em-create-tab ${createType === 'race' ? 'active' : ''}`}
                      onClick={() => setCreateType('race')}>
                🏇 Horse Race
              </button>
              <button className={`em-create-tab ${createType === 'poker' ? 'active' : ''}`}
                      onClick={() => setCreateType('poker')}>
                🃏 Poker
              </button>
            </div>
          </div>

          {/* ======================================================== */}
          {/*  Vote Event Create Form                                    */}
          {/* ======================================================== */}
          {createType === 'vote' && (
            <form onSubmit={handleCreateVote}>
              {/* Row 1: Title + Channel */}
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Title *</label>
                  <input className="form-input" value={vTitle} onChange={e => setVTitle(e.target.value)}
                         placeholder="e.g. Best Meme of the Week" required />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Channel *</label>
                  <select className="form-select" value={vChannelId} onChange={e => { setVChannelId(e.target.value); setMediaChannelId(e.target.value) }}>
                    {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Description */}
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-textarea" value={vDescription} onChange={e => setVDescription(e.target.value)}
                          placeholder="Describe the voting challenge..." rows={2} />
              </div>

              {/* Row 2: Prize, Currency, Min, Max, Duration */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Prize Pool</label>
                  <input className="form-input" type="number" step="any" min="0" value={vPrizeAmount}
                         onChange={e => setVPrizeAmount(e.target.value)} placeholder="0" />
                </div>
                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select className="form-select" value={vCurrency} onChange={e => setVCurrency(e.target.value)}>
                    <option value="SOL">SOL</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Min Seats</label>
                  <input className="form-input" type="number" min="1" value={vMinParticipants}
                         onChange={e => setVMinParticipants(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Max Seats</label>
                  <input className="form-input" type="number" min="2" value={vMaxParticipants}
                         onChange={e => setVMaxParticipants(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Duration (min)</label>
                  <input className="form-input" type="number" min="1" value={vDurationMinutes}
                         onChange={e => setVDurationMinutes(e.target.value)} placeholder="∞" />
                </div>
              </div>

              {/* Qualification URL */}
              <div className="form-group">
                <label className="form-label">Qualification URL (optional)</label>
                <input className="form-input" type="url" value={vQualificationUrl}
                       onChange={e => setVQualificationUrl(e.target.value)}
                       placeholder="https://example.com/page-to-visit" />
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                  If set, participants must visit this URL and submit a screenshot proof before they can join the event.
                </p>
              </div>

              {/* Image selection */}
              <div className="form-group">
                <label className="form-label">Images * (min 2, max 5)</label>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 8px' }}>
                  Upload from your PC or pick images already posted in the selected Discord channel. Click the ⭐ to mark your secret winning pick.
                </p>

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
                              value={mediaChannelId} onChange={e => setMediaChannelId(e.target.value)}>
                        {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                      </select>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={loadMedia} disabled={mediaLoading}>
                        {mediaLoading ? <span className="spinner" /> : '🔄 Load'}
                      </button>
                    </div>
                    {discordMedia.length === 0 && !mediaLoading && (
                      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No images found. Post images there first, then click Load.</p>
                    )}
                    <div className="ve-media-grid">
                      {discordMedia.map(m => {
                        const picked = images.some(i => i.id === m.id)
                        return (
                          <div key={m.id} className={`ve-media-thumb ${picked ? 've-media-picked' : ''}`}
                               onClick={() => !picked && pickMedia(m)}
                               title={`${m.name}\nBy: ${m.authorTag}\n${m.postedAt ? new Date(m.postedAt).toLocaleString() : ''}`}>
                            <img src={m.proxyURL || m.url} alt={m.name} loading="lazy" />
                            {picked && <div className="ve-media-check">✓</div>}
                            <div className="ve-media-label">ID: {m.id.slice(0, 8)}…</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Selected images with star picker */}
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

              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="submit" className="btn btn-primary"
                        disabled={images.length < 2 || favoriteIdx === null || !vTitle}>
                  Create Vote Event
                </button>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {images.length < 2 ? `Need ${2 - images.length} more image(s)` : favoriteIdx === null ? 'Select a winner' : '✅ Ready'}
                </span>
              </div>
            </form>
          )}

          {/* ======================================================== */}
          {/*  Horse Race Create Form                                    */}
          {/* ======================================================== */}
          {createType === 'race' && (
            <form onSubmit={handleCreateRace}>
              {/* Row 1: Title + Channel */}
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Title *</label>
                  <input className="form-input" value={rTitle} onChange={e => setRTitle(e.target.value)}
                         placeholder="e.g. Friday Night Derby" required />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Channel *</label>
                  <select className="form-select" value={rChannelId} onChange={e => setRChannelId(e.target.value)}>
                    {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Description */}
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-textarea" value={rDescription} onChange={e => setRDescription(e.target.value)}
                          placeholder="Describe the horse race event..." rows={2} />
              </div>

              {/* Mode + Prize/Fee */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Mode</label>
                  <select className="form-select" value={rMode} onChange={e => setRMode(e.target.value as 'house' | 'pot')}>
                    <option value="house">🏠 House-funded (you set prize)</option>
                    <option value="pot">🏦 Pot Split (entry fees pooled)</option>
                  </select>
                </div>
                {rMode === 'house' ? (
                  <div className="form-group">
                    <label className="form-label">Prize Pool</label>
                    <input className="form-input" type="number" step="any" min="0" value={rPrizeAmount}
                           onChange={e => setRPrizeAmount(e.target.value)} placeholder="0" />
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">Entry Fee</label>
                    <input className="form-input" type="number" step="any" min="0" value={rEntryFee}
                           onChange={e => setREntryFee(e.target.value)} placeholder="0.01" />
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select className="form-select" value={rCurrency} onChange={e => setRCurrency(e.target.value)}>
                    <option value="SOL">SOL</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              {/* Players + Duration */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Min Players</label>
                  <input className="form-input" type="number" min="1" value={rMinPlayers}
                         onChange={e => setRMinPlayers(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Max Players</label>
                  <input className="form-input" type="number" min="2" value={rMaxPlayers}
                         onChange={e => setRMaxPlayers(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Duration (min)</label>
                  <input className="form-input" type="number" min="1" value={rDurationMinutes}
                         onChange={e => setRDurationMinutes(e.target.value)} placeholder="∞" />
                </div>
              </div>

              {/* Qualification URL */}
              <div className="form-group">
                <label className="form-label">Qualification URL <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>(optional)</span></label>
                <input className="form-input" value={rQualificationUrl}
                       onChange={e => setRQualificationUrl(e.target.value)}
                       placeholder="https://... — users must visit this URL and upload a screenshot to qualify" />
              </div>

              {/* Horse configuration */}
              <div className="form-group">
                <label className="form-label">Horses ({numSlots})</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input className="form-input" type="number" min="2" max="6" value={numSlots}
                         onChange={e => handleNumSlotsChange(Number(e.target.value))}
                         style={{ width: 80 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>2–6 horses</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {slots.map((slot, idx) => (
                    <div key={idx} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: 'var(--bg-secondary)', padding: '6px 10px',
                      borderRadius: 8, border: '1px solid var(--border-color)',
                      borderLeft: `4px solid ${slot.color}`,
                    }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 16 }}>{idx + 1}.</span>
                      <input className="form-input" value={slot.label}
                             onChange={e => updateSlotLabel(idx, e.target.value)}
                             style={{ width: 120, fontSize: 13, padding: '4px 8px' }} />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="submit" className="btn btn-primary"
                        disabled={slots.length < 2 || !rTitle}>
                  Create Horse Race
                </button>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {!rTitle ? 'Enter a title' : slots.length < 2 ? 'Need at least 2 horses' : '✅ Ready'}
                </span>
              </div>
            </form>
          )}

          {/* ======================================================== */}
          {/*  Poker Create Form                                         */}
          {/* ======================================================== */}
          {createType === 'poker' && (
            <form onSubmit={handleCreatePoker}>
              {/* Row 1: Title + Channel */}
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Title *</label>
                  <input className="form-input" value={pTitle} onChange={e => setPTitle(e.target.value)}
                         placeholder="e.g. Friday Night Poker" required />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Channel *</label>
                  <select className="form-select" value={pChannelId} onChange={e => setPChannelId(e.target.value)}>
                    {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Description */}
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-textarea" value={pDescription} onChange={e => setPDescription(e.target.value)}
                          placeholder="Describe the poker event..." rows={2} />
              </div>

              {/* Mode + Buy-in */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Mode</label>
                  <select className="form-select" value={pMode} onChange={e => setPMode(e.target.value as 'pot' | 'casual')}>
                    <option value="pot">🏦 Pot (real SOL buy-in)</option>
                    <option value="casual">🎮 Casual (play money)</option>
                  </select>
                </div>
                {pMode === 'pot' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Buy-in Amount</label>
                      <input className="form-input" type="number" step="any" min="0" value={pBuyIn}
                             onChange={e => setPBuyIn(e.target.value)} placeholder="0.1" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Currency</label>
                      <select className="form-select" value={pCurrency} onChange={e => setPCurrency(e.target.value)}>
                        <option value="SOL">SOL</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                  </>
                )}
              </div>

              {/* Blinds + Chips */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Small Blind</label>
                  <input className="form-input" type="number" min="1" value={pSmallBlind}
                         onChange={e => setPSmallBlind(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Big Blind</label>
                  <input className="form-input" type="number" min="2" value={pBigBlind}
                         onChange={e => setPBigBlind(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Starting Chips</label>
                  <input className="form-input" type="number" min="100" value={pStartingChips}
                         onChange={e => setPStartingChips(e.target.value)} />
                </div>
              </div>

              {/* Players + Timer */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Max Players</label>
                  <input className="form-input" type="number" min="2" max="8" value={pMaxPlayers}
                         onChange={e => setPMaxPlayers(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Turn Timer (sec)</label>
                  <input className="form-input" type="number" min="10" max="120" value={pTurnTimer}
                         onChange={e => setPTurnTimer(e.target.value)} />
                </div>
              </div>

              {/* Chip value preview */}
              {pMode === 'pot' && Number(pBuyIn) > 0 && Number(pStartingChips) > 0 && (
                <div style={{
                  background: 'var(--bg-secondary)', borderRadius: 8, padding: '8px 12px',
                  border: '1px solid var(--border-color)', marginTop: 8, fontSize: 12,
                  color: 'var(--text-secondary)',
                }}>
                  💡 Each chip = <strong>{(Number(pBuyIn) / Number(pStartingChips)).toFixed(6)} {pCurrency}</strong>
                  {' • '}90% of total pot paid to winners • 10% house cut
                </div>
              )}

              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="submit" className="btn btn-primary" disabled={!pTitle}>
                  Create Poker Event
                </button>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {!pTitle ? 'Enter a title' : '✅ Ready'}
                </span>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  How Events Work                                              */}
      {/* ============================================================ */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <div className="card-title">How DCB Events Work</div>
        </div>
        <div style={{ padding: '4px 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24 }}>
            <div>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: 8, fontSize: 14 }}>🗳️ Vote Events</h4>
              <p><strong>1. Create</strong> — Upload images, set a prize pool, and secretly nominate your winning image.</p>
              <p><strong>2. Publish</strong> — An interactive Discord post is sent with image thumbnails and vote buttons.</p>
              <p><strong>3. Participate</strong> — Members click <em>Join Event</em> then vote for their favorite image.</p>
              <p><strong>4. Auto-start</strong> — Once all seats fill, voting locks automatically.</p>
              <p><strong>5. Instant Payouts</strong> — Winners who matched your pick get paid from the treasury. 💰</p>
            </div>
            <div>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: 8, fontSize: 14 }}>🏇 Horse Race</h4>
              <p><strong>1. Create</strong> — Set up horses, choose house-funded or pot-split mode, and set rider limits.</p>
              <p><strong>2. Publish</strong> — An interactive Discord post is sent with horse buttons.</p>
              <p><strong>3. Bet</strong> — Riders click a horse button to pick their horse.</p>
              <p><strong>4. Race</strong> — An animated horse race plays in Discord! 🏇</p>
              <p><strong>5. Instant Payouts</strong> — The winning horse crosses first and riders split the prize. 💰</p>
              <p style={{ marginTop: 8 }}>🏠 <strong>House-funded</strong> — Fixed prize from treasury.</p>
              <p>🏦 <strong>Pot Split</strong> — Entry fees pooled, winners split.</p>
            </div>
            <div>
              <h4 style={{ color: 'var(--text-primary)', marginBottom: 8, fontSize: 14 }}>🃏 Poker</h4>
              <p><strong>1. Create</strong> — Set blinds, buy-in, and table size. Choose pot or casual mode.</p>
              <p><strong>2. Publish</strong> — An interactive Discord post is sent with a Join Table button.</p>
              <p><strong>3. Join</strong> — Players click Join and pay the SOL buy-in (pot mode).</p>
              <p><strong>4. Play</strong> — Full Texas Hold'em — bet, call, raise, bluff, and go all-in! 🃏</p>
              <p><strong>5. Payouts</strong> — When the table closes, chips convert to SOL. 90% paid to winners. 💰</p>
              <p style={{ marginTop: 8 }}>🏦 <strong>Pot mode</strong> — Real SOL buy-in, winner-takes-most.</p>
              <p>🎮 <strong>Casual</strong> — Play money, just for fun.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
