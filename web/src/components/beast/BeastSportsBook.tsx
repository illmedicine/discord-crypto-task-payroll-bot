import React, { useState, useEffect } from 'react'
import api from '../../api'

interface Props {
  guildId: string
  balance: { sol: number; usdc: number; usd: number }
  onBalanceChange?: (newBal: { sol: number; usdc: number; usd: number }) => void
}

interface SportEvent {
  id: string
  sport: string
  league: string
  homeTeam: string
  awayTeam: string
  homeOdds: number
  drawOdds: number | null
  awayOdds: number
  startTime: string
  status: 'upcoming' | 'live' | 'finished'
  homeScore?: number
  awayScore?: number
}

type Sport = 'all' | 'football' | 'basketball' | 'baseball' | 'soccer' | 'mma' | 'esports'

const SPORTS: { id: Sport; label: string; icon: string }[] = [
  { id: 'all', label: 'All Sports', icon: '🏆' },
  { id: 'football', label: 'Football', icon: '🏈' },
  { id: 'basketball', label: 'Basketball', icon: '🏀' },
  { id: 'baseball', label: 'Baseball', icon: '⚾' },
  { id: 'soccer', label: 'Soccer', icon: '⚽' },
  { id: 'mma', label: 'MMA / UFC', icon: '🥊' },
  { id: 'esports', label: 'Esports', icon: '🎮' },
]

export default function BeastSportsBook({ guildId, balance, onBalanceChange }: Props) {
  const [sport, setSport] = useState<Sport>('all')
  const [events, setEvents] = useState<SportEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [betSlip, setBetSlip] = useState<Array<{ eventId: string; pick: 'home' | 'draw' | 'away'; odds: number; event: SportEvent }>>([])
  const [betAmount, setBetAmount] = useState('5')
  const [currency, setCurrency] = useState<'SOL' | 'USDC' | 'USD'>('USDC')
  const [placing, setPlacing] = useState(false)
  const [betResult, setBetResult] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'upcoming' | 'live'>('upcoming')

  useEffect(() => {
    setLoading(true)
    api.get(`/beast/sports/events?sport=${sport}&status=${viewMode}`)
      .then(r => setEvents(r.data || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [sport, viewMode])

  const filteredEvents = events.filter(e => {
    if (sport !== 'all' && e.sport !== sport) return false
    if (viewMode === 'live') return e.status === 'live'
    return e.status === 'upcoming'
  })

  const addToBetSlip = (event: SportEvent, pick: 'home' | 'draw' | 'away') => {
    // Remove if same event already in slip
    const existing = betSlip.findIndex(b => b.eventId === event.id)
    if (existing >= 0) {
      if (betSlip[existing].pick === pick) {
        setBetSlip(betSlip.filter((_, i) => i !== existing))
        return
      }
      const newSlip = [...betSlip]
      newSlip[existing] = { eventId: event.id, pick, odds: pick === 'home' ? event.homeOdds : pick === 'draw' ? (event.drawOdds || 0) : event.awayOdds, event }
      setBetSlip(newSlip)
      return
    }
    const odds = pick === 'home' ? event.homeOdds : pick === 'draw' ? (event.drawOdds || 0) : event.awayOdds
    setBetSlip([...betSlip, { eventId: event.id, pick, odds, event }])
  }

  const isSelected = (eventId: string, pick: string) => {
    return betSlip.some(b => b.eventId === eventId && b.pick === pick)
  }

  const totalOdds = betSlip.reduce((acc, b) => acc * b.odds, 1)
  const potentialWin = parseFloat(betAmount) * totalOdds

  const placeBet = async () => {
    if (betSlip.length === 0 || !betAmount) return
    setPlacing(true)
    setBetResult(null)
    try {
      const r = await api.post('/beast/sports/bet', {
        bets: betSlip.map(b => ({ eventId: b.eventId, pick: b.pick, odds: b.odds })),
        amount: parseFloat(betAmount),
        currency,
      })
      setBetResult('✅ Bet placed successfully!')
      setBetSlip([])
      if (r.data?.balance && onBalanceChange) onBalanceChange(r.data.balance)
    } catch (err: any) {
      setBetResult(err?.response?.data?.error || 'Failed to place bet')
    } finally {
      setPlacing(false)
    }
  }

  return (
    <div className="beast-sports">
      {/* Sport Categories */}
      <div className="beast-sports-sidebar">
        {SPORTS.map(s => (
          <button
            key={s.id}
            className={`beast-sport-btn ${sport === s.id ? 'active' : ''}`}
            onClick={() => setSport(s.id)}
          >
            <span>{s.icon}</span> {s.label}
          </button>
        ))}
      </div>

      {/* Main Events Area */}
      <div className="beast-sports-main">
        <div className="beast-sports-tabs">
          <button
            className={`beast-sports-tab ${viewMode === 'upcoming' ? 'active' : ''}`}
            onClick={() => setViewMode('upcoming')}
          >
            📅 Upcoming
          </button>
          <button
            className={`beast-sports-tab ${viewMode === 'live' ? 'active' : ''}`}
            onClick={() => setViewMode('live')}
          >
            <span className="beast-live-dot" /> Live
          </button>
        </div>

        {loading ? (
          <div className="beast-loading">Loading events...</div>
        ) : filteredEvents.length === 0 ? (
          <div className="beast-empty">No {viewMode} events for {sport === 'all' ? 'any sport' : sport}</div>
        ) : (
          <div className="beast-events-list">
            {filteredEvents.map(event => (
              <div key={event.id} className={`beast-event-card ${event.status === 'live' ? 'live' : ''}`}>
                <div className="beast-event-info">
                  <div className="beast-event-league">{event.league}</div>
                  <div className="beast-event-time">
                    {event.status === 'live' ? (
                      <span className="beast-event-live">🔴 LIVE</span>
                    ) : (
                      new Date(event.startTime).toLocaleString()
                    )}
                  </div>
                </div>
                <div className="beast-event-matchup">
                  <div className="beast-event-team">{event.homeTeam}</div>
                  {event.status === 'live' && (
                    <div className="beast-event-score">{event.homeScore} - {event.awayScore}</div>
                  )}
                  {event.status !== 'live' && <div className="beast-event-vs">VS</div>}
                  <div className="beast-event-team">{event.awayTeam}</div>
                </div>
                <div className="beast-event-odds">
                  <button
                    className={`beast-odds-btn ${isSelected(event.id, 'home') ? 'selected' : ''}`}
                    onClick={() => addToBetSlip(event, 'home')}
                  >
                    <span className="beast-odds-label">Home</span>
                    <span className="beast-odds-value">{event.homeOdds.toFixed(2)}</span>
                  </button>
                  {event.drawOdds !== null && (
                    <button
                      className={`beast-odds-btn ${isSelected(event.id, 'draw') ? 'selected' : ''}`}
                      onClick={() => addToBetSlip(event, 'draw')}
                    >
                      <span className="beast-odds-label">Draw</span>
                      <span className="beast-odds-value">{event.drawOdds.toFixed(2)}</span>
                    </button>
                  )}
                  <button
                    className={`beast-odds-btn ${isSelected(event.id, 'away') ? 'selected' : ''}`}
                    onClick={() => addToBetSlip(event, 'away')}
                  >
                    <span className="beast-odds-label">Away</span>
                    <span className="beast-odds-value">{event.awayOdds.toFixed(2)}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bet Slip */}
      <div className="beast-betslip">
        <h3>🎫 Bet Slip ({betSlip.length})</h3>
        {betSlip.length === 0 ? (
          <div className="beast-betslip-empty">Click odds to add selections</div>
        ) : (
          <>
            {betSlip.map((bet, i) => (
              <div key={i} className="beast-betslip-item">
                <div className="beast-betslip-match">
                  {bet.event.homeTeam} vs {bet.event.awayTeam}
                </div>
                <div className="beast-betslip-pick">
                  {bet.pick === 'home' ? bet.event.homeTeam : bet.pick === 'away' ? bet.event.awayTeam : 'Draw'} @ {bet.odds.toFixed(2)}
                </div>
                <button className="beast-betslip-remove" onClick={() => setBetSlip(betSlip.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}

            <div className="beast-betslip-total">
              <span>Total Odds:</span>
              <span>{totalOdds.toFixed(2)}</span>
            </div>

            <div className="beast-betslip-amount">
              <select value={currency} onChange={e => setCurrency(e.target.value as any)} className="beast-bet-select">
                <option value="SOL">SOL</option>
                <option value="USDC">USDC</option>
                <option value="USD">USD</option>
              </select>
              <input
                type="number"
                value={betAmount}
                onChange={e => setBetAmount(e.target.value)}
                className="beast-bet-input"
                min={0.01}
                step={0.01}
              />
            </div>

            <div className="beast-betslip-payout">
              Potential Win: <strong>${potentialWin.toFixed(2)} {currency}</strong>
            </div>

            <button className="beast-place-bet-btn" onClick={placeBet} disabled={placing}>
              {placing ? 'Placing...' : `Place Bet ($${parseFloat(betAmount).toFixed(2)} ${currency})`}
            </button>

            {betResult && <div className="beast-betslip-result">{betResult}</div>}
          </>
        )}
      </div>
    </div>
  )
}
