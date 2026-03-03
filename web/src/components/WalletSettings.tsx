import React, { useEffect, useState, useCallback } from 'react'
import api from '../api'
import { encryptForTransport, isE2EAvailable } from '../utils/e2eEncrypt'

type WalletStatus = {
  connected: boolean
  solana_address: string | null
  has_private_key: boolean
  updated_at?: string
}

type TrustInfo = {
  trust: number
  risk: number
  wallet: boolean
  key: boolean
  auto_pay_capable: boolean
}

export default function WalletSettings() {
  const [status, setStatus] = useState<WalletStatus | null>(null)
  const [trust, setTrust] = useState<TrustInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Form states
  const [showAddressForm, setShowAddressForm] = useState(false)
  const [showKeyForm, setShowKeyForm] = useState(false)
  const [address, setAddress] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showConfirmRemove, setShowConfirmRemove] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const [walletRes, trustRes] = await Promise.all([
        api.get('/user/wallet'),
        api.get('/user/wallet/trust'),
      ])
      setStatus(walletRes.data)
      setTrust(trustRes.data)
    } catch (err: any) {
      if (err?.response?.status !== 401) {
        setError('Failed to load wallet status')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const handleConnectAddress = async () => {
    setError(''); setSuccess(''); setSubmitting(true)
    try {
      const res = await api.post('/user/wallet', { solana_address: address.trim() })
      setSuccess('Wallet address connected!')
      setShowAddressForm(false)
      setAddress('')
      fetchStatus()
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to connect wallet')
    } finally { setSubmitting(false) }
  }

  const handleSubmitKey = async () => {
    setError(''); setSuccess(''); setSubmitting(true)
    try {
      if (!privateKey.trim()) {
        setError('Please enter your private key')
        setSubmitting(false)
        return
      }
      // Encrypt with E2E transport encryption before sending
      const encrypted = await encryptForTransport(privateKey.trim())
      const res = await api.post('/user/wallet/key', { encrypted_key: encrypted })
      setSuccess('Private key saved & verified! You can now participate in pot-split events.')
      setShowKeyForm(false)
      setPrivateKey('')
      fetchStatus()
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to save private key')
    } finally { setSubmitting(false) }
  }

  const handleRemoveKey = async () => {
    setError(''); setSuccess(''); setSubmitting(true)
    try {
      await api.delete('/user/wallet/key')
      setSuccess('Private key removed.')
      setShowConfirmRemove(false)
      fetchStatus()
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to remove private key')
    } finally { setSubmitting(false) }
  }

  if (loading) return <div className="wallet-settings"><div className="wallet-loading">Loading wallet...</div></div>

  const trustTier = (score: number) =>
    score >= 85 ? 'Elite' : score >= 70 ? 'High' : score >= 50 ? 'Trusted' : score >= 25 ? 'Basic' : 'New'
  const riskTier = (score: number) =>
    score >= 75 ? 'Critical' : score >= 50 ? 'High' : score >= 25 ? 'Medium' : 'Low'

  return (
    <div className="wallet-settings">
      <div className="wallet-settings-header">
        <h3>🔐 Wallet & Security</h3>
      </div>

      {error && <div className="wallet-alert wallet-alert-error">{error}</div>}
      {success && <div className="wallet-alert wallet-alert-success">{success}</div>}

      {/* Wallet Address Section */}
      <div className="wallet-section">
        <div className="wallet-section-label">Wallet Address</div>
        {status?.connected ? (
          <div className="wallet-status-row">
            <span className="wallet-badge wallet-badge-connected">Connected</span>
            <code className="wallet-address">{status.solana_address}</code>
            <button className="wallet-btn-sm" onClick={() => { setShowAddressForm(true); setAddress(status.solana_address || '') }}>
              Change
            </button>
          </div>
        ) : (
          <div className="wallet-status-row">
            <span className="wallet-badge wallet-badge-missing">Not Connected</span>
            <button className="wallet-btn wallet-btn-primary" onClick={() => setShowAddressForm(true)}>
              Connect Wallet
            </button>
          </div>
        )}

        {showAddressForm && (
          <div className="wallet-form">
            <input
              type="text"
              className="wallet-input"
              placeholder="Enter Solana wallet address..."
              value={address}
              onChange={e => setAddress(e.target.value)}
              maxLength={44}
              autoFocus
            />
            <div className="wallet-form-actions">
              <button className="wallet-btn wallet-btn-primary" onClick={handleConnectAddress} disabled={submitting || !address.trim()}>
                {submitting ? 'Saving...' : 'Save Address'}
              </button>
              <button className="wallet-btn wallet-btn-ghost" onClick={() => { setShowAddressForm(false); setAddress('') }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Private Key Section */}
      <div className="wallet-section">
        <div className="wallet-section-label">Private Key (for Pot-Split Events)</div>

        {status?.has_private_key ? (
          <div className="wallet-status-row">
            <span className="wallet-badge wallet-badge-key">🔑 Key Bound</span>
            <span className="wallet-auto-pay">✅ Auto-Pay Capable</span>
            <button className="wallet-btn-sm wallet-btn-danger-sm" onClick={() => setShowConfirmRemove(true)}>
              Remove Key
            </button>
          </div>
        ) : status?.connected ? (
          <div className="wallet-status-row">
            <span className="wallet-badge wallet-badge-nokey">No Key</span>
            <button className="wallet-btn wallet-btn-primary" onClick={() => setShowKeyForm(true)}>
              Add Private Key
            </button>
          </div>
        ) : (
          <div className="wallet-hint">Connect your wallet address first to add a private key.</div>
        )}

        {showKeyForm && (
          <div className="wallet-form">
            <div className="wallet-security-notice">
              <div className="wallet-security-icon">🛡️</div>
              <div>
                <strong>End-to-End Encrypted</strong>
                <p>Your private key is encrypted in your browser before being sent. It is stored encrypted at rest using AES-256-GCM and is never visible in plaintext on the server, in logs, or to anyone — not even administrators.</p>
              </div>
            </div>
            <input
              type="password"
              className="wallet-input"
              placeholder="Paste your Solana private key (base58)..."
              value={privateKey}
              onChange={e => setPrivateKey(e.target.value)}
              autoComplete="off"
              autoFocus
            />
            <div className="wallet-hint">
              Your key must match your connected wallet address. It will be verified before saving.
            </div>
            <div className="wallet-form-actions">
              <button className="wallet-btn wallet-btn-primary" onClick={handleSubmitKey} disabled={submitting || !privateKey.trim()}>
                {submitting ? 'Encrypting & Saving...' : '🔐 Encrypt & Save Key'}
              </button>
              <button className="wallet-btn wallet-btn-ghost" onClick={() => { setShowKeyForm(false); setPrivateKey('') }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {showConfirmRemove && (
          <div className="wallet-form">
            <div className="wallet-alert wallet-alert-warning">
              Are you sure? Removing your key means you won't be able to participate in pot-split poker or gambling events until you re-add it.
            </div>
            <div className="wallet-form-actions">
              <button className="wallet-btn wallet-btn-danger" onClick={handleRemoveKey} disabled={submitting}>
                {submitting ? 'Removing...' : 'Remove Private Key'}
              </button>
              <button className="wallet-btn wallet-btn-ghost" onClick={() => setShowConfirmRemove(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Trust & Risk Score */}
      {trust && (
        <div className="wallet-section">
          <div className="wallet-section-label">Trust & Risk Score</div>
          <div className="wallet-trust-grid">
            <div className="wallet-trust-card wallet-trust-card-trust">
              <div className="wallet-trust-score">{trust.trust}</div>
              <div className="wallet-trust-label">🛡️ Trust</div>
              <div className={`wallet-trust-tier tier-${trustTier(trust.trust).toLowerCase()}`}>{trustTier(trust.trust)}</div>
            </div>
            <div className="wallet-trust-card wallet-trust-card-risk">
              <div className="wallet-trust-score">{trust.risk}</div>
              <div className="wallet-trust-label">⚠️ Risk</div>
              <div className={`wallet-risk-tier tier-${riskTier(trust.risk).toLowerCase()}`}>{riskTier(trust.risk)}</div>
            </div>
          </div>
          <div className="wallet-trust-checklist">
            <div className={`wallet-trust-check ${trust.wallet ? 'check-pass' : 'check-fail'}`}>
              {trust.wallet ? '✅' : '⬜'} Wallet Connected (+25 trust)
            </div>
            <div className={`wallet-trust-check ${trust.key ? 'check-pass' : 'check-fail'}`}>
              {trust.key ? '✅' : '⬜'} Private Key Bound (+30 trust, −20 risk)
            </div>
            <div className={`wallet-trust-check ${trust.auto_pay_capable ? 'check-pass' : 'check-fail'}`}>
              {trust.auto_pay_capable ? '✅' : '⬜'} Auto-Pay Capable (pot-split eligible)
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
