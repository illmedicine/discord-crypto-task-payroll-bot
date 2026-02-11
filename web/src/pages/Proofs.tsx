import React, { useEffect, useState } from 'react'
import { api } from '../api'
import ProofRow from '../components/ProofRow'
import { FixedSizeList as List } from 'react-window'

type Proof = {
  id: number
  title: string
  assigned_user_id: string
  screenshot_url: string
  verification_url: string
  notes: string
  status: string
  payout_amount: number
  payout_currency: string
  submitted_at: string
}

interface Props { guildId: string }

export default function Proofs({ guildId }: Props) {
  const [proofs, setProofs] = useState<Proof[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('pending')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => { if (guildId) load() }, [guildId, statusFilter])

  const load = async () => {
    if (!guildId) return
    setLoading(true)
    try {
      const res = await api.get(`/admin/guilds/${guildId}/proofs`, { params: { status: statusFilter } })
      setProofs(res.data || [])
    } catch (err) {
      console.error('[Proofs] Load error:', err)
      setProofs([])
    } finally {
      setLoading(false)
    }
  }

  const handleAction = async (action: string, id: number) => {
    try {
      if (action === 'approve') {
        await api.post(`/admin/guilds/${guildId}/proofs/${id}/approve`, { pay: false })
      } else if (action === 'approve_pay') {
        await api.post(`/admin/guilds/${guildId}/proofs/${id}/approve`, { pay: true })
      } else if (action === 'reject') {
        const reason = prompt('Reason for rejection?')
        if (!reason) return
        await api.post(`/admin/guilds/${guildId}/proofs/${id}/reject`, { reason })
      }
      load()
    } catch (err) {
      console.error(`[Proofs] ${action} error:`, err)
    }
  }

  if (!guildId) return <div className="container"><p>Select a server to view proofs.</p></div>

  return (
    <div className="container">
      <h2>Proof Submissions</h2>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <label>Status:</label>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #444', background: '#1a1a2e', color: '#e0e0e0' }}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
        <button onClick={load} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
        <span style={{ color: '#888', fontSize: 13 }}>{proofs.length} result{proofs.length !== 1 ? 's' : ''}</span>
      </div>

      {loading && <div className="spinner" />}

      {!loading && proofs.length === 0 && (
        <p style={{ color: '#888', padding: 24, textAlign: 'center' }}>No {statusFilter === 'all' ? '' : statusFilter} proofs found.</p>
      )}

      {!loading && proofs.length > 0 && (
        <div className="table">
          <div className="table-head">
            <div className="col" style={{ width: 50 }}>ID</div>
            <div className="col" style={{ flex: 1 }}>Task</div>
            <div className="col" style={{ width: 120 }}>User</div>
            <div className="col" style={{ width: 100 }}>Screenshot</div>
            <div className="col" style={{ width: 80 }}>Status</div>
            <div className="col" style={{ width: 100 }}>Payout</div>
            {statusFilter === 'pending' && <div className="col" style={{ width: 260 }}>Actions</div>}
          </div>
          <List
            height={Math.min(proofs.length * 88, 600)}
            itemCount={proofs.length}
            itemSize={88}
            width={'100%'}
            itemKey={index => proofs[index].id}
          >
            {({ index, style }) => (
              <ProofRow
                proof={proofs[index]}
                style={style}
                showActions={statusFilter === 'pending'}
                onAction={handleAction}
                onPreview={setPreviewUrl}
              />
            )}
          </List>
        </div>
      )}

      {/* Image preview modal */}
      {previewUrl && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, cursor: 'pointer' }}
          onClick={() => setPreviewUrl(null)}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img
              src={previewUrl}
              alt="Proof screenshot"
              style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 0 40px rgba(0,0,0,0.5)' }}
            />
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ position: 'absolute', bottom: -36, left: '50%', transform: 'translateX(-50%)', color: '#7c5cfc', fontSize: 13, textDecoration: 'underline' }}
            >
              Open in new tab
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
