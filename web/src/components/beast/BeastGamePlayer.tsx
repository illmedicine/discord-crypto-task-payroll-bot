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

interface WalletInfo {
  type: string
  address: string
  balance: number
  label: string
}

interface GameResult {
  won: boolean
  payout: number
  multiplier: number
  details: string
  wagerTx?: string
  payoutTx?: string
  newWinningsWallet?: { address: string; amount: number }
  wallets?: WalletInfo[]
}

interface Props {
  game: Game
  balance: { sol: number; usdc: number; usd: number }
  onBalanceChange: (newBal: { sol: number; usdc: number; usd: number }) => void
}

type Currency = 'SOL' | 'USDC' | 'USD'

const SOLSCAN_TX = 'https://solscan.io/tx/'
const SOLSCAN_ADDR = 'https://solscan.io/account/'
const truncAddr = (a: string) => a ? `${a.slice(0, 6)}...${a.slice(-4)}` : ''

/**
 * Game player UI – renders the interactive game canvas for each game type.
 * Uses a provably-fair RNG system seeded server-side.
 */
export default function BeastGamePlayer({ game, balance, onBalanceChange }: Props) {
  const [betAmount, setBetAmount] = useState(game.minBet.toString())
  const [currency, setCurrency] = useState<Currency>('USDC')
  const [playing, setPlaying] = useState(false)
  const [result, setResult] = useState<GameResult | null>(null)
  const [history, setHistory] = useState<Array<{ won: boolean; payout: number; multiplier: number; timestamp: number; wagerTx?: string; payoutTx?: string; betAmount: number; currency: Currency }>>([])              
  const [autoPlay, setAutoPlay] = useState(false)
  const [autoCount, setAutoCount] = useState(0)
  const [userWallets, setUserWallets] = useState<WalletInfo[]>([])
  const [showWallets, setShowWallets] = useState(false)
  // Treasury limits
  const [treasuryLimits, setTreasuryLimits] = useState<{ sol: number; usdc: number; usd: number } | null>(null)
  const [solPrice, setSolPrice] = useState(0)

  // Game-specific state (must be declared before getMaxMultiplier references them)
  const [diceTarget, setDiceTarget] = useState(50)
  const [minesCount, setMinesCount] = useState(3)
  const [coinSide, setCoinSide] = useState<'heads' | 'tails'>('heads')
  const [crashMulti, setCrashMulti] = useState(2)
  const [limboTarget, setLimboTarget] = useState(2)

  // Animation state for game graphics
  const [animPhase, setAnimPhase] = useState<'idle' | 'running' | 'reveal'>('idle')
  const [animData, setAnimData] = useState<any>(null)
  const [houseWalletOk, setHouseWalletOk] = useState(true)

  useEffect(() => {
    api.get('/beast/treasury/max-payout')
      .then(r => setTreasuryLimits(r.data))
      .catch(() => {})
    api.get('/beast/sol-price')
      .then(r => setSolPrice(r.data?.price || 0))
      .catch(() => {})
    api.get('/beast/treasury/wallet-info')
      .then(r => setHouseWalletOk(r.data?.configured === true))
      .catch(() => setHouseWalletOk(false))
  }, [])

  // Auto-refresh balance and treasury limits every 15 seconds
  useEffect(() => {
    const refreshBalance = () => {
      api.get('/beast/wallet/all?refresh=true')
        .then(r => {
          if (r.data?.wallets) setUserWallets(r.data.wallets)
          if (r.data?.totalBalance !== undefined) {
            onBalanceChange({ sol: r.data.totalBalance, usdc: 0, usd: 0 })
          }
        })
        .catch(() => {})
      api.get('/beast/treasury/max-payout')
        .then(r => setTreasuryLimits(r.data))
        .catch(() => {})
      api.get('/beast/sol-price')
        .then(r => setSolPrice(r.data?.price || 0))
        .catch(() => {})
    }
    const iv = setInterval(refreshBalance, 15000)
    // Refresh immediately when tab becomes visible
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshBalance()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [onBalanceChange])

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
      // Slots use specific max multipliers (matched to backend)
      case 'lamb-chop': case 'ice-fishing': case 'duck-hunters':
      case 'omaha-flip': case 'coin-race': case 'beast-fortune':
        return 5
      default: return 11
    }
  }

  // Convert USD-denominated minBet/maxBet to current currency
  const getMinBet = () => {
    if (currency === 'SOL' && solPrice > 0) return parseFloat((game.minBet / solPrice).toFixed(6))
    return game.minBet
  }
  const getGameMaxBet = () => {
    if (currency === 'SOL' && solPrice > 0) return parseFloat((game.maxBet / solPrice).toFixed(6))
    return game.maxBet
  }

  const getDynamicMaxBet = () => {
    const gameMax = getGameMaxBet()
    if (!treasuryLimits) return gameMax
    // Use treasury balance for the selected currency
    let tBal = currency === 'SOL' ? treasuryLimits.sol : currency === 'USDC' ? treasuryLimits.usdc : treasuryLimits.usd
    // If betting in SOL but treasury has USD loaded, convert USD treasury to SOL equivalent
    if (currency === 'SOL' && solPrice > 0) {
      tBal += treasuryLimits.usd / solPrice
      tBal += treasuryLimits.usdc / solPrice
    }
    // If betting in USD/USDC but treasury has SOL loaded, convert SOL treasury to USD equivalent
    if ((currency === 'USD' || currency === 'USDC') && solPrice > 0) {
      tBal += treasuryLimits.sol * solPrice
    }
    const treasuryMax = parseFloat((tBal / getMaxMultiplier()).toFixed(6))
    return Math.max(0, Math.min(gameMax, treasuryMax))
  }

  const dynamicMaxBet = getDynamicMaxBet()
  const minBet = getMinBet()

  const getAvailableBalance = () => {
    if (currency === 'SOL') return balance.sol
    if (currency === 'USDC') return balance.usdc
    return balance.usd
  }

  const placeBet = useCallback(async () => {
    const bet = parseFloat(betAmount)
    if (isNaN(bet) || bet <= 0) return
    if (bet < minBet * 0.99 || bet > dynamicMaxBet * 1.001) return
    if (bet > getAvailableBalance()) return

    setPlaying(true)
    setResult(null)
    setAnimPhase('running')
    setAnimData(initAnimData(game.id))
    try {
      // Fetch fresh balance before placing bet to prevent stale-balance failures
      try {
        const freshBal = await api.get('/beast/wallet/all?refresh=true')
        if (freshBal.data?.totalBalance !== undefined) {
          const freshSol = freshBal.data.totalBalance
          onBalanceChange({ sol: freshSol, usdc: 0, usd: 0 })
          if (freshBal.data?.wallets) setUserWallets(freshBal.data.wallets)
          // Re-check if bet is still affordable with fresh balance
          if (currency === 'SOL' && bet > freshSol) {
            setResult({ won: false, payout: 0, multiplier: 0, details: `Insufficient balance. Available: ${freshSol.toFixed(6)} SOL` })
            setAnimPhase('idle')
            setPlaying(false)
            return
          }
        }
      } catch (_) { /* proceed with cached balance */ }

      const payload: Record<string, any> = { gameId: game.id, betAmount: bet, currency }
      // Add game-specific params
      if (game.id === 'dice') payload.target = diceTarget
      if (game.id === 'mines') payload.minesCount = minesCount
      if (game.id === 'coin-flip') payload.side = coinSide
      if (game.id === 'crash') payload.autoCashout = crashMulti
      if (game.id === 'limbo') payload.targetMultiplier = limboTarget

      const r = await api.post('/beast/games/play', payload, { timeout: 90000 })
      const res = r.data
      setAnimPhase('reveal')
      // Brief pause to show reveal animation before showing result
      await new Promise(resolve => setTimeout(resolve, 800))
      setResult(res)
      setAnimPhase('idle')
      setHistory(prev => [{ won: res.won, payout: res.payout, multiplier: res.multiplier, timestamp: Date.now(), wagerTx: res.wagerTx, payoutTx: res.payoutTx, betAmount: bet, currency }, ...prev].slice(0, 20))
      if (res.wallets) setUserWallets(res.wallets)
      if (res.balance) onBalanceChange(res.balance)
      // Refresh treasury limits after each bet
      api.get('/beast/treasury/max-payout').then(r2 => setTreasuryLimits(r2.data)).catch(() => {})
    } catch (err: any) {
      const errData = err?.response?.data
      if (errData?.treasuryLimit && errData?.maxBet !== undefined) {
        const prec = currency === 'SOL' ? 6 : 2
        setBetAmount(Math.max(0, errData.maxBet).toFixed(prec))
        api.get('/beast/treasury/max-payout').then(r2 => setTreasuryLimits(r2.data)).catch(() => {})
      }
      const isTimeout = err?.code === 'ECONNABORTED' || err?.message?.includes('timeout')
      setResult({ won: false, payout: 0, multiplier: 0, details: isTimeout ? 'Request timed out — check your balance, the bet may still process.' : (errData?.error || 'Bet failed') })
      setAnimPhase('idle')
    } finally {
      setPlaying(false)
    }
  }, [betAmount, currency, game, minBet, dynamicMaxBet, diceTarget, minesCount, coinSide, crashMulti, limboTarget, onBalanceChange])

  // Reset bet amount when currency changes so it matches converted min
  useEffect(() => {
    setBetAmount(minBet.toFixed(currency === 'SOL' ? 6 : 2))
  }, [currency, solPrice]) // eslint-disable-line react-hooks/exhaustive-deps

  const betPrec = currency === 'SOL' ? 6 : 2
  const halfBet = () => {
    const bet = parseFloat(betAmount)
    if (!isNaN(bet)) setBetAmount(Math.max(bet / 2, minBet).toFixed(betPrec))
  }
  const doubleBet = () => {
    const bet = parseFloat(betAmount)
    if (!isNaN(bet)) setBetAmount(Math.min(bet * 2, dynamicMaxBet).toFixed(betPrec))
  }
  const maxBet = () => setBetAmount(Math.min(getAvailableBalance(), dynamicMaxBet).toFixed(betPrec))

  // Initialize animation data per game type
  const initAnimData = (gameId: string) => {
    switch (gameId) {
      case 'coin-flip': return { side: coinSide }
      case 'dice': return { target: diceTarget }
      case 'crash': return { cashout: crashMulti }
      case 'limbo': return { target: limboTarget }
      case 'mines': return { count: minesCount, revealed: [] as number[] }
      case 'lamb-chop': case 'ice-fishing': case 'duck-hunters':
      case 'omaha-flip': case 'coin-race': case 'beast-fortune':
        return { reels: [0, 0, 0] } // slot reels
      case 'roulette': case 'lightning-roulette':
        return { angle: 0 }
      case 'wheel': return { angle: 0 }
      case 'blackjack': return { cards: 0 }
      case 'baccarat': return { cards: 0 }
      case 'plinko': return { row: 0 }
      case 'keno': return { drawn: 0 }
      case 'hilo': return { card: 0 }
      case 'tower': return { floor: 0 }
      default: return {}
    }
  }

  // Slot symbols per theme
  const slotSymbols: Record<string, string[]> = {
    'lamb-chop': ['🐑', '🐄', '🌾', '🥕', '🐓', '🌻', '💰'],
    'ice-fishing': ['🐟', '🎣', '❄️', '🐋', '🧊', '🦈', '💎'],
    'duck-hunters': ['🦆', '🔫', '🌿', '🐕', '🎯', '🦅', '💰'],
    'omaha-flip': ['🂡', '🂮', '🂫', '🂭', '♠️', '♥️', '💰'],
    'coin-race': ['🏎️', '🪙', '🏁', '⚡', '🔥', '🚀', '💎'],
    'beast-fortune': ['🐾', '👑', '💎', '🔥', '⚡', '🌟', '💰'],
  }

  const getGameSymbols = () => slotSymbols[game.id] || ['⭐', '🔥', '💎', '🍀', '🎯', '⚡', '💰']

  // Render game-specific animation canvas
  const renderGameAnimation = () => {
    const isSlot = ['lamb-chop', 'ice-fishing', 'duck-hunters', 'omaha-flip', 'coin-race', 'beast-fortune'].includes(game.id)

    if (isSlot) {
      const syms = getGameSymbols()
      return (
        <div className="beast-anim-slots">
          <div className="beast-slots-frame">
            <div className="beast-slot-reel spinning">{syms.concat(syms).map((s, i) => <span key={i} className="beast-slot-sym">{s}</span>)}</div>
            <div className="beast-slot-reel spinning delay1">{syms.concat(syms).map((s, i) => <span key={i} className="beast-slot-sym">{s}</span>)}</div>
            <div className="beast-slot-reel spinning delay2">{syms.concat(syms).map((s, i) => <span key={i} className="beast-slot-sym">{s}</span>)}</div>
          </div>
          <div className="beast-slots-label">SPINNING...</div>
        </div>
      )
    }

    switch (game.id) {
      case 'coin-flip':
        return (
          <div className="beast-anim-coin">
            <div className="beast-coin-3d">
              <div className="beast-coin-face heads">🪙</div>
              <div className="beast-coin-face tails">🪙</div>
            </div>
            <div className="beast-anim-label">Flipping coin...</div>
          </div>
        )

      case 'dice':
        return (
          <div className="beast-anim-dice">
            <div className="beast-dice-cube">
              <div className="beast-dice-face">🎲</div>
            </div>
            <div className="beast-anim-label">Rolling dice... Target: under {diceTarget}</div>
          </div>
        )

      case 'crash':
        return (
          <div className="beast-anim-crash">
            <div className="beast-crash-graph">
              <div className="beast-crash-line" />
              <div className="beast-crash-multiplier">
                <span className="beast-crash-value">📈</span>
              </div>
            </div>
            <div className="beast-anim-label">Multiplier rising... Cash out at {crashMulti}x</div>
          </div>
        )

      case 'limbo':
        return (
          <div className="beast-anim-limbo">
            <div className="beast-limbo-meter">
              <div className="beast-limbo-fill" />
              <div className="beast-limbo-target">{limboTarget}x</div>
            </div>
            <div className="beast-anim-label">Generating multiplier...</div>
          </div>
        )

      case 'mines':
        return (
          <div className="beast-anim-mines">
            <div className="beast-mines-grid">
              {Array.from({ length: 25 }).map((_, i) => (
                <div key={i} className={`beast-mine-cell ${i % 7 === 0 ? 'reveal' : ''}`}>
                  <span className="beast-mine-hidden">❓</span>
                </div>
              ))}
            </div>
            <div className="beast-anim-label">Placing {minesCount} mines...</div>
          </div>
        )

      case 'plinko':
        return (
          <div className="beast-anim-plinko">
            <div className="beast-plinko-board">
              {Array.from({ length: 5 }).map((_, row) => (
                <div key={row} className="beast-plinko-row">
                  {Array.from({ length: row + 3 }).map((_, pin) => (
                    <span key={pin} className="beast-plinko-pin">●</span>
                  ))}
                </div>
              ))}
              <div className="beast-plinko-ball">⚪</div>
            </div>
            <div className="beast-anim-label">Ball dropping...</div>
          </div>
        )

      case 'keno':
        return (
          <div className="beast-anim-keno">
            <div className="beast-keno-board">
              {Array.from({ length: 40 }).map((_, i) => (
                <span key={i} className={`beast-keno-num ${i < 10 ? 'drawn' : ''}`}>{i + 1}</span>
              ))}
            </div>
            <div className="beast-anim-label">Drawing numbers...</div>
          </div>
        )

      case 'hilo':
        return (
          <div className="beast-anim-hilo">
            <div className="beast-hilo-cards">
              <div className="beast-hilo-card current">🃏</div>
              <div className="beast-hilo-card next flipping">❓</div>
            </div>
            <div className="beast-anim-label">Revealing next card...</div>
          </div>
        )

      case 'wheel':
        return (
          <div className="beast-anim-wheel">
            <div className="beast-wheel-spinner">
              <div className="beast-wheel-inner">🎡</div>
            </div>
            <div className="beast-anim-label">Spinning wheel...</div>
          </div>
        )

      case 'tower':
        return (
          <div className="beast-anim-tower">
            <div className="beast-tower-stack">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={`beast-tower-floor ${i < 2 ? 'cleared' : ''}`}>
                  <span>{i < 2 ? '✅' : '🔲'}</span>
                  Floor {5 - i}
                </div>
              ))}
            </div>
            <div className="beast-anim-label">Climbing tower...</div>
          </div>
        )

      case 'blackjack':
        return (
          <div className="beast-anim-blackjack">
            <div className="beast-bj-table">
              <div className="beast-bj-dealer">
                <span className="beast-bj-card dealt">🂠</span>
                <span className="beast-bj-card dealt delay1">🂠</span>
              </div>
              <div className="beast-bj-vs">VS</div>
              <div className="beast-bj-player">
                <span className="beast-bj-card dealt delay2">🃏</span>
                <span className="beast-bj-card dealt delay3">🃏</span>
              </div>
            </div>
            <div className="beast-anim-label">Dealing cards...</div>
          </div>
        )

      case 'roulette': case 'lightning-roulette':
        return (
          <div className="beast-anim-roulette">
            <div className="beast-roulette-wheel">
              <div className="beast-roulette-inner">
                {game.id === 'lightning-roulette' && <span className="beast-roulette-bolt">⚡</span>}
                <span className="beast-roulette-ball">⚪</span>
              </div>
            </div>
            <div className="beast-anim-label">{game.id === 'lightning-roulette' ? 'Lightning strikes!' : 'Ball spinning...'}</div>
          </div>
        )

      case 'baccarat':
        return (
          <div className="beast-anim-baccarat">
            <div className="beast-bacc-table">
              <div className="beast-bacc-hand">
                <div className="beast-bacc-label">PLAYER</div>
                <span className="beast-bj-card dealt">🃏</span>
                <span className="beast-bj-card dealt delay1">🃏</span>
              </div>
              <div className="beast-bacc-hand">
                <div className="beast-bacc-label">BANKER</div>
                <span className="beast-bj-card dealt delay2">🂠</span>
                <span className="beast-bj-card dealt delay3">🂠</span>
              </div>
            </div>
            <div className="beast-anim-label">Dealing baccarat...</div>
          </div>
        )

      default:
        return (
          <div className="beast-anim-generic">
            <div className="beast-generic-pulse">{game.img}</div>
            <div className="beast-anim-label">Processing bet...</div>
          </div>
        )
    }
  }

  return (
    <div className="beast-player">
      <div className="beast-player-layout">
        {/* ─── House wallet warning */}
            {!houseWalletOk && (
              <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '12px 16px', marginBottom: 12, textAlign: 'center', width: '100%', maxWidth: 400 }}>
                <div style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.9rem', marginBottom: 4 }}>⚠️ House Wallet Not Connected</div>
                <div style={{ color: '#ccc', fontSize: '0.78rem' }}>Bets are disabled. The treasury owner must connect a house wallet in the Treasury Admin panel.</div>
              </div>
            )}

            {/* LEFT: Game Canvas ─── */}
        <div className="beast-player-canvas">
          <div className="beast-game-visual">
            {/* Idle state: show game icon + name */}
            {!playing && !result && (
              <>
                <span className="beast-game-big-emoji">{game.img}</span>
                <h2>{game.name}</h2>
                <div className="beast-game-desc">{game.desc}</div>
              </>
            )}

            {/* Playing state: show game-specific animation */}
            {playing && (
              <div className="beast-game-anim-container">
                {renderGameAnimation()}
              </div>
            )}

            {/* Result state */}
            {result && !playing && (
              <div className={`beast-result ${result.won ? 'win' : 'loss'}`}>
                {result.won ? (
                  <>
                    <div className="beast-result-label">YOU WON!</div>
                    <div className="beast-result-payout">+{result.payout.toFixed(4)} {currency}</div>
                    <div className="beast-result-multi">{result.multiplier}x</div>
                    {result.newWinningsWallet && (
                      <div className="beast-result-new-wallet">
                        <span className="beast-result-wallet-icon">💰</span>
                        New winnings wallet: <a href={`${SOLSCAN_ADDR}${result.newWinningsWallet.address}`} target="_blank" rel="noopener noreferrer">{truncAddr(result.newWinningsWallet.address)}</a>
                        <span className="beast-result-wallet-amt">+{result.newWinningsWallet.amount.toFixed(6)} SOL</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="beast-result-label">NO WIN</div>
                    <div className="beast-result-payout" style={{ color: 'var(--beast-accent-red)' }}>-{parseFloat(betAmount).toFixed(4)} {currency}</div>
                    <div className="beast-result-detail">{result.details || 'No win this spin'}</div>
                  </>
                )}
                <div className="beast-result-txns">
                  {result.wagerTx && (
                    <a href={`${SOLSCAN_TX}${result.wagerTx}`} target="_blank" rel="noopener noreferrer" className="beast-tx-link wager">
                      ⛓ Wager TX: {truncAddr(result.wagerTx)}
                    </a>
                  )}
                  {result.payoutTx && (
                    <a href={`${SOLSCAN_TX}${result.payoutTx}`} target="_blank" rel="noopener noreferrer" className="beast-tx-link payout">
                      ⛓ Payout TX: {truncAddr(result.payoutTx)}
                    </a>
                  )}
                </div>
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
                min={minBet}
                max={dynamicMaxBet}
                step={currency === 'SOL' ? 0.000001 : 0.01}
                className="beast-bet-input"
              />
              <div className="beast-bet-shortcuts">
                <button onClick={halfBet}>½</button>
                <button onClick={doubleBet}>2×</button>
                <button onClick={maxBet}>MAX</button>
              </div>
            </div>
            <div className="beast-bet-range">
              Min: {currency === 'SOL' ? `${minBet.toFixed(6)} SOL` : `$${minBet.toFixed(2)}`} — Max: {currency === 'SOL' ? `${dynamicMaxBet.toFixed(6)} SOL` : `$${dynamicMaxBet.toFixed(2)}`}
              {solPrice > 0 && currency === 'SOL' && dynamicMaxBet > 0 && (
                <span style={{ color: '#a78bfa', marginLeft: 6, fontSize: '0.75rem' }}>
                  (≈ ${(dynamicMaxBet * solPrice).toFixed(2)})
                </span>
              )}
              {treasuryLimits && dynamicMaxBet < getGameMaxBet() && (
                <span style={{ color: '#f59e0b', marginLeft: 6, fontSize: '0.75rem' }}>
                  (treasury limit)
                </span>
              )}
            </div>
          </div>

          <button
            className="beast-play-btn"
            onClick={placeBet}
            disabled={playing || !houseWalletOk || !betAmount || parseFloat(betAmount) <= 0 || parseFloat(betAmount) > getAvailableBalance() || parseFloat(betAmount) > dynamicMaxBet * 1.001 || parseFloat(betAmount) < minBet * 0.99}
          >
            {!houseWalletOk ? '⚠️ House Wallet Not Connected' : playing ? 'Playing...' : `BET ${betAmount} ${currency}`}
          </button>

          {/* Wallet Breakdown Toggle */}
          {userWallets.length > 0 && (
            <div className="beast-wallets-panel">
              <button className="beast-wallets-toggle" onClick={() => setShowWallets(!showWallets)}>
                {showWallets ? '▾' : '▸'} My Wallets ({userWallets.length})
                <span className="beast-wallets-total">{userWallets.reduce((s, w) => s + w.balance, 0).toFixed(6)} SOL</span>
              </button>
              {showWallets && (
                <div className="beast-wallets-list">
                  {userWallets.map((w, i) => (
                    <div key={i} className={`beast-wallet-row ${w.type}`}>
                      <span className="beast-wallet-type-badge">{w.type === 'deposit' ? '📥' : '🏆'}</span>
                      <span className="beast-wallet-label">{w.label || (w.type === 'deposit' ? 'Deposit Wallet' : 'Winnings')}</span>
                      <a href={`${SOLSCAN_ADDR}${w.address}`} target="_blank" rel="noopener noreferrer" className="beast-wallet-addr">{truncAddr(w.address)}</a>
                      <span className="beast-wallet-bal">{w.balance.toFixed(6)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bet History */}
          {history.length > 0 && (
            <div className="beast-bet-history">
              <h4>Recent Bets</h4>
              {history.slice(0, 8).map((h, i) => (
                <div key={i} className={`beast-history-row ${h.won ? 'win' : 'loss'}`}>
                  <span>{h.won ? '✅' : '❌'}</span>
                  <span>{h.multiplier}x</span>
                  <span className={h.won ? 'beast-win-amount' : 'beast-loss-amount'}>
                    {h.won ? `+${h.payout.toFixed(4)}` : `-${h.betAmount.toFixed(4)}`}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--beast-text-muted)' }}>{h.currency}</span>
                  {h.wagerTx && (
                    <a href={`${SOLSCAN_TX}${h.wagerTx}`} target="_blank" rel="noopener noreferrer" className="beast-history-tx" title="View wager TX">⛓</a>
                  )}
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
