import React, { useEffect, useState, useCallback } from 'react'
import api from '../api'
import BeastWallet from '../components/beast/BeastWallet'
import BeastGameCard from '../components/beast/BeastGameCard'
import BeastSportsBook from '../components/beast/BeastSportsBook'
import BeastLiveWins from '../components/beast/BeastLiveWins'
import BeastGamePlayer from '../components/beast/BeastGamePlayer'
import BeastDiscordShare from '../components/beast/BeastDiscordShare'
import BeastTreasuryAdmin from '../components/beast/BeastTreasuryAdmin'

/* ───────────────────────────────────────
   Game Catalog – Illy Beast Originals
   mirrors Yeet-style originals + slots
   ─────────────────────────────────────── */
export const BEAST_ORIGINALS = [
  { id: 'coin-flip', name: 'Coin Flip', category: 'originals', img: '🪙', desc: 'Classic heads or tails – 2x your bet', houseEdge: 3, minBet: 0.01, maxBet: 100 },
  { id: 'dice', name: 'Dice', category: 'originals', img: '🎲', desc: 'Roll under target to win', houseEdge: 2, minBet: 0.01, maxBet: 500 },
  { id: 'limbo', name: 'Limbo', category: 'originals', img: '🚀', desc: 'Pick a multiplier – hit it or bust', houseEdge: 3, minBet: 0.01, maxBet: 250 },
  { id: 'mines', name: 'Mines', category: 'originals', img: '💣', desc: 'Uncover gems, avoid mines', houseEdge: 2, minBet: 0.01, maxBet: 100 },
  { id: 'plinko', name: 'Plinko', category: 'originals', img: '📍', desc: 'Drop the ball, hit the multiplier', houseEdge: 3, minBet: 0.01, maxBet: 100 },
  { id: 'keno', name: 'Keno', category: 'originals', img: '🔢', desc: 'Pick numbers, match to win', houseEdge: 4, minBet: 0.01, maxBet: 50 },
  { id: 'crash', name: 'Crash', category: 'originals', img: '📈', desc: 'Cash out before the crash', houseEdge: 3, minBet: 0.01, maxBet: 200 },
  { id: 'hilo', name: 'Hi-Lo', category: 'originals', img: '🃏', desc: 'Guess higher or lower', houseEdge: 2, minBet: 0.01, maxBet: 100 },
  { id: 'wheel', name: 'Wheel', category: 'originals', img: '🎡', desc: 'Spin the wheel of fortune', houseEdge: 4, minBet: 0.01, maxBet: 100 },
  { id: 'tower', name: 'Tower', category: 'originals', img: '🏗️', desc: 'Climb the tower, each floor multiplies', houseEdge: 3, minBet: 0.01, maxBet: 100 },
]

export const BEAST_SLOTS = [
  { id: 'lamb-chop', name: 'Lamb Chop', category: 'slots', img: '🐑', desc: 'Farm-themed slot machine', houseEdge: 4, minBet: 0.10, maxBet: 50 },
  { id: 'ice-fishing', name: 'Ice Fishing', category: 'slots', img: '🎣', desc: 'Frozen lake adventure spins', houseEdge: 5, minBet: 0.10, maxBet: 50 },
  { id: 'duck-hunters', name: 'Duck Hunters', category: 'slots', img: '🦆', desc: 'Hunt for big wins', houseEdge: 4, minBet: 0.10, maxBet: 100 },
  { id: 'omaha-flip', name: 'Omaha Flip', category: 'slots', img: '🂠', desc: 'Poker-themed slot action', houseEdge: 3, minBet: 0.10, maxBet: 100 },
  { id: 'coin-race', name: 'Coin Race', category: 'slots', img: '🏎️', desc: 'Race coins for multiplied returns', houseEdge: 4, minBet: 0.10, maxBet: 50 },
  { id: 'beast-fortune', name: 'Beast Fortune', category: 'slots', img: '🐾', desc: 'Illy Beast exclusive jackpot slot', houseEdge: 3, minBet: 0.10, maxBet: 200 },
]

export const BEAST_TABLE_GAMES = [
  { id: 'blackjack', name: 'Blackjack', category: 'table', img: '🃏', desc: 'Classic 21 – beat the dealer', houseEdge: 1.5, minBet: 0.50, maxBet: 500 },
  { id: 'roulette', name: 'Roulette', category: 'table', img: '🎰', desc: 'European roulette wheel', houseEdge: 2.7, minBet: 0.10, maxBet: 500 },
  { id: 'baccarat', name: 'Baccarat', category: 'table', img: '💎', desc: 'Player vs banker', houseEdge: 1.2, minBet: 0.50, maxBet: 1000 },
  { id: 'lightning-roulette', name: 'Lightning Roulette', category: 'table', img: '⚡', desc: 'Roulette with random multipliers up to 500x', houseEdge: 2.7, minBet: 0.10, maxBet: 200 },
]

export const BEAST_LIVE = [
  { id: 'live-blackjack', name: 'Live Blackjack', category: 'live', img: '🎥', desc: 'Live dealer blackjack tables', houseEdge: 1.5, minBet: 1, maxBet: 5000 },
  { id: 'live-roulette', name: 'Live Roulette', category: 'live', img: '📹', desc: 'Live spin with real dealer', houseEdge: 2.7, minBet: 1, maxBet: 5000 },
  { id: 'live-baccarat', name: 'Live Baccarat', category: 'live', img: '🎬', desc: 'Live baccarat tables', houseEdge: 1.2, minBet: 1, maxBet: 5000 },
  { id: 'game-shows', name: 'Game Shows', category: 'live', img: '🎪', desc: 'Interactive live game shows', houseEdge: 4, minBet: 0.50, maxBet: 500 },
]

export const ALL_GAMES = [...BEAST_ORIGINALS, ...BEAST_SLOTS, ...BEAST_TABLE_GAMES, ...BEAST_LIVE]

type BeastTab = 'casino' | 'sports'
type CasinoCategory = 'all' | 'favorites' | 'recent' | 'originals' | 'slots' | 'table' | 'live' | 'new'

interface BeastUser {
  id: string
  username: string
  avatar?: string
  beastBalance: { sol: number; usdc: number; usd: number }
  vipLevel: string
  vipProgress: number
  favorites: string[]
  recentGames: string[]
}

export default function IllyBeastGaming({ guildId }: { guildId: string }) {
  const [mainTab, setMainTab] = useState<BeastTab>('casino')
  const [casinoCategory, setCasinoCategory] = useState<CasinoCategory>('all')
  const [beastUser, setBeastUser] = useState<BeastUser | null>(null)
  const [showWallet, setShowWallet] = useState(false)
  const [activeGame, setActiveGame] = useState<typeof ALL_GAMES[0] | null>(null)
  const [shareGame, setShareGame] = useState<typeof ALL_GAMES[0] | null>(null)
  const [showTreasury, setShowTreasury] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)

  // Load beast user profile
  useEffect(() => {
    setLoading(true)
    api.get('/beast/profile')
      .then(r => setBeastUser(r.data))
      .catch(() => {
        // Default profile if beast profile doesn't exist yet
        setBeastUser({
          id: '', username: 'Player', beastBalance: { sol: 0, usdc: 0, usd: 0 },
          vipLevel: 'Copper', vipProgress: 0, favorites: [], recentGames: []
        })
      })
      .finally(() => setLoading(false))
  }, [])

  const toggleFavorite = useCallback((gameId: string) => {
    if (!beastUser) return
    const isFav = beastUser.favorites.includes(gameId)
    const newFavs = isFav ? beastUser.favorites.filter(f => f !== gameId) : [...beastUser.favorites, gameId]
    setBeastUser({ ...beastUser, favorites: newFavs })
    api.post('/beast/favorites', { gameId, action: isFav ? 'remove' : 'add' }).catch(() => {})
  }, [beastUser])

  const playGame = useCallback((game: typeof ALL_GAMES[0]) => {
    // Track recent game
    if (beastUser) {
      const recent = [game.id, ...beastUser.recentGames.filter(g => g !== game.id)].slice(0, 10)
      setBeastUser({ ...beastUser, recentGames: recent })
      api.post('/beast/recent', { gameId: game.id }).catch(() => {})
    }
    setActiveGame(game)
  }, [beastUser])

  // Filter games based on category and search
  const getFilteredGames = () => {
    let games = ALL_GAMES
    if (casinoCategory === 'favorites') {
      games = ALL_GAMES.filter(g => beastUser?.favorites.includes(g.id))
    } else if (casinoCategory === 'recent') {
      const recentIds = beastUser?.recentGames || []
      games = recentIds.map(id => ALL_GAMES.find(g => g.id === id)).filter(Boolean) as typeof ALL_GAMES
    } else if (casinoCategory !== 'all' && casinoCategory !== 'new') {
      games = ALL_GAMES.filter(g => g.category === casinoCategory)
    } else if (casinoCategory === 'new') {
      games = ALL_GAMES.slice(-6)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      games = games.filter(g => g.name.toLowerCase().includes(q) || g.desc.toLowerCase().includes(q))
    }
    return games
  }

  const totalBalance = beastUser
    ? beastUser.beastBalance.usd + beastUser.beastBalance.usdc + (beastUser.beastBalance.sol * 0) // SOL needs price conversion
    : 0

  if (activeGame) {
    return (
      <div className="beast-game-active">
        <div className="beast-game-header">
          <button className="beast-back-btn" onClick={() => setActiveGame(null)}>
            ← Back to Lobby
          </button>
          <h2>{activeGame.img} {activeGame.name}</h2>
          <div className="beast-game-header-actions">
            <button
              className="beast-share-btn"
              onClick={() => setShareGame(activeGame)}
              title="Share to Discord"
            >
              📤 Share
            </button>
            <button
              className={`beast-fav-btn ${beastUser?.favorites.includes(activeGame.id) ? 'active' : ''}`}
              onClick={() => toggleFavorite(activeGame.id)}
            >
              {beastUser?.favorites.includes(activeGame.id) ? '★' : '☆'}
            </button>
          </div>
        </div>
        <BeastGamePlayer game={activeGame} balance={beastUser?.beastBalance || { sol: 0, usdc: 0, usd: 0 }} onBalanceChange={(newBal) => {
          if (beastUser) setBeastUser({ ...beastUser, beastBalance: newBal })
        }} />
        {shareGame && (
          <BeastDiscordShare
            game={shareGame}
            guildId={guildId}
            onClose={() => setShareGame(null)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="beast-portal">
      {/* ─── TOP BAR ─── */}
      <div className="beast-topbar">
        <div className="beast-topbar-left">
          <div className="beast-logo">
            <span className="beast-logo-icon">🐾</span>
            <span className="beast-logo-text">illy Beast</span>
          </div>
          <div className="beast-main-tabs">
            <button
              className={`beast-main-tab ${mainTab === 'casino' ? 'active' : ''}`}
              onClick={() => setMainTab('casino')}
            >
              Casino
            </button>
            <button
              className={`beast-main-tab ${mainTab === 'sports' ? 'active' : ''}`}
              onClick={() => setMainTab('sports')}
            >
              Sports
            </button>
          </div>
        </div>

        <div className="beast-topbar-center">
          <div className="beast-search">
            <span className="beast-search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search games..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="beast-search-input"
            />
          </div>
        </div>

        <div className="beast-topbar-right">
          {beastUser && (
            <>
              <div className="beast-vip-badge">
                <span className="beast-vip-label">{beastUser.vipLevel}</span>
                <div className="beast-vip-bar">
                  <div className="beast-vip-fill" style={{ width: `${beastUser.vipProgress}%` }} />
                </div>
                <span className="beast-vip-pct">{beastUser.vipProgress}%</span>
              </div>
              <button className="beast-balance-btn" onClick={() => setShowWallet(true)}>
                <span className="beast-balance-icon">💰</span>
                <span className="beast-balance-amount">${totalBalance.toFixed(2)}</span>
              </button>
              <button className="beast-cashier-btn" onClick={() => setShowWallet(true)}>
                CASHIER
              </button>
              {beastUser.id === '1075818871149305966' && (
                <button className="beast-cashier-btn" onClick={() => setShowTreasury(true)} style={{ marginLeft: 6, background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
                  TREASURY
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ─── WALLET / CASHIER MODAL ─── */}
      {showWallet && (
        <BeastWallet
          balance={beastUser?.beastBalance || { sol: 0, usdc: 0, usd: 0 }}
          guildId={guildId}
          onClose={() => setShowWallet(false)}
          onBalanceChange={(newBal) => {
            if (beastUser) setBeastUser({ ...beastUser, beastBalance: newBal })
          }}
        />
      )}

      {/* ─── TREASURY ADMIN MODAL ─── */}
      {showTreasury && (
        <BeastTreasuryAdmin onClose={() => setShowTreasury(false)} />
      )}

      {/* ─── LIVE WINS TICKER ─── */}
      <BeastLiveWins />

      {/* ─── MAIN CONTENT ─── */}
      {mainTab === 'casino' ? (
        <div className="beast-casino">
          {/* ─── SIDEBAR CATEGORIES ─── */}
          <div className="beast-sidebar-cats">
            <div className="beast-cat-section">
              <div className="beast-cat-header">GAMES</div>
              {([
                { id: 'all' as CasinoCategory, label: 'All Games', icon: '🎮' },
                { id: 'favorites' as CasinoCategory, label: 'Favorites', icon: '⭐' },
                { id: 'recent' as CasinoCategory, label: 'Recent Games', icon: '🕐' },
              ]).map(cat => (
                <button
                  key={cat.id}
                  className={`beast-cat-btn ${casinoCategory === cat.id ? 'active' : ''}`}
                  onClick={() => setCasinoCategory(cat.id)}
                >
                  <span>{cat.icon}</span> {cat.label}
                </button>
              ))}
            </div>
            <div className="beast-cat-section">
              <div className="beast-cat-header">CASINO</div>
              {([
                { id: 'originals' as CasinoCategory, label: 'Originals', icon: '🐾' },
                { id: 'new' as CasinoCategory, label: 'New Releases', icon: '✨' },
                { id: 'slots' as CasinoCategory, label: 'Slots', icon: '🎰' },
                { id: 'table' as CasinoCategory, label: 'Table Games', icon: '🃏' },
                { id: 'live' as CasinoCategory, label: 'Live Casino', icon: '📺' },
              ]).map(cat => (
                <button
                  key={cat.id}
                  className={`beast-cat-btn ${casinoCategory === cat.id ? 'active' : ''}`}
                  onClick={() => setCasinoCategory(cat.id)}
                >
                  <span>{cat.icon}</span> {cat.label}
                </button>
              ))}
            </div>
            <div className="beast-cat-section">
              <div className="beast-cat-header">GENERAL</div>
              {([
                { label: 'VIP Rewards', icon: '👑' },
                { label: 'Promotions', icon: '🎁' },
                { label: 'Leaderboard', icon: '🏆' },
              ]).map(item => (
                <button key={item.label} className="beast-cat-btn">
                  <span>{item.icon}</span> {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* ─── GAME GRID ─── */}
          <div className="beast-main-area">
            {/* Hero Banner */}
            {casinoCategory === 'all' && !searchQuery && (
              <div className="beast-hero">
                <div className="beast-hero-balance">
                  <h3>ACCOUNT BALANCE</h3>
                  <div className="beast-hero-total">${totalBalance.toFixed(2)}</div>
                  <div className="beast-hero-currencies">
                    <span>◎ SOL <strong>${(beastUser?.beastBalance.sol || 0).toFixed(4)}</strong></span>
                    <span>💲 USDC <strong>${(beastUser?.beastBalance.usdc || 0).toFixed(2)}</strong></span>
                    <span>💵 USD <strong>${(beastUser?.beastBalance.usd || 0).toFixed(2)}</strong></span>
                  </div>
                  <div className="beast-hero-btns">
                    <button className="beast-deposit-btn" onClick={() => setShowWallet(true)}>DEPOSIT</button>
                    <button className="beast-buy-btn" onClick={() => setShowWallet(true)}>BUY CRYPTO</button>
                  </div>
                </div>
                <div className="beast-hero-promo">
                  <div className="beast-hero-mascot">🐾</div>
                  <div className="beast-hero-promo-text">
                    <span className="beast-new-badge">NEW GAMES</span>
                    <h2>illy Beast<br />EXCLUSIVE</h2>
                    <button className="beast-play-now-btn" onClick={() => setCasinoCategory('originals')}>PLAY NOW</button>
                  </div>
                </div>
              </div>
            )}

            {/* Section: Recent Games (if user has history and showing all) */}
            {casinoCategory === 'all' && !searchQuery && (beastUser?.recentGames.length || 0) > 0 && (
              <div className="beast-section">
                <div className="beast-section-header">
                  <h3>🕐 Recent Games</h3>
                  <button className="beast-see-all" onClick={() => setCasinoCategory('recent')}>SEE ALL</button>
                </div>
                <div className="beast-game-scroll">
                  {beastUser!.recentGames.slice(0, 6).map(gid => {
                    const game = ALL_GAMES.find(g => g.id === gid)
                    if (!game) return null
                    return (
                      <BeastGameCard
                        key={game.id}
                        game={game}
                        isFavorite={beastUser?.favorites.includes(game.id) || false}
                        onPlay={() => playGame(game)}
                        onToggleFavorite={() => toggleFavorite(game.id)}
                        onShare={() => setShareGame(game)}
                      />
                    )
                  })}
                </div>
              </div>
            )}

            {/* Section: Originals (if showing all) */}
            {casinoCategory === 'all' && !searchQuery && (
              <div className="beast-section">
                <div className="beast-section-header">
                  <h3>🐾 illy Beast Originals</h3>
                  <button className="beast-see-all" onClick={() => setCasinoCategory('originals')}>SEE ALL</button>
                </div>
                <div className="beast-game-scroll">
                  {BEAST_ORIGINALS.slice(0, 6).map(game => (
                    <BeastGameCard
                      key={game.id}
                      game={game}
                      isFavorite={beastUser?.favorites.includes(game.id) || false}
                      onPlay={() => playGame(game)}
                      onToggleFavorite={() => toggleFavorite(game.id)}
                      onShare={() => setShareGame(game)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Category / Search Results Grid */}
            {(casinoCategory !== 'all' || searchQuery) && (
              <div className="beast-section">
                <div className="beast-section-header">
                  <h3>
                    {searchQuery ? `Search: "${searchQuery}"` :
                      casinoCategory === 'favorites' ? '⭐ Your Favorites' :
                      casinoCategory === 'recent' ? '🕐 Recent Games' :
                      casinoCategory === 'originals' ? '🐾 illy Beast Originals' :
                      casinoCategory === 'slots' ? '🎰 Slots' :
                      casinoCategory === 'table' ? '🃏 Table Games' :
                      casinoCategory === 'live' ? '📺 Live Casino' :
                      casinoCategory === 'new' ? '✨ New Releases' : 'Games'}
                  </h3>
                </div>
                <div className="beast-game-grid">
                  {getFilteredGames().length === 0 ? (
                    <div className="beast-empty">
                      {casinoCategory === 'favorites' ? 'No favorites yet. Click ☆ on a game to add it!' :
                       casinoCategory === 'recent' ? 'No games played yet. Start playing!' :
                       'No games found.'}
                    </div>
                  ) : (
                    getFilteredGames().map(game => (
                      <BeastGameCard
                        key={game.id}
                        game={game}
                        isFavorite={beastUser?.favorites.includes(game.id) || false}
                        onPlay={() => playGame(game)}
                        onToggleFavorite={() => toggleFavorite(game.id)}
                        onShare={() => setShareGame(game)}
                      />
                    ))
                  )}
                </div>
              </div>
            )}

            {/* All categories row-by-row when showing 'all' with no search */}
            {casinoCategory === 'all' && !searchQuery && (
              <>
                <div className="beast-section">
                  <div className="beast-section-header">
                    <h3>🎰 Slots</h3>
                    <button className="beast-see-all" onClick={() => setCasinoCategory('slots')}>SEE ALL</button>
                  </div>
                  <div className="beast-game-scroll">
                    {BEAST_SLOTS.map(game => (
                      <BeastGameCard
                        key={game.id}
                        game={game}
                        isFavorite={beastUser?.favorites.includes(game.id) || false}
                        onPlay={() => playGame(game)}
                        onToggleFavorite={() => toggleFavorite(game.id)}
                        onShare={() => setShareGame(game)}
                      />
                    ))}
                  </div>
                </div>

                <div className="beast-section">
                  <div className="beast-section-header">
                    <h3>🃏 Table Games</h3>
                    <button className="beast-see-all" onClick={() => setCasinoCategory('table')}>SEE ALL</button>
                  </div>
                  <div className="beast-game-scroll">
                    {BEAST_TABLE_GAMES.map(game => (
                      <BeastGameCard
                        key={game.id}
                        game={game}
                        isFavorite={beastUser?.favorites.includes(game.id) || false}
                        onPlay={() => playGame(game)}
                        onToggleFavorite={() => toggleFavorite(game.id)}
                        onShare={() => setShareGame(game)}
                      />
                    ))}
                  </div>
                </div>

                <div className="beast-section">
                  <div className="beast-section-header">
                    <h3>📺 Live Casino</h3>
                    <button className="beast-see-all" onClick={() => setCasinoCategory('live')}>SEE ALL</button>
                  </div>
                  <div className="beast-game-scroll">
                    {BEAST_LIVE.map(game => (
                      <BeastGameCard
                        key={game.id}
                        game={game}
                        isFavorite={beastUser?.favorites.includes(game.id) || false}
                        onPlay={() => playGame(game)}
                        onToggleFavorite={() => toggleFavorite(game.id)}
                        onShare={() => setShareGame(game)}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* ─── SPORTS BETTING TAB ─── */
        <BeastSportsBook guildId={guildId} balance={beastUser?.beastBalance || { sol: 0, usdc: 0, usd: 0 }} />
      )}

      {/* Discord share modal */}
      {shareGame && !activeGame && (
        <BeastDiscordShare
          game={shareGame}
          guildId={guildId}
          onClose={() => setShareGame(null)}
        />
      )}

      {/* Footer */}
      <footer className="beast-footer">
        <div className="beast-footer-links">
          <span>illy Beast Gaming © {new Date().getFullYear()}</span>
          <span>|</span>
          <span>Provably Fair</span>
          <span>|</span>
          <span>Responsible Gaming</span>
          <span>|</span>
          <span>SOL / USDC / USD</span>
        </div>
        <div className="beast-footer-powered">
          Powered by DCB Event Manager
        </div>
      </footer>
    </div>
  )
}
