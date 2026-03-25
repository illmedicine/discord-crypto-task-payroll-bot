import React, { useState, useEffect } from 'react'
import api from '../../api'

interface WalletInfo {
  type: string
  address: string
  balance: number
  label: string
}

interface Props {
  balance: { sol: number; usdc: number; usd: number }
  guildId: string
  onClose: () => void
  onBalanceChange: (newBal: { sol: number; usdc: number; usd: number }) => void
}

type WalletTab = 'wallets' | 'deposit' | 'withdraw' | 'buy' | 'tip' | 'link'
type Currency = 'SOL' | 'USDC' | 'USD'

const SOLSCAN_TX = 'https://solscan.io/tx/'
const SOLSCAN_ADDR = 'https://solscan.io/account/'
const truncAddr = (a: string) => a ? `${a.slice(0, 6)}...${a.slice(-4)}` : ''

export default function BeastWallet({ balance, guildId, onClose, onBalanceChange }: Props) {
  const [tab, setTab] = useState<WalletTab>('wallets')
  const [currency, setCurrency] = useState<Currency>('SOL')
  const [depositAddress, setDepositAddress] = useState('')
  const [withdrawAddress, setWithdrawAddress] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [tipUser, setTipUser] = useState('')
  const [tipAmount, setTipAmount] = useState('')
  const [dcbLinked, setDcbLinked] = useState(false)
  const [dcbWallet, setDcbWallet] = useState<string | null>(null)
  const [dcbDepositAmount, setDcbDepositAmount] = useState('')
  const [linkStatus, setLinkStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [solPrice, setSolPrice] = useState(0)
  const [dcbAvailable, setDcbAvailable] = useState<{ onChain: number; deposited: number; available: number } | null>(null)
  const [userWallets, setUserWallets] = useState<WalletInfo[]>([])
  const [walletsLoading, setWalletsLoading] = useState(false)
  const [lastTxSig, setLastTxSig] = useState<string | null>(null)

  // Fetch SOL price on mount
  useEffect(() => {
    api.get('/beast/sol-price')
      .then(r => setSolPrice(r.data?.price || 0))
      .catch(() => {})
    const iv = setInterval(() => {
      api.get('/beast/sol-price').then(r => setSolPrice(r.data?.price || 0)).catch(() => {})
    }, 60000)
    return () => clearInterval(iv)
  }, [])

  // Fetch user wallets on mount
  const fetchWallets = (refresh = false) => {
    setWalletsLoading(true)
    api.get(`/beast/wallet/all${refresh ? '?refresh=true' : ''}`)
      .then(r => {
        setUserWallets(r.data?.wallets || [])
        if (r.data?.totalBalance !== undefined) {
          onBalanceChange({ sol: r.data.totalBalance, usdc: 0, usd: 0 })
        }
      })
      .catch(() => {})
      .finally(() => setWalletsLoading(false))
  }
  useEffect(() => { fetchWallets() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch deposit address and DCB link status
  useEffect(() => {
    api.get(`/beast/wallet/deposit-address?currency=${currency}`)
      .then(r => setDepositAddress(r.data?.address || ''))
      .catch(() => setDepositAddress(''))

    api.get('/beast/wallet/dcb-link')
      .then(r => {
        setDcbLinked(r.data?.linked || false)
        setDcbWallet(r.data?.dcbAddress || null)
      })
      .catch(() => {})
  }, [currency])

  const handleWithdraw = async () => {
    if (!withdrawAddress.trim() || !withdrawAmount.trim()) {
      setMessage({ type: 'error', text: 'Enter address and amount' })
      if (r.data?.wallets) setUserWallets(r.data.wallets)
      if (r.data?.tx_signature) setLastTxSig(r.data.tx_signature)
      return
    }
    const amt = parseFloat(withdrawAmount)
    if (isNaN(amt) || amt <= 0) {
      setMessage({ type: 'error', text: 'Invalid amount' })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const r = await api.post('/beast/wallet/withdraw', {
        currency, amount: amt, toAddress: withdrawAddress.trim()
      })
      setMessage({ type: 'success', text: `Withdrawal of ${amt} ${currency} initiated` })
      if (r.data?.balance) onBalanceChange(r.data.balance)
      setWithdrawAmount('')
      setWithdrawAddress('')
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.response?.data?.error || 'Withdrawal failed' })
    } finally {
      setLoading(false)
    }
  }

  const handleTip = async () => {
    if (!tipUser.trim() || !tipAmount.trim()) {
      setMessage({ type: 'error', text: 'Enter username and amount' })
      return
    }
    const amt = parseFloat(tipAmount)
    if (isNaN(amt) || amt <= 0) {
      setMessage({ type: 'error', text: 'Invalid amount' })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const r = await api.post('/beast/wallet/tip', {
        currency, amount: amt, toUser: tipUser.trim()
      })
      setMessage({ type: 'success', text: `Tipped ${amt} ${currency} to ${tipUser}` })
      if (r.data?.balance) onBalanceChange(r.data.balance)
      if (r.data?.tx_signature) setLastTxSig(r.data.tx_signature)
      fetchWallets()
      setTipAmount('')
      setTipUser('')
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.response?.data?.error || 'Tip failed' })
    } finally {
      setLoading(false)
    }
  }

  const handleLinkDCB = async () => {
    setLoading(true)
    setLinkStatus('')
    try {
      const r = await api.post('/beast/wallet/link-dcb', { guildId, currency })
      setDcbLinked(true)
      setDcbWallet(r.data?.dcbAddress || null)
      setLinkStatus(`✅ Beast wallet linked to DCB wallet for ${currency}`)
    } catch (err: any) {
      setLinkStatus(err?.response?.data?.error || 'Failed to link wallets')
    } finally {
      setLoading(false)
    }
  }

  const handleUnlinkDCB = async () => {
    setLoading(true)
    try {
      await api.post('/beast/wallet/unlink-dcb')
      setDcbLinked(false)
      setDcbWallet(null)
      setLinkStatus('Wallets unlinked')
    } catch (err: any) {
      setLinkStatus(err?.response?.data?.error || 'Failed to unlink')
    } finally {
      setLoading(false)
    }
  }

  const handleDepositFromDCB = async () => {
    const amt = parseFloat(dcbDepositAmount)
    if (isNaN(amt) || amt <= 0) {
      setMessage({ type: 'error', text: 'Enter a valid amount' })
      return
    }
    // Client-side check: if we know DCB available balance, validate first
    if (dcbAvailable) {
      let solNeeded = amt
      if (currency !== 'SOL' && solPrice > 0) solNeeded = amt / solPrice
      if (solNeeded > dcbAvailable.available + 0.000001) {
        const avail = currency === 'SOL' ? `${dcbAvailable.available.toFixed(6)} SOL` : `$${(dcbAvailable.available * solPrice).toFixed(2)} ${currency} (${dcbAvailable.available.toFixed(6)} SOL)`
        setMessage({ type: 'error', text: `Amount exceeds available DCB balance: ${avail}. Use MAX to deposit the full available amount.` })
        return
      }
    }
    setLoading(true)
    setMessage(null)
    try {
      const r = await api.post('/beast/wallet/deposit-from-dcb', { currency, amount: amt })
      setMessage({ type: 'success', text: r.data?.message || `Deposited ${amt} ${currency} from DCB wallet` })
      if (r.data?.tx_signature) setLastTxSig(r.data.tx_signature)
      fetchWallets()
      if (r.data?.balance) onBalanceChange(r.data.balance)
      if (r.data?.dcbBalance) setDcbAvailable(r.data.dcbBalance)
      setDcbDepositAmount('')
    } catch (err: any) {
      const errData = err?.response?.data
      setMessage({ type: 'error', text: errData?.error || 'Transfer failed' })
      // Update available balance from error response if present
      if (errData?.available !== undefined) {
        setDcbAvailable({ onChain: errData.onChainBalance || 0, deposited: errData.alreadyDeposited || 0, available: errData.available || 0 })
      }
    } finally {
      setLoading(false)
    }
  }

  const copyAddress = () => {
    if (depositAddress) {
      navigator.clipboard.writeText(depositAddress).catch(() => {
        window.prompt('Copy this address:', depositAddress)
      })
    }
  }

  return (
    <div className="beast-wallet-overlay" onClick={onClose}>
      <div className="beast-wallet-modal" onClick={e => e.stopPropagation()}>
        <div className="beast-wallet-header">
          <h2>CASHIER</h2>
          <button className="beast-wallet-close" onClick={onClose}>✕</button>
        </div>

        {/* Estimated Balance */}
        <div className="beast-wallet-balance">
          <div className="beast-wallet-balance-label">ESTIMATED BALANCE</div>
          <div className="beast-wallet-balance-total">
            ${solPrice > 0 ? ((balance.sol * solPrice) + balance.usd + balance.usdc).toFixed(2) : (balance.usd + balance.usdc).toFixed(2)}
          </div>
          {solPrice > 0 && (
            <div style={{ fontSize: '0.75rem', color: '#a78bfa', marginTop: 2 }}>
              {balance.sol.toFixed(4)} SOL × ${solPrice.toFixed(2)} = ${(balance.sol * solPrice).toFixed(2)}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="beast-wallet-tabs">
          {(['wallets', 'deposit', 'withdraw', 'buy', 'tip', 'link'] as WalletTab[]).map(t => (
            <button
              key={t}
              className={`beast-wallet-tab ${tab === t ? 'active' : ''}`}
              onClick={() => { setTab(t); setMessage(null); setLastTxSig(null) }}
            >
              {t === 'wallets' && '👛'} {t === 'deposit' && '↓'} {t === 'withdraw' && '↑'} {t === 'buy' && '💎'} {t === 'tip' && '🎁'} {t === 'link' && '🔗'}
              {' '}{t === 'wallets' ? 'Wallets' : t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'link' && ' DCB'}
              {t === 'wallets' && userWallets.length > 0 && ` (${userWallets.length})`}
            </button>
          ))}
        </div>

        {message && (
          <div className={`beast-wallet-msg ${message.type}`}>
            {message.text}
            {lastTxSig && (
              <a href={`${SOLSCAN_TX}${lastTxSig}`} target="_blank" rel="noopener noreferrer" className="beast-tx-confirm-link">
                ⛓ View on Solscan
              </a>
            )}
          </div>
        )}

        {/* Wallets Tab */}
        {tab === 'wallets' && (
          <div className="beast-wallet-content">
            <div className="beast-wallet-overview-header">
              <h3>My Beast Wallets</h3>
              <button className="beast-wallet-refresh-btn" onClick={() => fetchWallets(true)} disabled={walletsLoading}>
                {walletsLoading ? '⏳' : '🔄'} Refresh Balances
              </button>
            </div>
            {userWallets.length === 0 ? (
              <div className="beast-wallet-empty">
                <p>No wallets yet. Go to the <strong>Deposit</strong> tab to generate your first wallet address.</p>
              </div>
            ) : (
              <div className="beast-wallet-list">
                {userWallets.map((w, i) => (
                  <div key={i} className={`beast-wallet-card ${w.type}`}>
                    <div className="beast-wallet-card-top">
                      <span className="beast-wallet-card-icon">{w.type === 'deposit' ? '📥' : '🏆'}</span>
                      <span className="beast-wallet-card-label">{w.label || (w.type === 'deposit' ? 'Deposit Wallet' : 'Winnings Wallet')}</span>
                      <span className={`beast-wallet-card-type ${w.type}`}>{w.type}</span>
                    </div>
                    <div className="beast-wallet-card-addr">
                      <a href={`${SOLSCAN_ADDR}${w.address}`} target="_blank" rel="noopener noreferrer">
                        {truncAddr(w.address)}
                      </a>
                      <button className="beast-wallet-copy-sm" onClick={() => navigator.clipboard.writeText(w.address).catch(() => window.prompt('Copy:', w.address))}>📋</button>
                    </div>
                    <div className="beast-wallet-card-bal">
                      <span className="beast-wallet-card-sol">{w.balance.toFixed(6)} SOL</span>
                      {solPrice > 0 && <span className="beast-wallet-card-usd">≈ ${(w.balance * solPrice).toFixed(2)}</span>}
                    </div>
                  </div>
                ))}
                <div className="beast-wallet-total-bar">
                  <span>Combined Balance:</span>
                  <span className="beast-wallet-total-val">
                    {userWallets.reduce((s, w) => s + w.balance, 0).toFixed(6)} SOL
                    {solPrice > 0 && ` (≈ $${(userWallets.reduce((s, w) => s + w.balance, 0) * solPrice).toFixed(2)})`}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Deposit Tab */}
        {tab === 'deposit' && (
          <div className="beast-wallet-content">
            <div className="beast-wallet-field">
              <label>CURRENCY TO DEPOSIT</label>
              <div className="beast-wallet-currency-select">
                <select value={currency} onChange={e => setCurrency(e.target.value as Currency)}>
                  <option value="SOL">◎ SOL</option>
                  <option value="USDC">💲 USDC</option>
                  <option value="USD">💵 USD</option>
                </select>
                <span className="beast-wallet-curr-balance">
                  {currency === 'SOL' ? balance.sol.toFixed(4) :
                   currency === 'USDC' ? balance.usdc.toFixed(4) :
                   balance.usd.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="beast-wallet-field">
              <label>DEPOSIT ADDRESS</label>
              <div className="beast-wallet-address-row">
                <input
                  type="text"
                  readOnly
                  value={depositAddress || 'Loading...'}
                  className="beast-wallet-address"
                />
                <button className="beast-wallet-copy-btn" onClick={copyAddress}>📋</button>
              </div>
              <p className="beast-wallet-note">
                Deposits must be sent on the Solana network.
                <strong> Minimum deposit: $1.00 USD equivalent.</strong>
              </p>
            </div>

            {/* Deposit from DCB Wallet */}
            {dcbLinked ? (
              <div className="beast-wallet-field" style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 16 }}>
                <label>DEPOSIT FROM DCB WALLET</label>
                {dcbWallet && (
                  <div style={{ fontSize: '0.8rem', color: '#a78bfa', marginBottom: 8 }}>
                    Linked: <code>{dcbWallet.slice(0, 8)}...{dcbWallet.slice(-6)}</code>
                  </div>
                )}
                <div className="beast-wallet-inline-row">
                  <input
                    type="number"
                    value={dcbDepositAmount}
                    onChange={e => setDcbDepositAmount(e.target.value)}
                    placeholder={currency === 'SOL' ? 'Amount in SOL' : `Amount in ${currency} (converts to SOL)`}
                    step="0.01"
                    min="0"
                    className="beast-wallet-input"
                  />
                  {dcbAvailable && dcbAvailable.available > 0 && (
                    <button
                      style={{ padding: '6px 10px', fontSize: '0.75rem', fontWeight: 700, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 6, color: '#22c55e', cursor: 'pointer' }}
                      onClick={() => {
                        if (currency === 'SOL') {
                          setDcbDepositAmount(dcbAvailable.available.toFixed(6))
                        } else if (solPrice > 0) {
                          setDcbDepositAmount((dcbAvailable.available * solPrice).toFixed(2))
                        }
                      }}
                    >MAX</button>
                  )}
                  <button className="beast-wallet-action-btn" onClick={handleDepositFromDCB} disabled={loading}>
                    {loading ? 'Transferring...' : `Deposit ${currency}`}
                  </button>
                </div>
                {dcbAvailable && (
                  <div style={{ fontSize: '0.78rem', color: '#a78bfa', marginTop: 6, padding: '6px 8px', background: 'rgba(167,139,250,0.08)', borderRadius: 6 }}>
                    DCB Wallet: <strong>{dcbAvailable.onChain.toFixed(6)} SOL</strong> on-chain
                    {dcbAvailable.deposited > 0 && <span style={{ color: '#f59e0b' }}> | {dcbAvailable.deposited.toFixed(6)} already deposited</span>}
                    {' '}| Available: <strong style={{ color: '#22c55e' }}>{dcbAvailable.available.toFixed(6)} SOL</strong>
                  </div>
                )}
                {dcbDepositAmount && parseFloat(dcbDepositAmount) > 0 && currency !== 'SOL' && solPrice > 0 && (
                  <div style={{ fontSize: '0.8rem', color: '#10b981', marginTop: 4 }}>
                    ≈ {(parseFloat(dcbDepositAmount) / solPrice).toFixed(6)} SOL @ ${solPrice.toFixed(2)}/SOL
                  </div>
                )}
                {dcbDepositAmount && parseFloat(dcbDepositAmount) > 0 && currency === 'SOL' && solPrice > 0 && (
                  <div style={{ fontSize: '0.8rem', color: '#10b981', marginTop: 4 }}>
                    ≈ ${(parseFloat(dcbDepositAmount) * solPrice).toFixed(2)} USD
                  </div>
                )}
                <p className="beast-wallet-note" style={{ marginTop: 4 }}>
                  Transfer funds from your connected DCB wallet into your Beast wallet instantly.
                  Balance is verified on-chain before each deposit.
                  {currency !== 'SOL' && ' USD/USDC amounts are auto-converted to SOL.'}
                </p>
              </div>
            ) : (
              <div className="beast-wallet-field" style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 16 }}>
                <p className="beast-wallet-note">
                  💡 <strong>Tip:</strong> Link your DCB wallet in the "🔗 Link DCB" tab to deposit directly from your DCB balance.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Withdraw Tab */}
        {tab === 'withdraw' && (
          <div className="beast-wallet-content">
            <div className="beast-wallet-field">
              <label>CURRENCY</label>
              <select value={currency} onChange={e => setCurrency(e.target.value as Currency)} className="beast-wallet-select">
                <option value="SOL">◎ SOL</option>
                <option value="USDC">💲 USDC</option>
                <option value="USD">💵 USD</option>
              </select>
            </div>
            <div className="beast-wallet-field">
              <label>WITHDRAWAL ADDRESS</label>
              <input
                type="text"
                value={withdrawAddress}
                onChange={e => setWithdrawAddress(e.target.value)}
                placeholder="Solana wallet address..."
                className="beast-wallet-input"
              />
            </div>
            <div className="beast-wallet-field">
              <label>AMOUNT ({currency})</label>
              <input
                type="number"
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                className="beast-wallet-input"
              />
              {withdrawAmount && parseFloat(withdrawAmount) > 0 && solPrice > 0 && (
                <div style={{ fontSize: '0.8rem', color: '#10b981', marginTop: 4 }}>
                  {currency === 'SOL'
                    ? `≈ $${(parseFloat(withdrawAmount) * solPrice).toFixed(2)} USD`
                    : `≈ ${(parseFloat(withdrawAmount) / solPrice).toFixed(6)} SOL @ $${solPrice.toFixed(2)}/SOL`}
                </div>
              )}
              <div className="beast-wallet-avail">
                Available: {balance.sol.toFixed(4)} SOL{solPrice > 0 ? ` (≈ $${(balance.sol * solPrice).toFixed(2)})` : ''}
                {userWallets.length > 1 && <span className="beast-wallet-multi-note"> across {userWallets.length} wallets (auto-sweep)</span>}
              </div>
            </div>
            <button className="beast-wallet-action-btn" onClick={handleWithdraw} disabled={loading}>
              {loading ? 'Processing...' : `Withdraw ${currency}`}
            </button>
            <p className="beast-wallet-note" style={{ marginTop: 8 }}>
              Withdrawals sweep from all your wallets in a single on-chain transaction. Graduated fee: 5% ({'≤'}0.1 SOL), 3% ({'≤'}1), 2% ({'≤'}10), 1% ({'>'}10).
            </p>
          </div>
        )}

        {/* Buy Crypto Tab */}
        {tab === 'buy' && (
          <div className="beast-wallet-content">
            <div className="beast-wallet-buy-info">
              <p>Purchase SOL or USDC using supported payment methods.</p>
              <p className="beast-wallet-note">
                Fiat on-ramp powered by integrated third-party providers.
                Available currencies: SOL, USDC.
              </p>
              <button className="beast-wallet-action-btn" onClick={() => {
                setMessage({ type: 'success', text: 'Buy Crypto feature coming soon. Use Deposit to fund your wallet.' })
              }}>
                Buy Crypto (Coming Soon)
              </button>
            </div>
          </div>
        )}

        {/* Tip Tab */}
        {tab === 'tip' && (
          <div className="beast-wallet-content">
            <div className="beast-wallet-field">
              <label>CURRENCY</label>
              <select value={currency} onChange={e => setCurrency(e.target.value as Currency)} className="beast-wallet-select">
                <option value="SOL">◎ SOL</option>
                <option value="USDC">💲 USDC</option>
                <option value="USD">💵 USD</option>
              </select>
            </div>
            <div className="beast-wallet-field">
              <label>RECIPIENT (Discord username or ID)</label>
              <input
                type="text"
                value={tipUser}
                onChange={e => setTipUser(e.target.value)}
                placeholder="username#1234 or Discord ID"
                className="beast-wallet-input"
              />
            </div>
            <div className="beast-wallet-field">
              <label>AMOUNT ({currency})</label>
              <input
                type="number"
                value={tipAmount}
                onChange={e => setTipAmount(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                className="beast-wallet-input"
              />
            </div>
            <button className="beast-wallet-action-btn" onClick={handleTip} disabled={loading}>
              {loading ? 'Sending...' : `Tip ${currency}`}
            </button>
          </div>
        )}

        {/* Link to DCB Wallet Tab */}
        {tab === 'link' && (
          <div className="beast-wallet-content">
            <div className="beast-wallet-link-info">
              <h3>🔗 Link Beast Wallet ↔ DCB Event Manager</h3>
              <p>
                Link your illy Beast Gaming wallet to your DCB Connected Wallet.
                Only compatible currency types can be linked:
              </p>
              <div className="beast-wallet-compat">
                <div className="beast-compat-row">
                  <span>◎ SOL</span>
                  <span className="beast-compat-arrow">↔</span>
                  <span>DCB SOL Wallet</span>
                  <span className="beast-compat-ok">✅ Compatible</span>
                </div>
                <div className="beast-compat-row">
                  <span>💲 USDC</span>
                  <span className="beast-compat-arrow">↔</span>
                  <span>DCB USDC Wallet</span>
                  <span className="beast-compat-ok">✅ Compatible</span>
                </div>
                <div className="beast-compat-row">
                  <span>💵 USD</span>
                  <span className="beast-compat-arrow">↔</span>
                  <span>DCB USD Wallet</span>
                  <span className="beast-compat-ok">✅ Compatible</span>
                </div>
              </div>

              {dcbLinked ? (
                <div className="beast-wallet-linked">
                  <div className="beast-linked-status">
                    <span className="beast-linked-icon">✅</span>
                    <span>Linked to DCB Wallet</span>
                  </div>
                  {dcbWallet && (
                    <div className="beast-linked-address">
                      DCB Address: <code>{dcbWallet.slice(0, 8)}...{dcbWallet.slice(-6)}</code>
                    </div>
                  )}
                  <p className="beast-wallet-note">
                    When linked, funds deposited or earned in illy Beast Games
                    will be reflected in your DCB Event Manager wallet for the same currency type.
                  </p>
                  <button className="beast-wallet-danger-btn" onClick={handleUnlinkDCB} disabled={loading}>
                    {loading ? 'Unlinking...' : 'Unlink Wallets'}
                  </button>
                </div>
              ) : (
                <>
                  <div className="beast-wallet-field">
                    <label>LINK CURRENCY</label>
                    <select value={currency} onChange={e => setCurrency(e.target.value as Currency)} className="beast-wallet-select">
                      <option value="SOL">◎ SOL</option>
                      <option value="USDC">💲 USDC</option>
                      <option value="USD">💵 USD</option>
                    </select>
                  </div>
                  <button className="beast-wallet-action-btn" onClick={handleLinkDCB} disabled={loading}>
                    {loading ? 'Linking...' : `Link ${currency} Wallet to DCB`}
                  </button>
                </>
              )}
              {linkStatus && <div className="beast-wallet-link-status">{linkStatus}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
