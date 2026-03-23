import React, { useState, useEffect } from 'react'
import api from '../../api'

interface Props {
  onClose: () => void
}

export default function BeastTreasuryAdmin({ onClose }: Props) {
  const [treasury, setTreasury] = useState<any>(null)
  const [transactions, setTransactions] = useState<any[]>([])
  const [loadCurrency, setLoadCurrency] = useState<'SOL' | 'USDC' | 'USD'>('USD')
  const [loadAmount, setLoadAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { fetchTreasury() }, [])

  const fetchTreasury = async () => {
    try {
      const r = await api.get('/beast/treasury')
      setTreasury(r.data?.treasury)
      setTransactions(r.data?.transactions || [])
    } catch {
      setMessage({ type: 'error', text: 'Failed to load treasury data' })
    }
  }

  const handleLoad = async () => {
    const amt = parseFloat(loadAmount)
    if (isNaN(amt) || amt <= 0) {
      setMessage({ type: 'error', text: 'Enter a valid amount' })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const r = await api.post('/beast/treasury/load', { currency: loadCurrency, amount: amt })
      setTreasury(r.data?.treasury)
      setMessage({ type: 'success', text: `Loaded ${amt} ${loadCurrency} into treasury` })
      setLoadAmount('')
      fetchTreasury()
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.response?.data?.error || 'Failed to load funds' })
    } finally {
      setLoading(false)
    }
  }

  const profit = treasury
    ? parseFloat(treasury.total_collected || 0) - parseFloat(treasury.total_payouts || 0)
    : 0

  return (
    <div className="beast-wallet-overlay" onClick={onClose}>
      <div className="beast-wallet-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="beast-wallet-header">
          <h2>BEAST TREASURY</h2>
          <button className="beast-wallet-close" onClick={onClose}>✕</button>
        </div>

        {message && <div className={`beast-wallet-msg ${message.type}`}>{message.text}</div>}

        {treasury ? (
          <>
            <div className="beast-wallet-balance" style={{ marginBottom: 16 }}>
              <div className="beast-wallet-balance-label">TREASURY BALANCE</div>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: '#a78bfa' }}>SOL</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{parseFloat(treasury.balance_sol || 0).toFixed(4)}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: '#a78bfa' }}>USDC</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{parseFloat(treasury.balance_usdc || 0).toFixed(2)}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: '#a78bfa' }}>USD</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{parseFloat(treasury.balance_usd || 0).toFixed(2)}</div>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16, padding: '0 16px' }}>
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: '#888' }}>WAGERED</div>
                <div style={{ fontWeight: 700, color: '#f59e0b' }}>${parseFloat(treasury.total_wagered || 0).toFixed(2)}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: '#888' }}>PAYOUTS</div>
                <div style={{ fontWeight: 700, color: '#ef4444' }}>${parseFloat(treasury.total_payouts || 0).toFixed(2)}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: '#888' }}>PROFIT</div>
                <div style={{ fontWeight: 700, color: profit >= 0 ? '#22c55e' : '#ef4444' }}>${profit.toFixed(2)}</div>
              </div>
            </div>

            <div className="beast-wallet-content" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 16 }}>
              <div className="beast-wallet-field">
                <label>LOAD FUNDS INTO TREASURY</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <select value={loadCurrency} onChange={e => setLoadCurrency(e.target.value as any)} className="beast-wallet-select" style={{ flex: '0 0 100px' }}>
                    <option value="SOL">SOL</option>
                    <option value="USDC">USDC</option>
                    <option value="USD">USD</option>
                  </select>
                  <input
                    type="number"
                    value={loadAmount}
                    onChange={e => setLoadAmount(e.target.value)}
                    placeholder="Amount"
                    step="0.01"
                    min="0"
                    className="beast-wallet-input"
                    style={{ flex: 1 }}
                  />
                  <button className="beast-wallet-action-btn" onClick={handleLoad} disabled={loading} style={{ flex: '0 0 auto' }}>
                    {loading ? '...' : 'Load'}
                  </button>
                </div>
              </div>
            </div>

            {transactions.length > 0 && (
              <div style={{ maxHeight: 200, overflowY: 'auto', margin: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 12 }}>
                <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 8 }}>RECENT TRANSACTIONS</div>
                {transactions.map((tx: any) => (
                  <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ color: '#a78bfa' }}>{tx.type}</span>
                    <span>{tx.amount} {tx.currency}</span>
                    <span style={{ color: '#666' }}>{new Date(tx.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>Loading treasury...</div>
        )}
      </div>
    </div>
  )
}
