import React, { useEffect, useState } from 'react'
import { api } from '../api'

type Transaction = {
  id: number
  from_address: string
  to_address: string
  amount: number
  signature: string
  status: string
  created_at: string
}

type Props = {
  guildId: string
}

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
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (!guildId) return
    setLoading(true)
    try {
      const r = await api.get(`/admin/guilds/${guildId}/transactions?limit=100`)
      setTransactions(r.data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setTransactions([])
    if (guildId) load()
  }, [guildId])

  if (!guildId) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state-icon">📜</div>
          <div className="empty-state-text">Select a server to view transaction history.</div>
        </div>
      </div>
    )
  }

  // Summary stats
  const totalOut = transactions.reduce((sum, tx) => sum + tx.amount, 0)
  const totalCount = transactions.length

  return (
    <div className="container">
      <div className="section-header">
        <h2 style={{ marginBottom: 0 }}>Transaction History</h2>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Refresh'}
        </button>
      </div>

      {/* Summary Stats */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
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
            <div className="stat-value">{totalCount}</div>
          </div>
        </div>
      </div>

      {/* Transaction List */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">All Transactions</div>
        </div>

        {transactions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📜</div>
            <div className="empty-state-text">{loading ? 'Loading...' : 'No transactions recorded yet.'}</div>
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
    </div>
  )
}
