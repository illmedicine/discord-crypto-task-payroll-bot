import React, { useState, useEffect, useRef } from 'react'
import api from '../../api'

interface LiveWin {
  id: string
  username: string
  game: string
  amount: number
  multiplier: number
  currency: string
  timestamp: number
}

export default function BeastLiveWins() {
  const [wins, setWins] = useState<LiveWin[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Fetch recent wins
    api.get('/beast/live-wins')
      .then(r => setWins(r.data || []))
      .catch(() => {
        // Fallback demo wins
        setWins([
          { id: '1', username: 'Player123', game: 'Coin Flip', amount: 19, multiplier: 2, currency: 'USDC', timestamp: Date.now() - 5000 },
          { id: '2', username: 'CryptoKing', game: 'Dice', amount: 45, multiplier: 3.5, currency: 'SOL', timestamp: Date.now() - 12000 },
          { id: '3', username: 'LuckyDraw', game: 'Limbo', amount: 120, multiplier: 10, currency: 'USDC', timestamp: Date.now() - 18000 },
          { id: '4', username: 'BeastMode', game: 'Crash', amount: 250, multiplier: 25, currency: 'SOL', timestamp: Date.now() - 30000 },
          { id: '5', username: 'SolWhale', game: 'Mines', amount: 88, multiplier: 5.2, currency: 'USDC', timestamp: Date.now() - 42000 },
          { id: '6', username: 'FlipMaster', game: 'Blackjack', amount: 75, multiplier: 2, currency: 'USD', timestamp: Date.now() - 55000 },
          { id: '7', username: 'DiceRoll', game: 'Roulette', amount: 500, multiplier: 36, currency: 'SOL', timestamp: Date.now() - 67000 },
          { id: '8', username: 'GamblerX', game: 'Plinko', amount: 30, multiplier: 8, currency: 'USDC', timestamp: Date.now() - 80000 },
        ])
      })

    // Poll for new wins
    const id = setInterval(() => {
      api.get('/beast/live-wins').then(r => setWins(r.data || [])).catch(() => {})
    }, 15000)
    return () => clearInterval(id)
  }, [])

  // Auto-scroll animation
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
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
  }, [wins])

  if (wins.length === 0) return null

  return (
    <div className="beast-live-wins">
      <div className="beast-live-wins-label">
        <span className="beast-live-dot" />
        LIVE WINS
      </div>
      <div className="beast-live-wins-scroll" ref={scrollRef}>
        {/* Duplicate for infinite scroll */}
        {[...wins, ...wins].map((win, i) => (
          <div key={`${win.id}-${i}`} className="beast-live-win-item">
            <div className="beast-live-win-game">{win.game}</div>
            <div className="beast-live-win-user">{win.username}</div>
            <div className={`beast-live-win-amount ${win.multiplier >= 10 ? 'big' : ''}`}>
              {win.multiplier >= 10 && <span className="beast-live-win-multi">{win.multiplier}x</span>}
              ${win.amount.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
