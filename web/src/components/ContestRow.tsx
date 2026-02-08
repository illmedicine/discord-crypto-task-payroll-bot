import React from 'react'

type Props = {
  contest: {
    id: number
    title: string
    prize_amount: number
    currency: string
    status: string
  }
  style?: React.CSSProperties
}

function Row({ contest, style }: Props) {
  return (
    <div className="table-row" style={style}>
      <div className="col col-id">{contest.id}</div>
      <div className="col col-title">{contest.title}</div>
      <div className="col col-prize">{contest.prize_amount} {contest.currency}</div>
      <div className="col col-status">{contest.status}</div>
    </div>
  )
}

export default React.memo(Row)
