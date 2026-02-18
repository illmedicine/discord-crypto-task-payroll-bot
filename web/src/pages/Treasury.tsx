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
  isOwner?: boolean
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr || ''
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export default function Treasury({ guildId, isOwner = true }: Props) {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [solBalance, setSolBalance] = useState<number | null>(null)
  const [balLoading, setBalLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Form state for connecting wallet
  const [inputAddr, setInputAddr] = useState('')
  const [inputLabel, setInputLabel] = useState('Treasury')
  const [inputNetwork, setInputNetwork] = useState('mainnet-beta')

  // Bot wallet state
  const [botWalletAddr, setBotWalletAddr] = useState<string | null>(null)
  const [botWalletNetwork, setBotWalletNetwork] = useState<string>('mainnet-beta')

  // Budget form
  const [budgetInput, setBudgetInput] = useState('')
  const [budgetCurrency, setBudgetCurrency] = useState('SOL')

  const load = async () => {
    if (!guildId) return
    setLoading(true)
    setLoadError(null)
    try {
      const [walletRes, txRes] = await Promise.all([
        api.get(`/admin/guilds/${guildId}/wallet`).catch((err) => {
          console.error('[Treasury] wallet fetch failed:', err?.response?.status, err?.response?.data || err?.message)
          return { data: null }
        }),
        api.get(`/admin/guilds/${guildId}/transactions?limit=10`).catch((err) => {
          console.error('[Treasury] transactions fetch failed:', err?.response?.status, err?.response?.data || err?.message)
          return { data: [] }
        }),
      ])
      const w = walletRes.data as Wallet | null
      console.log('[Treasury] wallet data:', w ? `${w.wallet_address} (${w.network})` : 'none')
      setWallet(w)
      setTransactions((txRes.data || []) as Transaction[])
      if (w) {
        setBudgetInput(String(w.budget_total || 0))
        setBudgetCurrency(w.budget_currency || 'SOL')
        fetchSolBalance(w.wallet_address, w.network)
      } else {
        setSolBalance(null)
      }
    } catch (err: any) {
      console.error('[Treasury] load error:', err?.message || err)
      setLoadError('Failed to load treasury data. Please try refreshing.')
      setWallet(null)
    } finally {
      setLoading(false)
    }
  }

  const fetchSolBalance = async (address: string, network: string) => {
    try {
      setBalLoading(true)
      // Try backend first (server-side RPC, no CORS issues)
      try {
        console.log('[Treasury] Fetching balance from backend for', address)
        const balRes = await api.get(`/admin/guilds/${guildId}/dashboard/balance`)
        console.log('[Treasury] Balance API response:', JSON.stringify(balRes.data))
        if (balRes.data?.sol_balance !== null && balRes.data?.sol_balance !== undefined) {
          setSolBalance(balRes.data.sol_balance)
          return
        }
        if (balRes.data?.debug?.rpc_error) {
          console.warn('[Treasury] RPC error from backend:', balRes.data.debug.rpc_error)
        }
      } catch (err: any) {
        console.warn('[Treasury] Backend balance failed:', err?.response?.status, err?.response?.data || err?.message, '— falling back to client-side RPC')
      }
      // Fallback: client-side RPC
      const defaultRpc = network === 'devnet'
        ? 'https://api.devnet.solana.com'
        : 'https://api.mainnet-beta.solana.com'
      const rpcUrl = (import.meta as any).env?.VITE_SOLANA_RPC_URL || defaultRpc
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
        console.log('[Treasury] Client-side RPC balance:', data.result.value / 1e9, 'SOL')
        setSolBalance(data.result.value / 1e9)
      } else {
        console.warn('[Treasury] Client-side RPC returned no value:', JSON.stringify(data))
        setSolBalance(null)
      }
    } catch (err: any) {
      console.error('[Treasury] Balance fetch completely failed:', err?.message || err)
      setSolBalance(null)
    } finally {
      setBalLoading(false)
    }
  }

  useEffect(() => {
    setWallet(null)
    setSolBalance(null)
    setTransactions([])
    setLoadError(null)
    if (guildId) load()
    // Fetch bot wallet address for auto-connect
    api.get('/admin/bot-wallet').then(res => {
      if (res.data?.wallet_address) {
        setBotWalletAddr(res.data.wallet_address)
        setBotWalletNetwork(res.data.network || 'mainnet-beta')
      }
    }).catch(() => {})
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
      const data = err?.response?.data
      if (data?.error === 'wallet_already_configured') {
        alert(`🔒 Treasury Wallet Locked\n\nThis server already has a treasury wallet configured:\n${data.wallet_address}\n\nThe wallet is locked and cannot be changed.`)
      } else if (err?.response?.status === 403) {
        alert('🔒 Only the Server Owner can connect a treasury wallet.')
      } else if (err?.response?.status === 401) {
        alert('Please log in again to connect a wallet.')
      } else {
        alert(data?.message || data?.error || 'Failed to connect wallet. Make sure the backend is running.')
      }
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

  const disconnectWallet = async () => {
    if (!guildId) return
    const confirmed = confirm(
      '⚠️ Disconnect Treasury Wallet?\n\n' +
      'This will remove the wallet from this server.\n' +
      'Active horse race events and payouts that depend on this wallet may stop working.\n\n' +
      'You can reconnect a wallet later.\n\n' +
      'Are you sure?'
    )
    if (!confirmed) return
    setSaving(true)
    try {
      await api.delete(`/admin/guilds/${guildId}/wallet`)
      setWallet(null)
      setSolBalance(null)
      setTransactions([])
      setInputAddr('')
      setInputLabel('Treasury')
    } catch (err: any) {
      if (err?.response?.status === 403) {
        alert('🔒 Only the Server Owner can disconnect the treasury wallet.')
      } else {
        alert(err?.response?.data?.error || 'Failed to disconnect wallet.')
      }
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

      {/* No wallet connected - show connect form (owner only) or message */}
      {!wallet && !loading && (
        <div className="card treasury-connect-card">
          <div className="card-header"><div className="card-title">Connect Treasury Wallet</div></div>
          <div className="empty-state" style={{ padding: '16px 0' }}>
            <div className="empty-state-icon">🔗</div>
            <div className="empty-state-text">No treasury wallet is connected to this server.{isOwner ? <><br />Connect a Solana wallet to manage payouts and budgets.</> : <><br />Ask the server owner to connect a treasury wallet.</>}</div>
          </div>
          {loadError && (
            <div style={{ background: 'var(--bg-secondary, #1a1a2e)', border: '1px solid var(--danger, #e74c3c)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: 'var(--danger, #e74c3c)' }}>
              {loadError}
            </div>
          )}
          {isOwner && (
          <>
          {botWalletAddr && (
            <div style={{ background: 'linear-gradient(135deg, rgba(46, 204, 113, 0.1), rgba(52, 152, 219, 0.1))', border: '1px solid rgba(46, 204, 113, 0.4)', borderRadius: 10, padding: '16px 20px', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#2ecc71', marginBottom: 8 }}>🤖 Recommended: Use Bot Wallet</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted, #aaa)', marginBottom: 12 }}>
                For automatic payouts (horse races, /pay), the treasury must be the bot's managed wallet.
                Fund this address with SOL to enable payments.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <code style={{ background: 'var(--bg-primary, #0d0d1a)', padding: '6px 10px', borderRadius: 6, fontSize: 12, flex: 1, wordBreak: 'break-all', color: '#3498db' }}>{botWalletAddr}</code>
                <button className="btn btn-sm btn-secondary" onClick={() => navigator.clipboard.writeText(botWalletAddr)} title="Copy address" style={{ flexShrink: 0 }}>📋</button>
              </div>
              <button
                className="btn btn-primary"
                style={{ width: '100%', fontWeight: 600 }}
                disabled={saving}
                onClick={async () => {
                  setSaving(true)
                  try {
                    await api.post(`/admin/guilds/${guildId}/wallet`, {
                      wallet_address: botWalletAddr,
                      label: 'Bot Treasury',
                      network: botWalletNetwork,
                    })
                    await load()
                  } catch (err: any) {
                    const data = err?.response?.data
                    if (data?.error === 'wallet_already_configured') {
                      alert(`🔒 A treasury wallet is already configured:\n${data.wallet_address}`)
                    } else {
                      alert(data?.message || data?.error || 'Failed to connect bot wallet.')
                    }
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {saving ? <span className="spinner" /> : '🤖 Connect Bot Wallet as Treasury'}
              </button>
            </div>
          )}
          <div style={{ background: 'var(--bg-secondary, #1a1a2e)', border: '1px solid var(--border-color, #333)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: 'var(--text-muted, #aaa)' }}>
            <strong style={{ color: 'var(--text-primary, #fff)' }}>🔒 Important:</strong> Only the <strong>Server Owner</strong> can connect or disconnect the treasury wallet.
          </div>
          {botWalletAddr && (
            <div style={{ borderTop: '1px solid var(--border-color, #333)', marginBottom: 16, paddingTop: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #aaa)', marginBottom: 8 }}>Or connect a custom wallet address:</div>
            </div>
          )}
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
          </>
          )}
        </div>
      )}

      {/* Wallet connected */}
      {wallet && (
        <>
          {/* Bot wallet mismatch warning */}
          {botWalletAddr && wallet.wallet_address !== botWalletAddr && (
            <div style={{ background: 'rgba(231, 76, 60, 0.1)', border: '1px solid rgba(231, 76, 60, 0.5)', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#e74c3c', marginBottom: 6 }}>⚠️ Treasury Wallet Mismatch</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted, #aaa)', marginBottom: 8 }}>
                Your treasury wallet does not match the bot's payment wallet. Automatic payouts (horse races, /pay) will fail because the bot can only send from its own managed wallet.
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #aaa)', marginBottom: 4 }}>
                <strong style={{ color: '#e74c3c' }}>Current Treasury:</strong> <code style={{ fontSize: 11 }}>{shortAddr(wallet.wallet_address)}</code>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #aaa)', marginBottom: 10 }}>
                <strong style={{ color: '#2ecc71' }}>Bot Wallet (required):</strong> <code style={{ fontSize: 11 }}>{shortAddr(botWalletAddr)}</code>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #aaa)' }}>
                Disconnect the current wallet, then reconnect using the <strong>"Use Bot Wallet"</strong> option — or transfer SOL to the bot wallet: <code style={{ fontSize: 11 }}>{botWalletAddr}</code>
              </div>
            </div>
          )}
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

              <div className="treasury-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <span className="badge badge-active" style={{ fontSize: 12, padding: '4px 10px' }}>
                  🔒 Connected
                </span>
                {isOwner && (
                  <button
                    className="btn btn-sm"
                    onClick={disconnectWallet}
                    disabled={saving}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--danger, #e74c3c)',
                      color: 'var(--danger, #e74c3c)',
                      fontSize: 12,
                      padding: '4px 12px',
                      cursor: 'pointer',
                    }}
                    title="Remove treasury wallet from this server"
                  >
                    {saving ? <span className="spinner" /> : '🔌 Disconnect Wallet'}
                  </button>
                )}
              </div>

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
