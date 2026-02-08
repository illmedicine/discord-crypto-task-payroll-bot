import React from 'react'
import LazyImage from './LazyImage'

type Proof = { id:number, title:string, assigned_user_id:string, screenshot_url:string, status:string }

export default React.memo(function ProofRow({ proof, style, onAction }: { proof: Proof, style?: React.CSSProperties, onAction?: (action: string, id:number) => void }) {
  return (
    <div className="table-row" style={style}>
      <div className="col col-id">{proof.id}</div>
      <div className="col col-title">{proof.title}</div>
      <div className="col col-user">{proof.assigned_user_id}</div>
      <div className="col col-status">{proof.status}</div>
      <div className="col col-actions">
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onAction?.('approve', proof.id)}>Approve</button>
          <button onClick={() => onAction?.('approve_pay', proof.id)}>Approve & Pay</button>
          <button onClick={() => onAction?.('reject', proof.id)}>Reject</button>
        </div>
      </div>
    </div>
  )
})
