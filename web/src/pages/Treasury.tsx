import React, { useEffect, useState } from 'react'
import { api } from '../api'

type Wallet = {
  guild_id: string
  wallet_address: string
  label: string
  budget_total: number
  budget_spent: number
  budget_currency: string
  network: string
  configured_at: string
  configured_by: string
  updated_at: string
}

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

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr || ''
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export default function Treasury({ guildId }: Props) {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [solBalance, setSolBalance] = useState<number | null>(null)
  const [balLoading, setBalLoading] = useState(false)

  // Form state for connecting wallet
  const [inputAddr, setInputAddr] = useState('')
  const [inputLabel, setInputLabel] = useState('Treasury')
  const [inputNetwork, setInputNetwork] = useState('mainnet-beta')

  // Budget form
  const [budgetInput, setBudgetInput] = useState('')
  const [budgetCurrency, setBudgetCurrency] = useState('SOL')

  // Edit mode
  const [editing, setEditing] = useState(false)
  const [editAddr, setEditAddr] = useState('')
  const [editLabel, setEditLabel] = useState('')
  const [editNetwork, setEditNetwork] = useState('')

  const load = async () => {
    if (!guildId) return
    setLoading(true)
    try {
      const [walletRes, txRes] = await Promise.all([
        api.get(`/admin/guilds/${guildId}/wallet`),
        api.get(`/admin/guilds/${guildId}/transactions?limit=10`),
      ])
      const w = walletRes.data as Wallet | null
      setWallet(w)
      setTransactions((txRes.data || []) as Transaction[])
      if (w) {
        setBudgetInput(String(w.budget_total || 0))
        setBudgetCurrency(w.budget_currency || 'SOL')
        fetchSolBalance(w.wallet_address, w.network)
      } else {
        setSolBalance(null)
      }
    } catch {
      setWallet(null)
    } finally {
      setLoading(false)
    }
  }

  const fetchSolBalance = async (address: string, network: string) => {
    try {
      setBalLoading(true)
      const rpcUrl = network === 'devnet'
        ? 'https://api.devnet.solana.com'
        : 'https://api.mainnet-beta.solana.com'
      const resp = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [address],
        }),
      })
      const data = await resp.json()
      if (data?.result?.value !== undefined) {
        setSolBalance(data.result.value / 1e9)
      } else {
        setSolBalance(null)
      }
    } catch {
      setSolBalance(null)
    } finally {
      setBalLoading(false)
    }
  }

  useEffect(() => {
    setWallet(null)
    setSolBalance(null)
    setTransactions([])
    setEditing(false)
    if (guildId) load()
  }, [guildId])

  const connectWallet = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guildId || !inputAddr) return
    setSaving(true)
    try {
      await api.post(`/admin/guilds/${guildId}/wallet`, {
        wallet_address: inputAddr.trim(),
        label: inputLabel || 'Treasury',
        network: inputNetwork,
      })
      setInputAddr('')
      setInputLabel('Treasury')
      await load()
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to connect wallet')
    } finally {
      setSaving(false)
    }
  }

  const updateWallet = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guildId) return
    setSaving(true)
    try {
      const updates: Record<string, any> = {}
      if (editAddr && editAddr !== wallet?.wallet_address) updates.wallet_address = editAddr.trim()
      if (editLabel !== wallet?.label) updates.label = editLabel
      if (editNetwork !== wallet?.network) updates.network = editNetwork
      await api.patch(`/admin/guilds/${guildId}/wallet`, updates)
      setEditing(false)
      await load()
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to update wallet')
    } finally {
      setSaving(false)
    }
  }

  const disconnectWallet = async () => {
    if (!guildId || !confirm('Disconnect the treasury wallet from this server? Budget data will be lost.')) return
    setSaving(true)
    try {
      await api.delete(`/admin/guilds/${guildId}/wallet`)
      await load()
    } catch {
      alert('Failed to disconnect wallet')
    } finally {
      setSaving(false)
    }
  }

  const saveBudget = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guildId) return
    setSaving(true)
    try {
      await api.post(`/admin/guilds/${guildId}/wallet/budget`, {
        budget_total: Number(budgetInput),
        budget_currency: budgetCurrency,
      })
      await load()
    } catch {
      alert('Failed to set budget')
    } finally {
      setSaving(false)
    }
  }

  const resetSpent = async () => {
    if (!guildId || !confirm('Reset spending counter to 0?')) return
    setSaving(true)
    try {
      await api.post(`/admin/guilds/${guildId}/wallet/budget/reset`)
      await load()
    } catch {
      alert('Failed to reset spending')
    } finally {
      setSaving(false)
    }
  }

  if (!guildId) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state-icon">💰</div>
          <div className="empty-state-text">Select a server to manage treasury wallet.</div>
        </div>
      </div>
    )
  }

  // Budget progress
  const budgetTotal = wallet?.budget_total || 0
  const budgetSpent = wallet?.budget_spent || 0
  const budgetRemaining = Math.max(budgetTotal - budgetSpent, 0)
  const budgetPct = budgetTotal > 0 ? Math.min((budgetSpent / budgetTotal) * 100, 100) : 0

  return (
    <div className="container">
      <div className="section-header">
        <h2 style={{ marginBottom: 0 }}>Guild Treasury</h2>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Refresh'}
        </button>
      </div>

      {/* No wallet connected - show connect form */}
      {!wallet && !loading && (
        <div className="card treasury-connect-card">
          <div className="card-header"><div className="card-title">Connect Treasury Wallet</div></div>
          <div className="empty-state" style={{ padding: '16px 0' }}>
            <div className="empty-state-icon">🔗</div>
            <div className="empty-state-text">No treasury wallet is connected to this server.<br />Connect a Solana wallet to manage payouts and budgets.</div>
          </div>
          <form onSubmit={connectWallet}>
            <div className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Wallet Address *</label>
                <input
                  className="form-input"
                  value={inputAddr}
                  onChange={e => setInputAddr(e.target.value)}
                  placeholder="e.g. 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
                  required
                  minLength={32}
                  maxLength={44}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Label</label>
                <input className="form-input" value={inputLabel} onChange={e => setInputLabel(e.target.value)} placeholder="Treasury" />
              </div>
              <div className="form-group">
                <label className="form-label">Network</label>
                <select className="form-select" value={inputNetwork} onChange={e => setInputNetwork(e.target.value)}>
                  <option value="mainnet-beta">Mainnet</option>
                  <option value="devnet">Devnet</option>
                </select>
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving || !inputAddr}>
              {saving ? <span className="spinner" /> : '🔗 Connect Wallet'}
            </button>
          </form>
        </div>
      )}

      {/* Wallet connected */}
      {wallet && (
        <>
          {/* Wallet Overview Card */}
          <div className="treasury-overview">
            <div className="treasury-wallet-card">
              <div className="treasury-wallet-header">
                <div>
                  <div className="treasury-wallet-label">{wallet.label || 'Treasury'}</div>
                  <div className="treasury-wallet-addr">
                    <span className="mono">{wallet.wallet_address}</span>
                    <a
                      href={`https://solscan.io/account/${wallet.wallet_address}${wallet.network === 'devnet' ? '?cluster=devnet' : ''}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm btn-secondary"
                      style={{ marginLeft: 8, fontSize: 11 }}
                      title="View on Solscan"
                    >🔗</a>
                  </div>
                  <div className="treasury-wallet-meta">
                    <span className={`badge ${wallet.network === 'mainnet-beta' ? 'badge-active' : 'badge-scheduled'}`}>
                      {wallet.network === 'mainnet-beta' ? 'Mainnet' : 'Devnet'}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      Connected {new Date(wallet.configured_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="treasury-balance-block">
                  <div className="treasury-balance-label">SOL Balance</div>
                  <div className="treasury-balance-value">
                    {balLoading ? <span className="spinner" /> : solBalance !== null ? `◎ ${solBalance.toFixed(4)}` : '◎ --'}
                  </div>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => wallet && fetchSolBalance(wallet.wallet_address, wallet.network)}
                    disabled={balLoading}
                    style={{ marginTop: 4, fontSize: 11 }}
                  >Refresh Balance</button>
                </div>
              </div>

              <div className="treasury-actions">
                <button className="btn btn-sm btn-secondary" onClick={() => { setEditing(!editing); setEditAddr(wallet.wallet_address); setEditLabel(wallet.label || ''); setEditNetwork(wallet.network || 'mainnet-beta'); }}>
                  ✏️ Edit
                </button>
                <button className="btn btn-sm btn-danger" onClick={disconnectWallet} disabled={saving}>
                  🔌 Disconnect
                </button>
              </div>

              {editing && (
                <form onSubmit={updateWallet} className="treasury-edit-form">
                  <div className="form-row">
                    <div className="form-group" style={{ flex: 2 }}>
                      <label className="form-label">Wallet Address</label>
                      <input className="form-input" value={editAddr} onChange={e => setEditAddr(e.target.value)} minLength={32} maxLength={44} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Label</label>
                      <input className="form-input" value={editLabel} onChange={e => setEditLabel(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Network</label>
                      <select className="form-select" value={editNetwork} onChange={e => setEditNetwork(e.target.value)}>
                        <option value="mainnet-beta">Mainnet</option>
                        <option value="devnet">Devnet</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>Save</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Budget Management */}
          <div className="treasury-grid">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Payout Budget</div>
              </div>

              <div className="budget-overview">
                <div className="budget-stat-row">
                  <div className="budget-stat">
                    <div className="budget-stat-label">Budget</div>
                    <div className="budget-stat-value">{budgetTotal} {wallet.budget_currency}</div>
                  </div>
                  <div className="budget-stat">
                    <div className="budget-stat-label">Spent</div>
                    <div className="budget-stat-value spent">{budgetSpent.toFixed(2)} {wallet.budget_currency}</div>
                  </div>
                  <div className="budget-stat">
                    <div className="budget-stat-label">Remaining</div>
                    <div className="budget-stat-value remaining">{budgetRemaining.toFixed(2)} {wallet.budget_currency}</div>
                  </div>
                </div>

                {budgetTotal > 0 && (
                  <div className="budget-bar-container">
                    <div className="budget-bar">
                      <div
                        className={`budget-bar-fill ${budgetPct > 90 ? 'danger' : budgetPct > 70 ? 'warning' : ''}`}
                        style={{ width: `${budgetPct}%` }}
                      />
                    </div>
                    <div className="budget-bar-label">{budgetPct.toFixed(1)}% used</div>
                  </div>
                )}
              </div>

              <form onSubmit={saveBudget} className="budget-form">
                <div className="form-row">
                  <div className="form-group" style={{ flex: 2 }}>
                    <label className="form-label">Set Budget Amount</label>
                    <input
                      className="form-input"
                      type="number"
                      step="any"
                      min="0"
                      value={budgetInput}
                      onChange={e => setBudgetInput(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Currency</label>
                    <select className="form-select" value={budgetCurrency} onChange={e => setBudgetCurrency(e.target.value)}>
                      <option value="SOL">SOL</option>
                      <option value="USD">USD</option>
                      <option value="USDC">USDC</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                    {saving ? <span className="spinner" /> : 'Update Budget'}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={resetSpent} disabled={saving}>
                    Reset Spent
                  </button>
                </div>
              </form>
            </div>

            {/* Recent Payouts */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Recent Payouts</div>
              </div>
              {transactions.length === 0 ? (
                <div className="empty-state" style={{ padding: 20 }}>
                  <div className="empty-state-text">No payouts recorded yet.</div>
                </div>
              ) : (
                <div className="tx-list">
                  {transactions.map(tx => (
                    <div key={tx.id} className="tx-item">
                      <div className="tx-icon outgoing">↗</div>
                      <div className="tx-details">
                        <div className="tx-title">To {shortAddr(tx.to_address)}</div>
                        <div className="tx-sub">{new Date(tx.created_at).toLocaleDateString()}</div>
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
                        >🔗</a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
