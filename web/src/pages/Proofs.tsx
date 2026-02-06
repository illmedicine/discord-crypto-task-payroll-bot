import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { api } from '../api'

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
      <table>
        <thead><tr><th>ID</th><th>Title</th><th>User</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {proofs.map(p => (
            <tr key={p.id}><td>{p.id}</td><td>{p.title}</td><td>{p.assigned_user_id}</td><td>{p.status}</td><td>
              <button onClick={async ()=>{ await axios.post(`/api/proofs/${p.id}/approve`, { pay: false }); load(); }}>Approve</button>
              <button style={{ marginLeft:8 }} onClick={async ()=>{ await axios.post(`/api/proofs/${p.id}/approve`, { pay: true }); load(); }}>Approve & Pay</button>
              <button style={{ marginLeft:8 }} onClick={async ()=>{ const reason = prompt('Reason for rejection?'); if(reason) { await axios.post(`/api/proofs/${p.id}/reject`, { reason }); load(); } }}>Reject</button>
            </td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
