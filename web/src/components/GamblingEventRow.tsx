import React from 'react'
import Countdown from './Countdown'

type Props = {
  event: {
    id: number
    title: string
    mode: string
    prize_amount: number
    currency: string
    entry_fee: number
    status: string
    ends_at?: string | null
    current_players?: number
    max_players?: number
    winning_slot?: number | null
    winner_names?: string | null
  }
}

function GamblingEventRow({ event, style }: Props & { style?: React.CSSProperties }) {
  const modeLabel = event.mode === 'pot' ? '🏦 Pot' : '🏠 House'
  const prizeLabel = event.mode === 'pot'
    ? `${event.entry_fee} ${event.currency}/bet`
    : `${event.prize_amount} ${event.currency}`

  return (
    <tr style={style}>
      <td>#{event.id}</td>
      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{event.title}</td>
      <td><span style={{ fontSize: 11 }}>{modeLabel}</span></td>
      <td><span className="sol-badge">{prizeLabel}</span></td>
      <td>{event.current_players ?? 0}/{event.max_players ?? '?'}</td>
      <td>
        <span className={`badge ${
          event.status === 'active' ? 'badge-active' :
          event.status === 'completed' ? 'badge-completed' :
          'badge-ended'
        }`}>{event.status}</span>
      </td>
      <td style={{ fontSize: 12 }}>
        <Countdown endsAt={event.ends_at} prefix='⏱️ ' endedText='—' />
      </td>
      <td>
        {event.winner_names ? `🏆 ${event.winner_names}` : event.winning_slot ? `🏆 Horse #${event.winning_slot}` : '—'}
      </td>
    </tr>
  )
}

export default React.memo(GamblingEventRow)
