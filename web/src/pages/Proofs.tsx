import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { api } from '../api'
import ProofRow from '../components/ProofRow'
import { FixedSizeList as List } from 'react-window'

type Proof = { id:number, title:string, assigned_user_id:string, screenshot_url:string, status:string }

export default function Proofs() {
  const [proofs, setProofs] = useState<Proof[]>([])
  const [guildId, setGuildId] = useState('TEST_GUILD')

  useEffect(() => { load(); }, [])
  const load = async () => {
    const res = await api.get('/proofs/pending', { params: { guild_id: guildId } });
    setProofs(res.data || []);
  }

  return (
    <div className="container">
      <h2>Pending Proofs</h2>
      <div>
        <input placeholder="Guild ID" value={guildId} onChange={e => setGuildId(e.target.value)} />
        <button onClick={load}>Load</button>
      </div>
      <div className="table">
        <div className="table-head">
          <div className="col col-id">ID</div>
          <div className="col col-title">Title</div>
          <div className="col col-user">User</div>
          <div className="col col-status">Status</div>
          <div className="col col-actions">Actions</div>
        </div>
        <List
          height={400}
          itemCount={proofs.length}
          itemSize={72}
          width={'100%'}
          itemKey={index => proofs[index].id}
        >
          {({ index, style }) => (
            <ProofRow proof={proofs[index]} style={style} onAction={async (action,id) => {
              if (action === 'approve') { await axios.post(`/api/proofs/${id}/approve`, { pay: false }); load(); }
              if (action === 'approve_pay') { await axios.post(`/api/proofs/${id}/approve`, { pay: true }); load(); }
              if (action === 'reject') { const reason = prompt('Reason for rejection?'); if (reason) { await axios.post(`/api/proofs/${id}/reject`, { reason }); load(); }}
            }} />
          )}
        </List>
      </div>
    </div>
  )
}
