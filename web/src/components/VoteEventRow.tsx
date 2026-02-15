import React from 'react'
import Countdown from './Countdown'

type Props = {
  event: {
    id: number
    title: string
    prize_amount: number
    currency: string
    status: string
    ends_at?: string | null
    current_participants?: number
    max_participants?: number
  }
}

function Row({ event, style }: Props & { style?: React.CSSProperties }) {
  return (
    <div className="table-row" style={style}>
      <div className="col col-id">{event.id}</div>
      <div className="col col-title">{event.title}</div>
      <div className="col col-prize">{event.prize_amount} {event.currency}</div>
      <div className="col col-status">{event.status}</div>
      {event.current_participants != null && event.max_participants != null && (
        <div className="col" style={{ fontSize: 12 }}>{event.current_participants}/{event.max_participants}</div>
      )}
      <div className="col" style={{ fontSize: 12 }}>
        <Countdown endsAt={event.ends_at} prefix='⏱️ ' endedText='—' />
      </div>
    </div>
  )
}

export default React.memo(Row)
