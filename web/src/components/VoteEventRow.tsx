import React from 'react'

type Props = {
  event: {
    id: number
    title: string
    prize_amount: number
    currency: string
    status: string
  }
}

function Row({ event, style }: Props & { style?: React.CSSProperties }) {
  return (
    <div className="table-row" style={style}>
      <div className="col col-id">{event.id}</div>
      <div className="col col-title">{event.title}</div>
      <div className="col col-prize">{event.prize_amount} {event.currency}</div>
      <div className="col col-status">{event.status}</div>
    </div>
  )
}

export default React.memo(Row)
