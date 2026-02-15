import React, { useEffect, useState } from 'react'
import { api, API_BASE } from '../api'
import ProofRow from '../components/ProofRow'
import { FixedSizeList as List } from 'react-window'

type Transaction = {
  id: number
  from_address: string
  to_address: string
  amount: number
  signature: string
  status: string
  created_at: string
}

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
  source?: 'task' | 'qualification'
}

type Tab = 'proofs' | 'transactions'
type Props = { guildId: string }

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function History({ guildId }: Props) {
  const [tab, setTab] = useState<Tab>('proofs')

  // Transactions state
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [txLoading, setTxLoading] = useState(false)

  // Proofs state
  const [proofs, setProofs] = useState<Proof[]>([])
  const [proofsLoading, setProofsLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const loadTransactions = async () => {
    if (!guildId) return
    setTxLoading(true)
    try {
      const r = await api.get(`/admin/guilds/${guildId}/transactions?limit=100`)
      setTransactions(r.data || [])
    } finally {
      setTxLoading(false)
    }
  }

  const loadProofs = async () => {
    if (!guildId) return
    setProofsLoading(true)
    try {
      const res = await api.get(`/admin/guilds/${guildId}/proofs`, { params: { status: statusFilter } })
      setProofs(res.data || [])
    } catch (err) {
      console.error('[Proofs] Load error:', err)
      setProofs([])
    } finally {
      setProofsLoading(false)
    }
  }

  useEffect(() => {
    setTransactions([])
    setProofs([])
    if (guildId) {
      loadTransactions()
      loadProofs()
    }
  }, [guildId])

  useEffect(() => {
    if (guildId) loadProofs()
  }, [statusFilter])

  const handleProofAction = async (action: string, id: number) => {
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
      loadProofs()
    } catch (err) {
      console.error(`[Proofs] ${action} error:`, err)
    }
  }

  if (!guildId) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state-icon">📜</div>
          <div className="empty-state-text">Select a server to view history.</div>
        </div>
      </div>
    )
  }

  // Summary stats
  const totalOut = transactions.reduce((sum, tx) => sum + tx.amount, 0)
  const totalTx = transactions.length
  const pendingProofs = proofs.filter(p => p.status === 'pending').length
  const approvedProofs = proofs.filter(p => p.status === 'approved').length

  const loading = tab === 'transactions' ? txLoading : proofsLoading
  const refresh = tab === 'transactions' ? loadTransactions : loadProofs

  return (
    <div className="container">
      <div className="section-header">
        <h2 style={{ marginBottom: 0 }}>History</h2>
        <button className="btn btn-secondary btn-sm" onClick={refresh} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Refresh'}
        </button>
      </div>

      {/* Summary Stats */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-icon green">💸</div>
          <div className="stat-info">
            <div className="stat-label">Total Sent</div>
            <div className="stat-value">{totalOut.toFixed(2)} SOL</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue">📊</div>
          <div className="stat-info">
            <div className="stat-label">Transactions</div>
            <div className="stat-value">{totalTx}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ color: '#f59e0b' }}>⏳</div>
          <div className="stat-info">
            <div className="stat-label">Pending Proofs</div>
            <div className="stat-value">{pendingProofs}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ color: '#22c55e' }}>✅</div>
          <div className="stat-info">
            <div className="stat-label">Approved</div>
            <div className="stat-value">{approvedProofs}</div>
          </div>
        </div>
      </div>

      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '2px solid #2a2a4a' }}>
        <button
          onClick={() => setTab('proofs')}
          style={{
            padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: 'none', border: 'none', color: tab === 'proofs' ? '#7c5cfc' : '#888',
            borderBottom: tab === 'proofs' ? '2px solid #7c5cfc' : '2px solid transparent',
            marginBottom: -2, transition: 'all 0.15s',
          }}
        >
          Proofs &amp; Qualifications
        </button>
        <button
          onClick={() => setTab('transactions')}
          style={{
            padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: 'none', border: 'none', color: tab === 'transactions' ? '#7c5cfc' : '#888',
            borderBottom: tab === 'transactions' ? '2px solid #7c5cfc' : '2px solid transparent',
            marginBottom: -2, transition: 'all 0.15s',
          }}
        >
          Payout Transactions
        </button>
      </div>

      {/* ---- PROOFS TAB ---- */}
      {tab === 'proofs' && (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            <label style={{ fontSize: 13, color: '#aaa' }}>Status:</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #444', background: '#1a1a2e', color: '#e0e0e0' }}>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <span style={{ color: '#888', fontSize: 13 }}>{proofs.length} result{proofs.length !== 1 ? 's' : ''}</span>
          </div>

          {proofsLoading && <div className="spinner" />}

          {!proofsLoading && proofs.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">✅</div>
              <div className="empty-state-text">No {statusFilter === 'all' ? '' : statusFilter + ' '}proofs found.</div>
            </div>
          )}

          {!proofsLoading && proofs.length > 0 && (
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
                    onAction={handleProofAction}
                    onPreview={setPreviewUrl}
                  />
                )}
              </List>
            </div>
          )}
        </>
      )}

      {/* ---- TRANSACTIONS TAB ---- */}
      {tab === 'transactions' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">All Transactions</div>
          </div>

          {transactions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">💸</div>
              <div className="empty-state-text">{txLoading ? 'Loading...' : 'No transactions recorded yet.'}</div>
            </div>
          ) : (
            <div className="tx-list">
              {transactions.map(tx => (
                <div key={tx.id} className="tx-item">
                  <div className="tx-icon outgoing">↗</div>
                  <div className="tx-details">
                    <div className="tx-title">
                      To {tx.to_address ? `${tx.to_address.slice(0, 8)}...${tx.to_address.slice(-6)}` : 'Unknown'}
                    </div>
                    <div className="tx-sub">
                      From {tx.from_address ? `${tx.from_address.slice(0, 8)}...${tx.from_address.slice(-6)}` : 'Treasury'} &bull; {timeAgo(tx.created_at)}
                    </div>
                  </div>
                  <div className="tx-amount negative">-{tx.amount} SOL</div>
                  <span className={`badge ${tx.status === 'confirmed' ? 'badge-completed' : 'badge-pending'}`}>
                    {tx.status}
                  </span>
                  {tx.signature && (
                    <a
                      href={`https://solscan.io/tx/${tx.signature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm btn-secondary"
                      style={{ marginLeft: 4, fontSize: 11 }}
                      title="View on Solscan"
                    >
                      🔗
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
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
