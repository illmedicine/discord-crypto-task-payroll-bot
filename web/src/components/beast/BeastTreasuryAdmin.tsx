import React, { useState, useEffect } from 'react'
import api from '../../api'

interface Props {
  guildId?: string
  onClose: () => void
}

type LedgerTab = 'overview' | 'ledger' | 'deposits'
type TxnFilter = 'all' | 'wager_in' | 'payout' | 'deposit_from_dcb' | 'load' | 'withdrawal' | 'fee_collected'

const SOLSCAN_TX = 'https://solscan.io/tx/'
const truncSig = (s: string) => s ? `${s.slice(0, 6)}…${s.slice(-4)}` : ''

export default function BeastTreasuryAdmin({ guildId, onClose }: Props) {
  const [treasury, setTreasury] = useState<any>(null)
  const [transactions, setTransactions] = useState<any[]>([])
  const [ledgerData, setLedgerData] = useState<any>(null)
  const [ledgerFilter, setLedgerFilter] = useState<TxnFilter>('all')
  const [ledgerPage, setLedgerPage] = useState(0)
  const [tab, setTab] = useState<LedgerTab>('overview')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [walletInfo, setWalletInfo] = useState<{ configured: boolean; address?: string; onChainSol?: number } | null>(null)
  const [sweepAmount, setSweepAmount] = useState('')

  useEffect(() => { fetchTreasury(); fetchWalletInfo() }, [])
  useEffect(() => { if (tab === 'ledger' || tab === 'deposits') fetchLedger() }, [tab, ledgerFilter, ledgerPage])

  const fetchWalletInfo = async () => {
    try {
      const r = await api.get('/beast/treasury/wallet-info')
      setWalletInfo(r.data)
    } catch { setWalletInfo({ configured: false }) }
  }

  const fetchTreasury = async () => {
    try {
      const r = await api.get('/beast/treasury')
      setTreasury(r.data?.treasury)
      setTransactions(r.data?.transactions || [])
    } catch {
      setMessage({ type: 'error', text: 'Failed to load treasury data' })
    }
  }

  const fetchLedger = async () => {
    try {
      const r = await api.get('/beast/treasury/ledger', {
        params: { type: ledgerFilter, limit: 100, offset: ledgerPage * 100 }
      })
      setLedgerData(r.data)
    } catch {
      setMessage({ type: 'error', text: 'Failed to load ledger' })
    }
  }



  const profit = treasury
    ? parseFloat(treasury.total_collected || 0) - parseFloat(treasury.total_payouts || 0)
    : 0

  const txnTypeLabel = (type: string) => {
    switch (type) {
      case 'wager_in': return '🎰 Wager'
      case 'payout': return '💸 Payout'
      case 'deposit_from_dcb': return '📥 DCB Deposit'
      case 'load': return '🏦 Treasury Load'
      case 'withdrawal': return '📤 Withdrawal'
      case 'fee_collected': return '💎 Fee'
      default: return type
    }
  }
  const txnTypeColor = (type: string) => {
    switch (type) {
      case 'wager_in': return '#22c55e'
      case 'payout': return '#ef4444'
      case 'deposit_from_dcb': return '#3b82f6'
      case 'load': return '#f59e0b'
      case 'withdrawal': return '#a855f7'
      case 'fee_collected': return '#06b6d4'
      default: return '#888'
    }
  }

  return (
    <div className="beast-wallet-overlay" onClick={onClose}>
      <div className="beast-wallet-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 660, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="beast-wallet-header">
          <h2>BEAST TREASURY</h2>
          <button className="beast-wallet-close" onClick={onClose}>✕</button>
        </div>

        {message && <div className={`beast-wallet-msg ${message.type}`}>{message.text}</div>}

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '0 16px' }}>
          {(['overview', 'ledger', 'deposits'] as LedgerTab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '10px 16px', background: 'none', border: 'none', color: tab === t ? '#a78bfa' : '#888',
              borderBottom: tab === t ? '2px solid #a78bfa' : '2px solid transparent',
              cursor: 'pointer', fontWeight: tab === t ? 700 : 400, fontSize: '0.85rem', textTransform: 'uppercase'
            }}>{t === 'overview' ? '📊 Overview' : t === 'ledger' ? '📒 Ledger' : '📥 Deposits'}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {/* ─── OVERVIEW TAB ─── */}
          {tab === 'overview' && (
            <>
              {/* Wallet Configuration Status */}
              <div style={{ background: walletInfo?.configured ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.1)', border: `1px solid ${walletInfo?.configured ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`, borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: '1.1rem' }}>{walletInfo?.configured ? '✅' : '⚠️'}</span>
                  <strong style={{ color: walletInfo?.configured ? '#22c55e' : '#ef4444', fontSize: '0.85rem' }}>
                    {walletInfo?.configured ? 'House Wallet Connected' : 'House Wallet NOT Connected'}
                  </strong>
                </div>
                {walletInfo?.configured ? (
                  <div style={{ fontSize: '0.78rem', color: '#aaa' }}>
                    <div>Address: <a href={`https://solscan.io/account/${walletInfo.address}`} target="_blank" rel="noopener noreferrer" style={{ color: '#a78bfa', textDecoration: 'none' }}>{walletInfo.address}</a></div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: '0.78rem', color: '#ccc', marginBottom: 10 }}>
                      No treasury wallet is configured. Players cannot place bets until a house wallet is connected.
                      Use your existing DCB Link wallet or generate a new one.
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        disabled={loading}
                        onClick={async () => {
                          setLoading(true); setMessage(null)
                          try {
                            const r = await api.post('/beast/treasury/use-dcb-wallet')
                            setMessage({ type: 'success', text: r.data?.message || 'DCB wallet linked!' })
                            fetchWalletInfo(); fetchTreasury()
                          } catch (err: any) { setMessage({ type: 'error', text: err?.response?.data?.error || 'Failed to link DCB wallet' }) }
                          finally { setLoading(false) }
                        }}
                        style={{ padding: '8px 16px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff' }}
                      >
                        🔗 Use My DCB Wallet
                      </button>
                      <button
                        disabled={loading}
                        onClick={async () => {
                          setLoading(true); setMessage(null)
                          try {
                            const r = await api.post('/beast/treasury/setup-wallet')
                            setMessage({ type: 'success', text: r.data?.message || 'Wallet generated!' })
                            fetchWalletInfo(); fetchTreasury()
                          } catch (err: any) { setMessage({ type: 'error', text: err?.response?.data?.error || 'Failed to generate wallet' }) }
                          finally { setLoading(false) }
                        }}
                        style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', background: 'rgba(255,255,255,0.05)', color: '#ccc' }}
                      >
                        🆕 Generate New Wallet
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {treasury && (
                <>
              <div className="beast-wallet-balance" style={{ marginBottom: 16 }}>
                <div className="beast-wallet-balance-label">TREASURY BALANCE</div>
                <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                  {(['SOL', 'USDC', 'USD'] as const).map(c => (
                    <div key={c} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.75rem', color: '#a78bfa' }}>{c}</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                        {parseFloat(treasury[`balance_${c.toLowerCase()}`] || 0).toFixed(c === 'SOL' ? 6 : 2)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: '#888' }}>WAGERED</div>
                  <div style={{ fontWeight: 700, color: '#f59e0b' }}>{parseFloat(treasury.total_wagered || 0).toFixed(4)}</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: '#888' }}>PAYOUTS</div>
                  <div style={{ fontWeight: 700, color: '#ef4444' }}>{parseFloat(treasury.total_payouts || 0).toFixed(4)}</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: '#888' }}>PROFIT</div>
                  <div style={{ fontWeight: 700, color: profit >= 0 ? '#22c55e' : '#ef4444' }}>{profit.toFixed(4)}</div>
                </div>
              </div>

              {/* Transfer to Guild Treasury */}
              {guildId && profit > 0 && (
                <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#3b82f6', marginBottom: 8 }}>💸 Transfer to Guild Treasury</div>
                  <div style={{ fontSize: '0.78rem', color: '#aaa', marginBottom: 10 }}>
                    Move Beast Gaming profits to your DCB Guild Treasury wallet.
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      max={parseFloat(treasury?.balance_sol || 0)}
                      value={sweepAmount}
                      onChange={e => setSweepAmount(e.target.value)}
                      placeholder={`Max: ${parseFloat(treasury?.balance_sol || 0).toFixed(4)} SOL`}
                      style={{ flex: 1, minWidth: 120, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: '0.85rem' }}
                    />
                    <button
                      disabled={loading || !sweepAmount || parseFloat(sweepAmount) <= 0}
                      onClick={async () => {
                        const amt = parseFloat(sweepAmount)
                        if (!amt || amt <= 0) return
                        if (!confirm(`Transfer ${amt.toFixed(6)} SOL from Beast Treasury to your Guild Treasury?`)) return
                        setLoading(true); setMessage(null)
                        try {
                          const r = await api.post('/beast/treasury/sweep-to-guild', { guildId, amount: amt, currency: 'SOL' })
                          setMessage({ type: 'success', text: r.data?.message || `Transferred ${amt} SOL` })
                          setSweepAmount('')
                          fetchTreasury()
                        } catch (err: any) {
                          setMessage({ type: 'error', text: err?.response?.data?.error || 'Transfer failed' })
                        } finally { setLoading(false) }
                      }}
                      style={{ padding: '8px 16px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff', opacity: (!sweepAmount || parseFloat(sweepAmount) <= 0) ? 0.5 : 1 }}
                    >
                      {loading ? '...' : '➡️ Transfer to Guild'}
                    </button>
                    <button
                      disabled={loading}
                      onClick={() => setSweepAmount(String(parseFloat(treasury?.balance_sol || 0).toFixed(6)))}
                      style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#ccc', fontSize: '0.78rem', cursor: 'pointer' }}
                    >
                      Max
                    </button>
                  </div>
                </div>
              )}

              {/* Ledger summary stats */}
              {ledgerData?.stats && (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 8 }}>AUDIT SUMMARY</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: '0.8rem' }}>
                    <div>Total Transactions: <strong>{ledgerData.stats.total_txns || 0}</strong></div>
                    <div>Total Wagers: <strong style={{ color: '#22c55e' }}>{parseFloat(ledgerData.stats.total_wagers || 0).toFixed(4)}</strong></div>
                    <div>Total Payouts: <strong style={{ color: '#ef4444' }}>{parseFloat(ledgerData.stats.total_payouts || 0).toFixed(4)}</strong></div>
                    <div>DCB Deposits: <strong style={{ color: '#3b82f6' }}>{parseFloat(ledgerData.stats.total_deposits || 0).toFixed(4)}</strong></div>
                    <div>Treasury Loaded: <strong style={{ color: '#f59e0b' }}>{parseFloat(ledgerData.stats.total_loaded || 0).toFixed(4)}</strong></div>
                    <div>Withdrawals: <strong style={{ color: '#a855f7' }}>{parseFloat(ledgerData.stats.total_withdrawals || 0).toFixed(4)}</strong></div>
                  </div>
                </div>
              )}

              {/* Recent activity */}
              {transactions.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 8 }}>RECENT ACTIVITY (last 10)</div>
                  {transactions.slice(0, 10).map((tx: any) => (
                    <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span style={{ color: txnTypeColor(tx.type), minWidth: 110 }}>{txnTypeLabel(tx.type)}</span>
                      <span style={{ flex: 1, color: '#ccc', marginLeft: 8 }}>{tx.username || tx.user_id?.slice(0, 8) || '—'}</span>
                      <span style={{ fontWeight: 600, minWidth: 80, textAlign: 'right' }}>{parseFloat(tx.amount || 0).toFixed(4)} {tx.currency}</span>
                      {tx.tx_signature ? (
                        <a href={`${SOLSCAN_TX}${tx.tx_signature}`} target="_blank" rel="noopener noreferrer" style={{ color: '#a78bfa', fontSize: '0.7rem', marginLeft: 6, textDecoration: 'none', whiteSpace: 'nowrap' }} title={tx.tx_signature}>⛓ {truncSig(tx.tx_signature)}</a>
                      ) : (
                        <span style={{ color: '#555', fontSize: '0.7rem', marginLeft: 6, minWidth: 40 }}>—</span>
                      )}
                      <span style={{ color: '#666', marginLeft: 8, fontSize: '0.7rem', minWidth: 90, textAlign: 'right' }}>{new Date(tx.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
                </>
              )}
            </>
          )}

          {/* ─── FULL LEDGER TAB ─── */}
          {tab === 'ledger' && (
            <>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {(['all', 'wager_in', 'payout', 'deposit_from_dcb', 'load', 'withdrawal', 'fee_collected'] as TxnFilter[]).map(f => (
                  <button key={f} onClick={() => { setLedgerFilter(f); setLedgerPage(0) }} style={{
                    padding: '4px 10px', borderRadius: 6, border: 'none', fontSize: '0.75rem', cursor: 'pointer',
                    background: ledgerFilter === f ? '#a78bfa' : 'rgba(255,255,255,0.08)',
                    color: ledgerFilter === f ? '#000' : '#ccc', fontWeight: ledgerFilter === f ? 700 : 400
                  }}>{f === 'all' ? 'All' : txnTypeLabel(f)}</button>
                ))}
              </div>

              {ledgerData?.total !== undefined && (
                <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 8 }}>
                  Showing {ledgerData.transactions?.length || 0} of {ledgerData.total} records
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.15)', color: '#888' }}>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>Type</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>User</th>
                      <th style={{ padding: '6px 4px', textAlign: 'right' }}>Amount</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>Currency</th>
                      <th style={{ padding: '6px 4px', textAlign: 'center' }}>TX</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>Details</th>
                      <th style={{ padding: '6px 4px', textAlign: 'right' }}>Date/Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ledgerData?.transactions || []).map((tx: any) => (
                      <tr key={tx.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '5px 4px', color: txnTypeColor(tx.type), whiteSpace: 'nowrap' }}>{txnTypeLabel(tx.type)}</td>
                        <td style={{ padding: '5px 4px', color: '#ddd', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx.username || tx.user_id?.slice(0, 10) || '—'}</td>
                        <td style={{ padding: '5px 4px', textAlign: 'right', fontWeight: 600, color: tx.type === 'payout' || tx.type === 'withdrawal' ? '#ef4444' : '#22c55e' }}>
                          {tx.type === 'payout' || tx.type === 'withdrawal' ? '-' : '+'}{parseFloat(tx.amount || 0).toFixed(6)}
                        </td>
                        <td style={{ padding: '5px 4px', color: '#a78bfa' }}>{tx.currency}</td>
                        <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                          {tx.tx_signature ? (
                            <a href={`${SOLSCAN_TX}${tx.tx_signature}`} target="_blank" rel="noopener noreferrer"
                              style={{ color: '#a78bfa', fontSize: '0.72rem', textDecoration: 'none', fontFamily: 'monospace', padding: '2px 6px', background: 'rgba(168,85,247,0.1)', borderRadius: 4, border: '1px solid rgba(168,85,247,0.25)' }}
                              title={`View on Solscan: ${tx.tx_signature}`}>
                              ⛓ {truncSig(tx.tx_signature)}
                            </a>
                          ) : (
                            <span style={{ color: '#444', fontSize: '0.7rem' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '5px 4px', color: '#999', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tx.details}>{tx.details || '—'}</td>
                        <td style={{ padding: '5px 4px', textAlign: 'right', color: '#666', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>{new Date(tx.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {ledgerData && ledgerData.total > 100 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                  <button onClick={() => setLedgerPage(p => Math.max(0, p - 1))} disabled={ledgerPage === 0}
                    style={{ padding: '4px 12px', borderRadius: 4, border: 'none', background: 'rgba(255,255,255,0.08)', color: '#ccc', cursor: 'pointer' }}>← Prev</button>
                  <span style={{ padding: '4px 8px', color: '#888', fontSize: '0.8rem' }}>Page {ledgerPage + 1}</span>
                  <button onClick={() => setLedgerPage(p => p + 1)} disabled={(ledgerPage + 1) * 100 >= ledgerData.total}
                    style={{ padding: '4px 12px', borderRadius: 4, border: 'none', background: 'rgba(255,255,255,0.08)', color: '#ccc', cursor: 'pointer' }}>Next →</button>
                </div>
              )}
            </>
          )}

          {/* ─── DCB DEPOSITS TAB ─── */}
          {tab === 'deposits' && (
            <>
              <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 12 }}>
                DCB → BEAST WALLET TRANSFERS (audit trail for all user deposits)
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.15)', color: '#888' }}>
                    <th style={{ padding: '6px 4px', textAlign: 'left' }}>User</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '6px 4px', textAlign: 'left' }}>Currency</th>
                    <th style={{ padding: '6px 4px', textAlign: 'left' }}>Direction</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right' }}>Date/Time</th>
                  </tr>
                </thead>
                <tbody>
                  {(ledgerData?.dcbTransfers || []).map((tx: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '5px 4px', color: '#ddd' }}>{tx.username || tx.user_id?.slice(0, 12) || '—'}</td>
                      <td style={{ padding: '5px 4px', textAlign: 'right', fontWeight: 600, color: '#3b82f6' }}>{parseFloat(tx.amount || 0).toFixed(6)}</td>
                      <td style={{ padding: '5px 4px', color: '#a78bfa' }}>{tx.currency}</td>
                      <td style={{ padding: '5px 4px', color: tx.direction === 'dcb_to_beast' ? '#22c55e' : '#ef4444' }}>{tx.direction === 'dcb_to_beast' ? '📥 DCB → Beast' : '📤 Beast → DCB'}</td>
                      <td style={{ padding: '5px 4px', textAlign: 'right', color: '#666', fontSize: '0.72rem' }}>{new Date(tx.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                  {(!ledgerData?.dcbTransfers || ledgerData.dcbTransfers.length === 0) && (
                    <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#666' }}>No DCB transfers recorded yet</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {!treasury && tab === 'overview' && (
            <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>Loading treasury...</div>
          )}
        </div>
      </div>
    </div>
  )
}
