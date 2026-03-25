import React, { useState, useEffect, useRef } from 'react'
import api from '../../api'

interface WinEntry {
  username: string
  game: string
  amount: number
  multiplier: number
  currency: string
  time: string
}

interface Stats {
  treasury_sol: number
  treasury_usd: number
  total_wagered: number
  total_wagered_usd: number
  total_payouts: number
  total_payouts_usd: number
  total_bets: number
  total_wins: number
  sol_price: number
  recent_wins: WinEntry[]
}

const GAME_NAMES: Record<string, string> = {
  'coin-flip': 'Coin Flip', 'dice': 'Dice', 'limbo': 'Limbo', 'mines': 'Mines',
  'plinko': 'Plinko', 'keno': 'Keno', 'crash': 'Crash', 'hilo': 'Hi-Lo',
  'wheel': 'Wheel', 'tower': 'Tower', 'lamb-chop': 'Lamb Chop', 'ice-fishing': 'Ice Fishing',
  'duck-hunters': 'Duck Hunters', 'omaha-flip': 'Omaha Flip', 'coin-race': 'Coin Race',
  'beast-fortune': 'Beast Fortune', 'blackjack': 'Blackjack', 'roulette': 'Roulette',
  'baccarat': 'Baccarat', 'lightning-roulette': 'Lightning Roulette',
  'live-blackjack': 'Live Blackjack', 'live-roulette': 'Live Roulette',
  'live-baccarat': 'Live Baccarat', 'game-shows': 'Game Shows',
}

export default function BeastLiveWins() {
  const [stats, setStats] = useState<Stats | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchStats = () => {
    api.get('/beast/stats').then(r => setStats(r.data)).catch(() => {})
  }

  useEffect(() => {
    fetchStats()
    const id = setInterval(fetchStats, 20000)
    return () => clearInterval(id)
  }, [])

  // Auto-scroll the wins ticker
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stats?.recent_wins?.length) return
    let animId: number
    let pos = 0
    const speed = 0.5

    const animate = () => {
      pos += speed
      if (pos >= el.scrollWidth / 2) pos = 0
      el.scrollLeft = pos
      animId = requestAnimationFrame(animate)
    }
    animId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animId)
  }, [stats?.recent_wins])

  const fmt = (n: number, d = 2) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toFixed(d)

  return (
    <div className="beast-ticker-wrap">
      {/* Stats Bar */}
      <div className="beast-stats-bar">
        <div className="beast-stat-pill">
          <span className="beast-stat-icon">🏦</span>
          <span className="beast-stat-label">Treasury</span>
          <span className="beast-stat-val green">
            {stats ? `${fmt(stats.treasury_sol, 4)} SOL` : '—'}
            {stats && stats.treasury_usd > 0 && <span className="beast-stat-usd"> ≈ ${fmt(stats.treasury_usd)}</span>}
          </span>
        </div>
        <div className="beast-stat-divider" />
        <div className="beast-stat-pill">
          <span className="beast-stat-icon">💸</span>
          <span className="beast-stat-label">Payouts</span>
          <span className="beast-stat-val gold">
            {stats ? `${fmt(stats.total_payouts, 4)} SOL` : '—'}
            {stats && stats.total_payouts_usd > 0 && <span className="beast-stat-usd"> ≈ ${fmt(stats.total_payouts_usd)}</span>}
          </span>
        </div>
        <div className="beast-stat-divider" />
        <div className="beast-stat-pill">
          <span className="beast-stat-icon">🎰</span>
          <span className="beast-stat-label">Wagered</span>
          <span className="beast-stat-val purple">
            {stats ? `${fmt(stats.total_wagered, 4)} SOL` : '—'}
            {stats && stats.total_wagered_usd > 0 && <span className="beast-stat-usd"> ≈ ${fmt(stats.total_wagered_usd)}</span>}
          </span>
        </div>
        <div className="beast-stat-divider" />
        <div className="beast-stat-pill">
          <span className="beast-stat-icon">🎲</span>
          <span className="beast-stat-label">Games</span>
          <span className="beast-stat-val">{stats ? stats.total_bets.toLocaleString() : '—'}</span>
        </div>
        <div className="beast-stat-divider" />
        <div className="beast-stat-pill">
          <span className="beast-stat-icon">🏆</span>
          <span className="beast-stat-label">Wins</span>
          <span className="beast-stat-val green">{stats ? stats.total_wins.toLocaleString() : '—'}</span>
        </div>
      </div>

      {/* Wins Scroll Ticker */}
      {stats?.recent_wins && stats.recent_wins.length > 0 && (
        <div className="beast-live-wins">
          <div className="beast-live-wins-label">
            <span className="beast-live-dot" />
            LIVE PAYOUTS
          </div>
          <div className="beast-live-wins-scroll" ref={scrollRef}>
            {[...stats.recent_wins, ...stats.recent_wins].map((win, i) => (
              <div key={`w-${i}`} className="beast-live-win-item">
                <span className="beast-live-win-user">🎮 {win.username || 'Player'}</span>
                <span className="beast-live-win-game">{GAME_NAMES[win.game] || win.game}</span>
                <span className={`beast-live-win-amount ${win.multiplier >= 10 ? 'big' : ''}`}>
                  +{win.amount.toFixed(4)} {win.currency}
                  {win.multiplier >= 2 && <span className="beast-live-win-multi"> {win.multiplier}x</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
