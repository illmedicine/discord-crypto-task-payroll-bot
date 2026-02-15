import React, { useState } from 'react'
import { API_BASE } from '../api'

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

const statusColors: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#22c55e',
  rejected: '#ef4444',
}

/** Proxy image URLs through the backend to avoid expired Discord attachment tokens */
function proxyImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    // Proxy any HTTPS image URL (Discord CDN tokens expire, deleted-message attachments die)
    if (parsed.protocol === 'https:') {
      const base = API_BASE ? `${API_BASE.replace(/\/$/, '')}/api` : '/api'
      return `${base}/image-proxy?url=${encodeURIComponent(url)}`
    }
  } catch (_) {}
  return url
}

export default React.memo(function ProofRow({ proof, style, showActions = true, onAction, onPreview }: {
  proof: Proof,
  style?: React.CSSProperties,
  showActions?: boolean,
  onAction?: (action: string, id: number) => void,
  onPreview?: (url: string) => void,
}) {
  const rawUrl = proof.screenshot_url || proof.verification_url || null
  const thumbUrl = proxyImageUrl(rawUrl)
  const [imgError, setImgError] = useState(false)

  return (
    <div className="table-row" style={{ ...style, display: 'flex', alignItems: 'center', gap: 4, padding: '8px 0' }}>
      <div className="col" style={{ width: 50, flexShrink: 0 }}>{proof.id}</div>
      <div className="col" style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {proof.source === 'qualification' && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: '#7c5cfc33', color: '#a78bfa', marginRight: 6 }}>Qualification</span>}
          {proof.title || '(untitled)'}
        </div>
        {proof.notes && <div style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{proof.notes}</div>}
      </div>
      <div className="col" style={{ width: 120, flexShrink: 0, fontSize: 12, color: '#aaa' }}>{proof.assigned_user_id}</div>
      <div className="col" style={{ width: 100, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {thumbUrl && !imgError ? (
          <img
            src={thumbUrl}
            alt="Proof"
            loading="lazy"
            onClick={() => onPreview?.(thumbUrl)}
            style={{ width: 60, height: 45, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: '1px solid #333', transition: 'transform 0.15s' }}
            onError={() => setImgError(true)}
            onMouseOver={(e) => { (e.target as HTMLImageElement).style.transform = 'scale(1.1)' }}
            onMouseOut={(e) => { (e.target as HTMLImageElement).style.transform = 'scale(1)' }}
          />
        ) : rawUrl ? (
          <a
            href={rawUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open original image"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 60, height: 45, borderRadius: 4, border: '1px solid #444', background: '#1a1a2e', color: '#7c5cfc', fontSize: 18, textDecoration: 'none', cursor: 'pointer' }}
          >
            📷
          </a>
        ) : (
          <span style={{ fontSize: 11, color: '#555' }}>No image</span>
        )}
        {proof.verification_url && proof.verification_url !== proof.screenshot_url && (
          <a
            href={proof.verification_url}
            target="_blank"
            rel="noopener noreferrer"
            title="Verification link"
            style={{ marginLeft: 4, fontSize: 11, color: '#7c5cfc' }}
            onClick={e => e.stopPropagation()}
          >
            🔗
          </a>
        )}
      </div>
      <div className="col" style={{ width: 80, flexShrink: 0 }}>
        <span style={{ padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: `${statusColors[proof.status] || '#666'}22`, color: statusColors[proof.status] || '#888' }}>
          {proof.status}
        </span>
      </div>
      <div className="col" style={{ width: 100, flexShrink: 0, fontSize: 12 }}>
        {proof.payout_amount ? `${proof.payout_amount} ${proof.payout_currency || 'SOL'}` : '--'}
      </div>
      {showActions && (
        <div className="col" style={{ width: 260, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => onAction?.('approve', proof.id)} style={{ fontSize: 11, padding: '4px 8px' }}>✓ Approve</button>
            <button onClick={() => onAction?.('approve_pay', proof.id)} style={{ fontSize: 11, padding: '4px 8px', background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e44' }}>✓ Approve & Pay</button>
            <button onClick={() => onAction?.('reject', proof.id)} style={{ fontSize: 11, padding: '4px 8px', background: '#ef444422', color: '#ef4444', border: '1px solid #ef444444' }}>✗ Reject</button>
          </div>
        </div>
      )}
    </div>
  )
})
