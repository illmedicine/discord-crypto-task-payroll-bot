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

function Row({ event }: Props) {
  return (
    <tr>
      <td>{event.id}</td>
      <td>{event.title}</td>
      <td>{event.prize_amount} {event.currency}</td>
      <td>{event.status}</td>
    </tr>
  )
}

export default React.memo(Row)
