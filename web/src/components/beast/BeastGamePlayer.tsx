import React, { useState, useCallback, useEffect } from 'react'
import api from '../../api'

interface Game {
  id: string
  name: string
  category: string
  img: string
  desc: string
  houseEdge: number
  minBet: number
  maxBet: number
}

interface Props {
  game: Game
  balance: { sol: number; usdc: number; usd: number }
  onBalanceChange: (newBal: { sol: number; usdc: number; usd: number }) => void
}

type Currency = 'SOL' | 'USDC' | 'USD'

/**
 * Game player UI – renders the interactive game canvas for each game type.
 * Uses a provably-fair RNG system seeded server-side.
 */
export default function BeastGamePlayer({ game, balance, onBalanceChange }: Props) {
  const [betAmount, setBetAmount] = useState(game.minBet.toString())
  const [currency, setCurrency] = useState<Currency>('USDC')
  const [playing, setPlaying] = useState(false)
  const [result, setResult] = useState<{ won: boolean; payout: number; multiplier: number; details: string } | null>(null)
  const [history, setHistory] = useState<Array<{ won: boolean; payout: number; multiplier: number; timestamp: number }>>([])
  const [autoPlay, setAutoPlay] = useState(false)
  const [autoCount, setAutoCount] = useState(0)

  // Treasury limits
  const [treasuryLimits, setTreasuryLimits] = useState<{ sol: number; usdc: number; usd: number } | null>(null)

  useEffect(() => {
    api.get('/beast/treasury/max-payout')
      .then(r => setTreasuryLimits(r.data))
      .catch(() => {})
  }, [])

  const getMaxMultiplier = () => {
    switch (game.id) {
      case 'coin-flip': return 1.94
      case 'dice': return parseFloat((99 / (diceTarget - 1)).toFixed(2))
      case 'limbo': return limboTarget
      case 'crash': return crashMulti
      case 'mines': { const ss = 25 - minesCount; return parseFloat((25 / ss * (1 + ss * 0.2)).toFixed(2)) }
      case 'plinko': return 5
      case 'keno': return 500
      case 'hilo': return 1.9
      case 'wheel': return 10
      case 'tower': return parseFloat(Math.pow(1.4, 10).toFixed(2))
      case 'blackjack': return 2.5
      case 'roulette': return 2
      case 'lightning-roulette': return 36
      case 'baccarat': return 8
      default: return 11
    }
  }

  const getDynamicMaxBet = () => {
    if (!treasuryLimits) return game.maxBet
    const tBal = currency === 'SOL' ? treasuryLimits.sol : currency === 'USDC' ? treasuryLimits.usdc : treasuryLimits.usd
    const treasuryMax = parseFloat((tBal / getMaxMultiplier()).toFixed(6))
    return Math.max(0, Math.min(game.maxBet, treasuryMax))
  }

  const dynamicMaxBet = getDynamicMaxBet()

  // Game-specific state
  const [diceTarget, setDiceTarget] = useState(50) // for dice
  const [minesCount, setMinesCount] = useState(3)   // for mines
  const [coinSide, setCoinSide] = useState<'heads' | 'tails'>('heads') // for coin flip
  const [crashMulti, setCrashMulti] = useState(2)   // for crash auto-cashout
  const [limboTarget, setLimboTarget] = useState(2)  // for limbo

  const getAvailableBalance = () => {
    if (currency === 'SOL') return balance.sol
    if (currency === 'USDC') return balance.usdc
    return balance.usd
  }

  const placeBet = useCallback(async () => {
    const bet = parseFloat(betAmount)
    if (isNaN(bet) || bet < game.minBet || bet > dynamicMaxBet) return
    if (bet > getAvailableBalance()) return

    setPlaying(true)
    setResult(null)
    try {
      const payload: Record<string, any> = { gameId: game.id, betAmount: bet, currency }
      // Add game-specific params
      if (game.id === 'dice') payload.target = diceTarget
      if (game.id === 'mines') payload.minesCount = minesCount
      if (game.id === 'coin-flip') payload.side = coinSide
      if (game.id === 'crash') payload.autoCashout = crashMulti
      if (game.id === 'limbo') payload.targetMultiplier = limboTarget

      const r = await api.post('/beast/games/play', payload)
      const res = r.data
      setResult(res)
      setHistory(prev => [{ won: res.won, payout: res.payout, multiplier: res.multiplier, timestamp: Date.now() }, ...prev].slice(0, 20))
      if (res.balance) onBalanceChange(res.balance)
    } catch (err: any) {
      const errData = err?.response?.data
      if (errData?.treasuryLimit && errData?.maxBet !== undefined) {
        setBetAmount(Math.max(0, errData.maxBet).toFixed(2))
        api.get('/beast/treasury/max-payout').then(r => setTreasuryLimits(r.data)).catch(() => {})
      }
      setResult({ won: false, payout: 0, multiplier: 0, details: errData?.error || 'Bet failed' })
    } finally {
      setPlaying(false)
    }
  }, [betAmount, currency, game, diceTarget, minesCount, coinSide, crashMulti, limboTarget, onBalanceChange])

  const halfBet = () => {
    const bet = parseFloat(betAmount)
    if (!isNaN(bet)) setBetAmount((bet / 2).toFixed(2))
  }
  const doubleBet = () => {
    const bet = parseFloat(betAmount)
    if (!isNaN(bet)) setBetAmount(Math.min(bet * 2, dynamicMaxBet).toFixed(2))
  }
  const maxBet = () => setBetAmount(Math.min(getAvailableBalance(), dynamicMaxBet).toFixed(2))

  return (
    <div className="beast-player">
      <div className="beast-player-layout">
        {/* ─── LEFT: Game Canvas ─── */}
        <div className="beast-player-canvas">
          <div className="beast-game-visual">
            <span className="beast-game-big-emoji">{game.img}</span>
            <h2>{game.name}</h2>
            {result && (
              <div className={`beast-result ${result.won ? 'win' : 'loss'}`}>
                {result.won ? (
                  <>
                    <div className="beast-result-label">YOU WON!</div>
                    <div className="beast-result-payout">+{result.payout.toFixed(4)} {currency}</div>
                    <div className="beast-result-multi">{result.multiplier}x</div>
                  </>
                ) : (
                  <>
                    <div className="beast-result-label">NO WIN</div>
                    <div className="beast-result-detail">{result.details}</div>
                  </>
                )}
              </div>
            )}
            {!result && !playing && (
              <div className="beast-game-desc">{game.desc}</div>
            )}
            {playing && (
              <div className="beast-playing-anim">
                <div className="beast-spinner" />
                <span>Playing...</span>
              </div>
            )}
          </div>

          {/* Game-specific controls */}
          {game.id === 'dice' && (
            <div className="beast-game-control">
              <label>Roll Under: {diceTarget}</label>
              <input type="range" min={2} max={98} value={diceTarget} onChange={e => setDiceTarget(Number(e.target.value))} />
              <div className="beast-control-info">
                Win chance: {(diceTarget - 1)}% | Multiplier: {(99 / (diceTarget - 1)).toFixed(2)}x
              </div>
            </div>
          )}
          {game.id === 'coin-flip' && (
            <div className="beast-game-control">
              <label>Choose Side:</label>
              <div className="beast-coin-sides">
                <button className={`beast-coin-side ${coinSide === 'heads' ? 'active' : ''}`} onClick={() => setCoinSide('heads')}>
                  🪙 Heads
                </button>
                <button className={`beast-coin-side ${coinSide === 'tails' ? 'active' : ''}`} onClick={() => setCoinSide('tails')}>
                  🪙 Tails
                </button>
              </div>
              <div className="beast-control-info">Win chance: 50% | Multiplier: 1.94x</div>
            </div>
          )}
          {game.id === 'mines' && (
            <div className="beast-game-control">
              <label>Mines: {minesCount}</label>
              <input type="range" min={1} max={24} value={minesCount} onChange={e => setMinesCount(Number(e.target.value))} />
              <div className="beast-control-info">
                More mines = higher multiplier per gem revealed
              </div>
            </div>
          )}
          {game.id === 'crash' && (
            <div className="beast-game-control">
              <label>Auto Cash Out at: {crashMulti}x</label>
              <input type="range" min={1.1} max={100} step={0.1} value={crashMulti}
                onChange={e => setCrashMulti(Number(e.target.value))} />
            </div>
          )}
          {game.id === 'limbo' && (
            <div className="beast-game-control">
              <label>Target Multiplier: {limboTarget}x</label>
              <input type="range" min={1.1} max={1000} step={0.1} value={limboTarget}
                onChange={e => setLimboTarget(Number(e.target.value))} />
              <div className="beast-control-info">
                Win chance: {(100 / limboTarget).toFixed(2)}%
              </div>
            </div>
          )}
        </div>

        {/* ─── RIGHT: Bet Controls ─── */}
        <div className="beast-player-controls">
          <div className="beast-bet-section">
            <label>Currency</label>
            <select value={currency} onChange={e => setCurrency(e.target.value as Currency)} className="beast-bet-select">
              <option value="SOL">◎ SOL ({balance.sol.toFixed(4)})</option>
              <option value="USDC">💲 USDC ({balance.usdc.toFixed(2)})</option>
              <option value="USD">💵 USD ({balance.usd.toFixed(2)})</option>
            </select>
          </div>

          <div className="beast-bet-section">
            <label>Bet Amount</label>
            <div className="beast-bet-input-row">
              <input
                type="number"
                value={betAmount}
                onChange={e => setBetAmount(e.target.value)}
                min={game.minBet}
                max={dynamicMaxBet}
                step={0.01}
                className="beast-bet-input"
              />
              <div className="beast-bet-shortcuts">
                <button onClick={halfBet}>½</button>
                <button onClick={doubleBet}>2×</button>
                <button onClick={maxBet}>MAX</button>
              </div>
            </div>
            <div className="beast-bet-range">
              Min: ${game.minBet.toFixed(2)} — Max: ${dynamicMaxBet.toFixed(2)}
              {treasuryLimits && dynamicMaxBet < game.maxBet && (
                <span style={{ color: '#f59e0b', marginLeft: 6, fontSize: '0.75rem' }}>
                  (treasury limit)
                </span>
              )}
            </div>
          </div>

          <button
            className="beast-play-btn"
            onClick={placeBet}
            disabled={playing || parseFloat(betAmount) > getAvailableBalance() || parseFloat(betAmount) > dynamicMaxBet}
          >
            {playing ? 'Playing...' : `BET ${betAmount} ${currency}`}
          </button>

          {/* Bet History */}
          {history.length > 0 && (
            <div className="beast-bet-history">
              <h4>Recent Bets</h4>
              {history.slice(0, 8).map((h, i) => (
                <div key={i} className={`beast-history-row ${h.won ? 'win' : 'loss'}`}>
                  <span>{h.won ? '✅' : '❌'}</span>
                  <span>{h.multiplier}x</span>
                  <span className={h.won ? 'beast-win-amount' : 'beast-loss-amount'}>
                    {h.won ? '+' : '-'}{h.payout.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="beast-game-info">
            <div>House Edge: {game.houseEdge}%</div>
            <div className="beast-provably-fair">🔒 Provably Fair</div>
          </div>
        </div>
      </div>
    </div>
  )
}
