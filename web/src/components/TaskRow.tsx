import React from 'react'

type Task = {
  id: number
  guild_id: string
  recipient_address: string
  amount: number
  status: string
}

export default React.memo(function TaskRow({ task, style, onExecute }: { task: Task, style?: React.CSSProperties, onExecute?: (id:number) => void }) {
  return (
    <div className="table-row" style={style}>
      <div className="col col-id">{task.id}</div>
      <div className="col col-title">{task.recipient_address}</div>
      <div className="col col-prize">{task.amount}</div>
      <div className="col col-status">{task.status}</div>
      <div className="col col-actions"><button onClick={() => onExecute?.(task.id)}>Execute</button></div>
    </div>
  )
})
