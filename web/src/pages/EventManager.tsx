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
type GamblingEventBet = {
  user_id: string
  username: string | null
  chosen_slot: number
  bet_amount: number
  is_winner: number
  payment_status: string
  joined_at: string
  entry_tx_signature: string | null
  payout_tx_signature: string | null
}

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
  winner_names: string | null
  status: string
  channel_id: string
  message_id: string | null
  qualification_url: string | null
  ends_at: string | null
  created_at: string
  bets?: GamblingEventBet[]
}

type SlotEntry = { label: string; color: string }

/* --- Poker Event types --- */
type PokerEventPlayer = {
  user_id: string
  username: string | null
  buy_in_amount: number
  final_chips: number
  payout_amount: number
  payment_status: string
  entry_tx_signature: string | null
  payout_tx_signature: string | null
}

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
  players?: PokerEventPlayer[]
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
  const [vCurrency, setVCurrency] = useState('USD')
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
  const [rCurrency, setRCurrency] = useState('USD')
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
  const [pCurrency, setPCurrency] = useState('USD')
  const [pSmallBlind, setPSmallBlind] = useState('5')
  const [pBigBlind, setPBigBlind] = useState('10')
  const [pStartingChips, setPStartingChips] = useState('1000')
  const [pMaxPlayers, setPMaxPlayers] = useState('6')
  const [pTurnTimer, setPTurnTimer] = useState('30')

  /* ---- poker publish ---- */
  const [pPublishChannelId, setPPublishChannelId] = useState('')
  const [pPublishing, setPPublishing] = useState<number | null>(null)

  /* ---- filter & collapse state ---- */
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'cancelled'>('active')
  const [vShowAll, setVShowAll] = useState(false)
  const [rShowAll, setRShowAll] = useState(false)
  const [pShowAll, setPShowAll] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  /* ---- Prestige badges ---- */
  const [prestigeMap, setPrestigeMap] = useState<Record<string, { score: number; tier: string; config: { emoji: string; title: string; color: string }; beast_linked?: boolean }>>({})

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
      // Auto-populate default titles & descriptions from last event (with incremented number)
      function nextTitle(events: any[], fallback: string) {
        if (events.length) {
          const last = events[events.length - 1]
          const m = last.title?.match(/^(.+?)\s*#(\d+)\s*$/)
          if (m) return `${m[1]} #${Number(m[2]) + 1}`
          return `${last.title || fallback} #${events.length + 1}`
        }
        return `${fallback} #1`
      }
      const veList = veRes.data || []
      const geList = geRes.data || []
      const peList = peRes.data || []
      setVTitle(nextTitle(veList, 'Guess my favorite picture'))
      setVDescription(veList.length ? veList[veList.length - 1].description || 'Vote for your favorite picture to win!' : 'Vote for your favorite picture to win!')
      setRTitle(nextTitle(geList, 'Illy-Kentucky Derby'))
      setRDescription(geList.length ? geList[geList.length - 1].description || 'Pick your horse and place your bets!' : 'Pick your horse and place your bets!')
      setPTitle(nextTitle(peList, 'Illy-Poker'))
      setPDescription(peList.length ? peList[peList.length - 1].description || 'Pot-split Texas Hold\'em poker night' : 'Pot-split Texas Hold\'em poker night')
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

  /* ---- Load prestige leaderboard for participant badges ---- */
  useEffect(() => {
    if (!guildId) return
    api.get(`/admin/guilds/${guildId}/prestige-leaderboard`)
      .then(r => {
        const map: typeof prestigeMap = {}
        for (const u of (r.data || [])) map[u.user_id] = u
        setPrestigeMap(map)
      })
      .catch(() => {})
  }, [guildId])

  /* ---- Sync createType with selected tab ---- */
  useEffect(() => {
    if (tab === 'vote' || tab === 'race' || tab === 'poker') setCreateType(tab)
  }, [tab])

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

  /* ---- Bulk delete inactive race events ---- */
  const handleBulkDeleteInactiveRaces = async () => {
    const staleEvents = raceEvents.filter(e => e.status === 'active' && e.ends_at && new Date(e.ends_at) < new Date())
    const staleNoTimer = raceEvents.filter(e => e.status === 'active' && !e.ends_at && !e.message_id)
    const toDelete = [...staleEvents, ...staleNoTimer]
    if (toDelete.length === 0) {
      alert('No stale events to clean up.')
      return
    }
    if (!confirm(`Delete ${toDelete.length} stale/expired race event(s)? This cannot be undone.`)) return
    setBulkDeleting(true)
    try {
      for (const ev of toDelete) {
        await api.delete(`/admin/guilds/${guildId}/gambling-events/${ev.id}`)
      }
      await load()
    } catch {
      alert('Some deletions may have failed.')
    }
    setBulkDeleting(false)
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
    try {
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
    } catch (err: any) {
      const detail = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Unknown error'
      alert(`Failed to create poker event: ${detail}`)
    }
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
  const totalVoteCompleted = voteEvents.filter(e => e.status === 'completed' || e.status === 'ended').length
  const totalRaceCompleted = raceEvents.filter(e => e.status === 'completed' || e.status === 'ended').length
  const totalPokerCompleted = pokerEvents.filter(e => e.status === 'completed' || e.status === 'ended').length
  const totalVoteCancelled = voteEvents.filter(e => e.status === 'cancelled').length
  const totalRaceCancelled = raceEvents.filter(e => e.status === 'cancelled').length
  const totalPokerCancelled = pokerEvents.filter(e => e.status === 'cancelled').length
  const totalEvents = voteEvents.length + raceEvents.length + pokerEvents.length
  const totalActive = totalVoteActive + totalRaceActive + totalPokerActive
  const totalCompleted = totalVoteCompleted + totalRaceCompleted + totalPokerCompleted
  const totalCancelled = totalVoteCancelled + totalRaceCancelled + totalPokerCancelled

  /* ---- Filtered & sliced event lists ---- */
  const VISIBLE_LIMIT = 10
  const filterFn = (e: { status: string }) => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'active') return e.status === 'active'
    if (statusFilter === 'completed') return e.status === 'completed' || e.status === 'ended'
    if (statusFilter === 'cancelled') return e.status === 'cancelled'
    return true
  }
  const vFiltered = voteEvents.filter(filterFn)
  const rFiltered = raceEvents.filter(filterFn)
  const pFiltered = pokerEvents.filter(filterFn)
  const vVisible = vShowAll ? vFiltered : vFiltered.slice(0, VISIBLE_LIMIT)
  const rVisible = rShowAll ? rFiltered : rFiltered.slice(0, VISIBLE_LIMIT)
  const pVisible = pShowAll ? pFiltered : pFiltered.slice(0, VISIBLE_LIMIT)

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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>
          Create and manage all events — photo-voting challenges, horse race betting, and poker tables — from one place.
        </p>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Show:</span>
          <select className="form-select" style={{ width: 160, fontSize: 12 }} value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as 'all' | 'active' | 'completed' | 'cancelled')}>
            <option value="active">🟢 Active ({totalActive})</option>
            <option value="completed">✅ Completed ({totalCompleted})</option>
            <option value="cancelled">🚫 Cancelled ({totalCancelled})</option>
            <option value="all">📋 All Events ({totalEvents})</option>
          </select>
        </div>
      </div>

      {/* ---- Summary bar ---- */}
      <div className="em-summary-bar">
        <div className="em-stat" style={{ cursor: 'pointer', opacity: statusFilter === 'all' ? 1 : 0.6 }} onClick={() => setStatusFilter('all')}>
          <span className="em-stat-value">{totalEvents}</span>
          <span className="em-stat-label">Total</span>
        </div>
        <div className="em-stat" style={{ cursor: 'pointer', opacity: statusFilter === 'active' ? 1 : 0.6 }} onClick={() => setStatusFilter('active')}>
          <span className="em-stat-value em-stat-active">{totalActive}</span>
          <span className="em-stat-label">🟢 Active</span>
        </div>
        <div className="em-stat" style={{ cursor: 'pointer', opacity: statusFilter === 'completed' ? 1 : 0.6 }} onClick={() => setStatusFilter('completed')}>
          <span className="em-stat-value" style={{ color: '#27ae60' }}>{totalCompleted}</span>
          <span className="em-stat-label">✅ Completed</span>
        </div>
        <div className="em-stat" style={{ cursor: 'pointer', opacity: statusFilter === 'cancelled' ? 1 : 0.6 }} onClick={() => setStatusFilter('cancelled')}>
          <span className="em-stat-value" style={{ color: '#888' }}>{totalCancelled}</span>
          <span className="em-stat-label">🚫 Cancelled</span>
        </div>
      </div>

      {/* ---- Filter tabs ---- */}
      <div className="em-tabs">
        <button className={`em-tab em-tab-all ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
          <span className="em-tab-icon">🎯</span>
          <span className="em-tab-label">All Events</span>
          <span className="em-tab-count">{totalEvents}</span>
        </button>
        <button className={`em-tab em-tab-vote ${tab === 'vote' ? 'active' : ''}`} onClick={() => setTab('vote')}>
          <span className="em-tab-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="4" height="9" rx="1" fill="currentColor" opacity="0.5"/><rect x="10" y="6" width="4" height="14" rx="1" fill="currentColor" opacity="0.75"/><rect x="17" y="3" width="4" height="17" rx="1" fill="currentColor"/><path d="M5 9l5-4 4 2 5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/></svg>
          </span>
          <span className="em-tab-label">Vote Events</span>
          <span className="em-tab-count">{voteEvents.length}</span>
        </button>
        <button className={`em-tab em-tab-poker ${tab === 'poker' ? 'active' : ''}`} onClick={() => setTab('poker')}>
          <span className="em-tab-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3C12 3 8 8 8 12c0 2.2 1.8 4 4 4s4-1.8 4-4c0-4-4-9-4-9z" fill="currentColor" opacity="0.3"/><rect x="4" y="2" width="7" height="10" rx="1.5" transform="rotate(-10 4 2)" stroke="currentColor" strokeWidth="1.3" fill="none"/><rect x="13" y="2" width="7" height="10" rx="1.5" transform="rotate(10 20 2)" stroke="currentColor" strokeWidth="1.3" fill="none"/><circle cx="7.5" cy="6" r="1" fill="currentColor"/><circle cx="16.5" cy="6" r="1" fill="currentColor"/><path d="M7 18h10M9 21h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.5"/></svg>
          </span>
          <span className="em-tab-label">Poker</span>
          <span className="em-tab-count">{pokerEvents.length}</span>
        </button>
        <button className={`em-tab em-tab-race ${tab === 'race' ? 'active' : ''}`} onClick={() => setTab('race')}>
          <span className="em-tab-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 20L8 10l4 6 4-8 4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3" fill="currentColor" opacity="0.3"/><path d="M15 4l1.5 3H13.5L15 4z" fill="currentColor" opacity="0.6"/><path d="M3 20h18" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.3"/></svg>
          </span>
          <span className="em-tab-label">Horse Race</span>
          <span className="em-tab-count">{raceEvents.length}</span>
        </button>
      </div>

      {/* ============================================================ */}
      {/*  CREATE EVENT FORM (owner only)                               */}
      {/* ============================================================ */}
      {isOwner && statusFilter === 'active' && (tab === 'all' || tab === 'vote' || tab === 'race' || tab === 'poker') && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <div className="card-title">Create New Event</div>
            {tab === 'all' && (
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
            )}
            {tab !== 'all' && (
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {tab === 'vote' ? '🗳️ Vote Event' : tab === 'race' ? '🏇 Horse Race' : '🃏 Poker'}
              </span>
            )}
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
                    <option value="USDC">USDC (stable)</option>
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
                    <option value="USDC">USDC (stable)</option>
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
                        <option value="USDC">USDC (stable)</option>
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
      {/*  VOTE EVENTS TABLE                                            */}
      {/* ============================================================ */}
      {(tab === 'all' || tab === 'vote') && (
        <div className="card em-section" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <div className="card-title">🗳️ Vote Events
              <span className="em-section-counts">
                <span className="em-count-active" style={{ cursor: 'pointer' }} onClick={() => setStatusFilter('active')}>{totalVoteActive} active</span>
                {totalVoteCompleted > 0 && <span className="em-count-past" style={{ cursor: 'pointer' }} onClick={() => setStatusFilter('completed')}>{totalVoteCompleted} completed</span>}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Publish to:</span>
              <select className="form-select" style={{ width: 160, fontSize: 12 }} value={vPublishChannelId} onChange={e => setVPublishChannelId(e.target.value)}>
                {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
          </div>

          {vFiltered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🗳️</div>
              <div className="empty-state-text">
                {statusFilter === 'active' && voteEvents.length > 0 ? `No active vote events. ${voteEvents.length} total — change filter to view.` :
                 statusFilter === 'completed' ? 'No completed vote events yet.' :
                 statusFilter === 'cancelled' ? 'No cancelled vote events.' :
                 'No vote events yet. Create one above.'}
              </div>
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
                {vVisible.map(ev => (
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
          {vFiltered.length > VISIBLE_LIMIT && (
            <button className="em-show-more" onClick={() => setVShowAll(!vShowAll)}>
              {vShowAll ? '▴ Show less' : `▾ Show all ${vFiltered.length} vote events`}
            </button>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  HORSE RACE EVENTS TABLE                                      */}
      {/* ============================================================ */}
      {(tab === 'all' || tab === 'race') && (
        <div className="card em-section" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <div className="card-title">🏇 Horse Race Events
              <span className="em-section-counts">
                <span className="em-count-active" style={{ cursor: 'pointer' }} onClick={() => setStatusFilter('active')}>{totalRaceActive} active</span>
                {totalRaceCompleted > 0 && <span className="em-count-past" style={{ cursor: 'pointer' }} onClick={() => setStatusFilter('completed')}>{totalRaceCompleted} completed</span>}
                {totalRaceCancelled > 0 && <span style={{ fontSize: 11, color: '#888', marginLeft: 8, cursor: 'pointer' }} onClick={() => setStatusFilter('cancelled')}>{totalRaceCancelled} cancelled</span>}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {isOwner && (
                <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }}
                        disabled={bulkDeleting}
                        onClick={handleBulkDeleteInactiveRaces}>
                  {bulkDeleting ? '...' : '🧹 Clean Up Stale'}
                </button>
              )}
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Publish to:</span>
              <select className="form-select" style={{ width: 160, fontSize: 12 }} value={rPublishChannelId} onChange={e => setRPublishChannelId(e.target.value)}>
                {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
          </div>

          {rFiltered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🏇</div>
              <div className="empty-state-text">
                {statusFilter === 'active' && raceEvents.length > 0 ? `No active race events. ${raceEvents.length} total events — change filter to view.` :
                 statusFilter === 'completed' ? 'No completed race events yet.' :
                 statusFilter === 'cancelled' ? 'No cancelled race events.' :
                 'No horse race events yet. Create one above.'}
              </div>
            </div>
          ) : statusFilter === 'completed' || statusFilter === 'cancelled' ? (
            /* ── OTB-style results cards for completed/cancelled events ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0' }}>
              {rVisible.map(ev => (
                <div key={ev.id} style={{
                  background: 'var(--bg-secondary)', borderRadius: 10,
                  border: `1px solid ${ev.status === 'cancelled' ? '#555' : 'var(--accent-green)'}`,
                  padding: '14px 18px', position: 'relative', overflow: 'hidden',
                }}>
                  {/* Status ribbon */}
                  <div style={{
                    position: 'absolute', top: 0, right: 0,
                    background: ev.status === 'cancelled' ? '#555' : '#27ae60',
                    color: '#fff', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    padding: '3px 12px', borderBottomLeftRadius: 8,
                  }}>{ev.status}</div>

                  {/* Top row: ID, title, mode, prize */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>#{ev.id}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{ev.title}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{ev.mode === 'pot' ? '🏦 Pot' : '🏠 House'}</span>
                    <span className="sol-badge" style={{ fontSize: 11 }}>
                      {ev.mode === 'pot' ? `${ev.entry_fee} ${ev.currency}/bet` : `${ev.prize_amount} ${ev.currency}`}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>👥 {ev.current_players}/{ev.max_players}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatTimeAgo(ev.created_at)}</span>
                  </div>

                  {/* Winner section — prominent */}
                  {ev.status !== 'cancelled' && (
                    <div style={{
                      background: 'linear-gradient(135deg, rgba(241,196,15,0.12) 0%, rgba(39,174,96,0.10) 100%)',
                      borderRadius: 8, padding: '10px 14px', marginBottom: 6,
                      border: '1px solid rgba(241,196,15,0.25)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 22 }}>🏆</span>
                        <div>
                          {(() => {
                            const winnerText = ev.winner_names
                              || (ev.bets?.filter(b => b.is_winner).map(b => b.username || b.user_id).join(', '))
                              || null
                            if (winnerText) {
                              return <div style={{ fontSize: 15, fontWeight: 700, color: '#f1c40f' }}>{winnerText}</div>
                            }
                            if (ev.status === 'completed') {
                              return <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>House wins</div>
                            }
                            return <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Awaiting results...</div>
                          })()}
                          {ev.winning_slot && (
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                              Winning Horse: #{ev.winning_slot}
                            </div>
                          )}
                        </div>
                        {ev.mode === 'pot' && ev.current_players > 0 && (
                          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Prize Pool</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-green)' }}>
                              {(ev.entry_fee * ev.current_players * 0.9).toFixed(2)} {ev.currency}
                            </div>
                          </div>
                        )}
                        {ev.mode === 'house' && (
                          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Prize</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-green)' }}>
                              {ev.prize_amount} {ev.currency}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Participants list */}
                  {ev.bets && ev.bets.length > 0 && (
                    <div style={{ marginTop: 6, marginBottom: 6 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>
                        👥 Participants ({ev.bets.length})
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {ev.bets.map((b, i) => (
                          <span key={i} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 11, padding: '3px 8px', borderRadius: 6,
                            background: b.is_winner ? 'rgba(241,196,15,0.15)' : 'rgba(255,255,255,0.05)',
                            border: `1px solid ${b.is_winner ? 'rgba(241,196,15,0.3)' : 'rgba(255,255,255,0.08)'}`,
                            color: b.is_winner ? '#f1c40f' : 'var(--text-secondary)',
                          }}>
                            {b.is_winner ? '🏆' : '🏇'}{' '}
                            <span style={{ fontWeight: b.is_winner ? 700 : 400 }}>{b.username || b.user_id}</span>
                            {prestigeMap[b.user_id] && (
                              <span className={`prestige-chip prestige-badge-${prestigeMap[b.user_id].tier.toLowerCase()}`}>
                                {prestigeMap[b.user_id].config.emoji}{prestigeMap[b.user_id].tier}
                              </span>
                            )}
                            {prestigeMap[b.user_id]?.beast_linked && (
                              <span className="beast-linked-chip">🐾 Beast</span>
                            )}
                            <span style={{ opacity: 0.6 }}>→ #{b.chosen_slot}</span>
                            {b.bet_amount > 0 && <span style={{ opacity: 0.6 }}>({b.bet_amount} {ev.currency})</span>}
                            {b.payment_status && b.payment_status !== 'none' && (
                              <span style={{ fontSize: 10, opacity: 0.7 }}>
                                {b.payment_status === 'paid' || b.payment_status === 'committed' ? '✅' : b.payment_status === 'pending' ? '⏳' : '❌'}
                              </span>
                            )}
                            {b.payout_tx_signature && (
                              <a href={`https://solscan.io/tx/${b.payout_tx_signature}`} target="_blank" rel="noreferrer"
                                style={{ fontSize: 10, color: '#3498DB', textDecoration: 'none' }}>TX</a>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Cancelled reason */}
                  {ev.status === 'cancelled' && (
                    <div style={{ fontSize: 12, color: '#888', padding: '6px 0' }}>
                      🚫 This event was cancelled — {ev.current_players === 0 ? 'no players joined' : 'manually cancelled'}.
                    </div>
                  )}

                  {/* Bottom actions */}
                  {isOwner && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                      <button className="btn btn-danger btn-sm" style={{ fontSize: 11 }} onClick={() => handleDeleteRace(ev.id)}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* ── Active / All management table ── */
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
                {rVisible.map(ev => (
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
                      <td style={{ fontSize: 12 }}>{ev.winner_names ? `🏆 ${ev.winner_names}` : ev.winning_slot ? `🏆 Horse #${ev.winning_slot}` : '—'}</td>
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
                                  {ev.winning_slot && <div style={{ color: 'var(--accent-green)', fontWeight: 600 }}>🏆 Winning Horse: #{ev.winning_slot}</div>}
                                  {ev.winner_names && <div style={{ color: '#f1c40f', fontWeight: 600 }}>🏆 Winner(s): {ev.winner_names}</div>}
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

                            {/* Participants */}
                            {ev.bets && ev.bets.length > 0 && (
                              <div style={{ marginTop: 12, borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
                                <strong style={{ fontSize: 13 }}>👥 Participants ({ev.bets.length})</strong>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                                  {ev.bets.map((b, i) => (
                                    <span key={i} style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 4,
                                      fontSize: 11, padding: '3px 8px', borderRadius: 6,
                                      background: b.is_winner ? 'rgba(241,196,15,0.15)' : 'rgba(255,255,255,0.05)',
                                      border: `1px solid ${b.is_winner ? 'rgba(241,196,15,0.3)' : 'rgba(255,255,255,0.08)'}`,
                                      color: b.is_winner ? '#f1c40f' : 'var(--text-secondary)',
                                    }}>
                                      {b.is_winner ? '🏆' : '🏇'}{' '}
                                      <span style={{ fontWeight: b.is_winner ? 700 : 400 }}>{b.username || b.user_id}</span>
                                      {prestigeMap[b.user_id] && (
                                        <span className={`prestige-chip prestige-badge-${prestigeMap[b.user_id].tier.toLowerCase()}`}>
                                          {prestigeMap[b.user_id].config.emoji}{prestigeMap[b.user_id].tier}
                                        </span>
                                      )}
                                      {prestigeMap[b.user_id]?.beast_linked && (
                                        <span className="beast-linked-chip">🐾 Beast</span>
                                      )}
                                      <span style={{ opacity: 0.6 }}>→ #{b.chosen_slot}</span>
                                      {b.bet_amount > 0 && <span style={{ opacity: 0.6 }}>({b.bet_amount} {ev.currency})</span>}
                                      {b.payment_status && b.payment_status !== 'none' && (
                                        <span style={{ fontSize: 10, opacity: 0.7 }}>
                                          {b.payment_status === 'paid' || b.payment_status === 'committed' ? '✅' : b.payment_status === 'pending' ? '⏳' : '❌'}
                                        </span>
                                      )}
                                      {b.payout_tx_signature && (
                                        <a href={`https://solscan.io/tx/${b.payout_tx_signature}`} target="_blank" rel="noreferrer"
                                          style={{ fontSize: 10, color: '#3498DB', textDecoration: 'none' }}>TX</a>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

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
          {rFiltered.length > VISIBLE_LIMIT && (
            <button className="em-show-more" onClick={() => setRShowAll(!rShowAll)}>
              {rShowAll ? '▴ Show less' : `▾ Show all ${rFiltered.length} race events`}
            </button>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  POKER EVENTS TABLE                                           */}
      {/* ============================================================ */}
      {(tab === 'all' || tab === 'poker') && (
        <div className="card em-section" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <div className="card-title">🃏 Poker Events
              <span className="em-section-counts">
                <span className="em-count-active" style={{ cursor: 'pointer' }} onClick={() => setStatusFilter('active')}>{totalPokerActive} active</span>
                {totalPokerCompleted > 0 && <span className="em-count-past" style={{ cursor: 'pointer' }} onClick={() => setStatusFilter('completed')}>{totalPokerCompleted} completed</span>}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Publish to:</span>
              <select className="form-select" style={{ width: 160, fontSize: 12 }} value={pPublishChannelId} onChange={e => setPPublishChannelId(e.target.value)}>
                {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
          </div>

          {pFiltered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🃏</div>
              <div className="empty-state-text">
                {statusFilter === 'active' && pokerEvents.length > 0 ? `No active poker events. ${pokerEvents.length} total — change filter to view.` :
                 statusFilter === 'completed' ? 'No completed poker events yet.' :
                 statusFilter === 'cancelled' ? 'No cancelled poker events.' :
                 'No poker events yet. Create one above.'}
              </div>
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
                {pVisible.map(ev => (
                  <React.Fragment key={ev.id}>
                  <tr>
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
                  {ev.players && ev.players.length > 0 && (
                    <tr>
                      <td colSpan={9} style={{ padding: '4px 12px 8px', background: 'rgba(255,255,255,0.02)' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>
                          👥 Players ({ev.players.length})
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {ev.players.map((p, i) => (
                            <span key={i} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              fontSize: 11, padding: '3px 8px', borderRadius: 6,
                              background: p.payout_amount > 0 ? 'rgba(39,174,96,0.12)' : 'rgba(255,255,255,0.05)',
                              border: `1px solid ${p.payout_amount > 0 ? 'rgba(39,174,96,0.3)' : 'rgba(255,255,255,0.08)'}`,
                              color: p.payout_amount > 0 ? '#27AE60' : 'var(--text-secondary)',
                            }}>
                              {p.payout_amount > 0 ? '💰' : '🃏'}{' '}
                              <span style={{ fontWeight: p.payout_amount > 0 ? 700 : 400 }}>{p.username || p.user_id}</span>
                              {p.final_chips > 0 && <span style={{ opacity: 0.6 }}>{p.final_chips} chips</span>}
                              {p.payout_amount > 0 && <span style={{ opacity: 0.7 }}>→ {p.payout_amount.toFixed(4)} {ev.currency}</span>}
                              {p.payment_status && p.payment_status !== 'none' && (
                                <span style={{ fontSize: 10, opacity: 0.7 }}>
                                  {p.payment_status === 'paid' ? '✅' : p.payment_status === 'pending' ? '⏳' : p.payment_status === 'payout_failed' ? '❌' : ''}
                                </span>
                              )}
                              {p.payout_tx_signature && (
                                <a href={`https://solscan.io/tx/${p.payout_tx_signature}`} target="_blank" rel="noreferrer"
                                  style={{ fontSize: 10, color: '#3498DB', textDecoration: 'none' }}>TX</a>
                              )}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
          {pFiltered.length > VISIBLE_LIMIT && (
            <button className="em-show-more" onClick={() => setPShowAll(!pShowAll)}>
              {pShowAll ? '▴ Show less' : `▾ Show all ${pFiltered.length} poker events`}
            </button>
          )}
        </div>
      )}


      {/* ============================================================ */}
      {/*  How Events Work (collapsible)                                */}
      {/* ============================================================ */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header em-collapsible-header" onClick={() => setShowHowItWorks(!showHowItWorks)} style={{ cursor: 'pointer' }}>
          <div className="card-title">
            <span className="em-collapse-arrow">{showHowItWorks ? '▾' : '▸'}</span>
            How DCB Events Work
          </div>
          {!showHowItWorks && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Click to expand</span>}
        </div>
        {showHowItWorks && <div style={{ padding: '4px 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
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
        </div>}
      </div>
    </div>
  )
}
