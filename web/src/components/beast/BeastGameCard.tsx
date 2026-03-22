import React from 'react'

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
  isFavorite: boolean
  onPlay: () => void
  onToggleFavorite: () => void
  onShare: () => void
}

const BeastGameCard = React.memo(function BeastGameCard({ game, isFavorite, onPlay, onToggleFavorite, onShare }: Props) {
  return (
    <div className="beast-game-card" onClick={onPlay}>
      <div className="beast-game-card-img">
        <span className="beast-game-card-emoji">{game.img}</span>
        {game.category === 'originals' && (
          <span className="beast-game-card-badge originals">BEAST ORIGINALS</span>
        )}
        {game.category === 'live' && (
          <span className="beast-game-card-badge live">LIVE</span>
        )}
        <div className="beast-game-card-overlay">
          <button className="beast-card-play-btn">▶ PLAY</button>
        </div>
        <div className="beast-game-card-actions" onClick={e => e.stopPropagation()}>
          <button
            className={`beast-card-fav ${isFavorite ? 'active' : ''}`}
            onClick={onToggleFavorite}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            {isFavorite ? '★' : '☆'}
          </button>
          <button
            className="beast-card-share"
            onClick={onShare}
            title="Share to Discord"
          >
            📤
          </button>
        </div>
      </div>
      <div className="beast-game-card-info">
        <div className="beast-game-card-name">{game.name}</div>
        <div className="beast-game-card-desc">{game.desc}</div>
        <div className="beast-game-card-meta">
          <span className="beast-game-card-bet">Min ${game.minBet.toFixed(2)}</span>
          <span className="beast-game-card-edge">{game.houseEdge}% edge</span>
        </div>
      </div>
    </div>
  )
})

export default BeastGameCard
