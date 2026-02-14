import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import Countdown from '../components/Countdown'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type EventInfo = {
  id: number
  title: string
  description: string
  prize_amount: number
  currency: string
  min_participants: number
  max_participants: number
  current_participants: number
  status: string
  qualification_url: string | null
  ends_at: string | null
  created_at: string
  images: { image_id: string; image_url: string; upload_order: number }[]
}

type Qualification = {
  id: number
  vote_event_id: number
  user_id: string
  username: string
  screenshot_url: string
  status: string
  submitted_at: string
  reviewed_at: string | null
  reviewed_by: string | null
}

type Props = { eventId: number }

/* ------------------------------------------------------------------ */
/*  Helper                                                             */
/* ------------------------------------------------------------------ */
function statusBadge(s: string) {
  switch (s) {
    case 'approved': return 'badge badge-completed'
    case 'rejected': return 'badge badge-ended'
    default:         return 'badge badge-open'
  }
}

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */
export default function QualifyPage({ eventId }: Props) {
  const [event, setEvent] = useState<EventInfo | null>(null)
  const [qual, setQual] = useState<Qualification | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'visit' | 'upload' | 'done'>('visit')
  const [urlVisited, setUrlVisited] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /* ---- Load event + qualification status ---- */
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [evRes, qualRes] = await Promise.all([
        api.get(`/public/vote-events/${eventId}`),
        api.get(`/public/vote-events/${eventId}/my-qualification`),
      ])
      setEvent(evRes.data)
      if (qualRes.data) {
        setQual(qualRes.data)
        setStep('done')
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load event')
    } finally {
      setLoading(false)
    }
  }, [eventId])

  useEffect(() => { load() }, [load])

  /* ---- Visit URL handler ---- */
  const handleVisitUrl = () => {
    if (!event?.qualification_url) return
    window.open(event.qualification_url, '_blank', 'noopener')
    setUrlVisited(true)
    // Auto-advance to upload step after a short delay
    setTimeout(() => setStep('upload'), 1200)
  }

  /* ---- Submit screenshot ---- */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fileInputRef.current?.files?.length) {
      setError('Please select a screenshot file.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('screenshot', fileInputRef.current.files[0])
      const res = await api.post(`/public/vote-events/${eventId}/qualify`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setQual(res.data)
      setStep('done')
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Submission failed'
      if (msg === 'already_submitted') {
        setError('You have already submitted a qualification for this event.')
        await load()
      } else {
        setError(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <div className="container" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <div className="spinner" />
      </div>
    )
  }

  /* ---- Error / not found ---- */
  if (!event) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state-icon">❌</div>
          <div className="empty-state-text">{error || 'Event not found.'}</div>
        </div>
      </div>
    )
  }

  /* ---- No qualification required ---- */
  if (!event.qualification_url) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state-icon">✅</div>
          <div className="empty-state-text">This event does not require qualification. You can join directly on Discord!</div>
        </div>
      </div>
    )
  }

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  return (
    <div className="container" style={{ maxWidth: 720 }}>
      {/* Event Header Card */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">🗳️ {event.title}</div>
          <span className={statusBadge(event.status)}>{event.status}</span>
        </div>
        <div style={{ padding: '4px 0', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          {event.description && <p style={{ marginBottom: 12 }}>{event.description}</p>}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>🎁 <strong>{event.prize_amount} {event.currency}</strong></span>
            <span>🪑 {event.current_participants}/{event.max_participants} seats</span>
            {event.ends_at && (
              <Countdown endsAt={event.ends_at} prefix='⏱️ Ends in ' />
            )}
          </div>
        </div>

        {/* Image previews */}
        {event.images.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, overflowX: 'auto', paddingBottom: 4 }}>
            {event.images.map(img => (
              <img
                key={img.image_id}
                src={img.image_url}
                alt={`Image ${img.upload_order}`}
                style={{
                  width: 80, height: 80, borderRadius: 8,
                  objectFit: 'cover', border: '2px solid var(--border-color)',
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Qualification Steps Card */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">📋 Qualification Steps</div>
        </div>

        {/* Step indicator */}
        <div className="qualify-steps">
          <div className={`qualify-step ${step === 'visit' ? 'active' : urlVisited || step !== 'visit' ? 'completed' : ''}`}>
            <div className="qualify-step-num">{urlVisited || step !== 'visit' ? '✓' : '1'}</div>
            <span>Visit URL</span>
          </div>
          <div className="qualify-step-line" />
          <div className={`qualify-step ${step === 'upload' ? 'active' : step === 'done' ? 'completed' : ''}`}>
            <div className="qualify-step-num">{step === 'done' ? '✓' : '2'}</div>
            <span>Upload Proof</span>
          </div>
          <div className="qualify-step-line" />
          <div className={`qualify-step ${step === 'done' ? 'completed' : ''}`}>
            <div className="qualify-step-num">{step === 'done' ? '✓' : '3'}</div>
            <span>Verified</span>
          </div>
        </div>

        {/* Step 1: Visit URL */}
        {step === 'visit' && (
          <div className="qualify-panel">
            <h3 style={{ margin: '0 0 8px', fontSize: 16, color: 'var(--text-primary)' }}>
              Step 1: Visit the Qualification URL
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Click the button below to open the required URL. After visiting, you'll be asked to upload a screenshot as proof.
            </p>
            <div style={{
              background: 'var(--bg-tertiary)', borderRadius: 8, padding: '10px 14px',
              fontSize: 13, wordBreak: 'break-all', marginBottom: 16, color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
            }}>
              🔗 {event.qualification_url}
            </div>
            <button className="btn btn-primary" onClick={handleVisitUrl} style={{ width: '100%' }}>
              🌐 Open Qualification URL
            </button>
            {urlVisited && (
              <p style={{ fontSize: 12, color: 'var(--accent-green)', marginTop: 8, textAlign: 'center' }}>
                ✅ URL opened — preparing upload step...
              </p>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 12, width: '100%', opacity: 0.7 }}
              onClick={() => { setUrlVisited(true); setStep('upload') }}
            >
              I've already visited the URL →
            </button>
          </div>
        )}

        {/* Step 2: Upload screenshot */}
        {step === 'upload' && (
          <div className="qualify-panel">
            <h3 style={{ margin: '0 0 8px', fontSize: 16, color: 'var(--text-primary)' }}>
              Step 2: Upload Screenshot Proof
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Take a screenshot showing you visited the URL, then upload it below. An admin will review your submission.
            </p>
            {error && (
              <div style={{ padding: '8px 12px', background: 'rgba(231,76,60,0.15)', borderRadius: 8, marginBottom: 12, fontSize: 13, color: '#e74c3c' }}>
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Screenshot *</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="form-input"
                  style={{ padding: 8 }}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: '100%', marginTop: 8 }}>
                {submitting ? 'Submitting...' : '📤 Submit Proof'}
              </button>
            </form>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 12, width: '100%', opacity: 0.7 }}
              onClick={() => setStep('visit')}
            >
              ← Back to Step 1
            </button>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 'done' && qual && (
          <div className="qualify-panel" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>
              {qual.status === 'approved' ? '🎉' : qual.status === 'rejected' ? '❌' : '⏳'}
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, color: 'var(--text-primary)' }}>
              {qual.status === 'approved' ? 'Qualification Approved!' :
               qual.status === 'rejected' ? 'Qualification Rejected' :
               'Proof Submitted — Awaiting Review'}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              {qual.status === 'approved'
                ? 'You are qualified to participate in this vote event! Head to Discord to join and vote.'
                : qual.status === 'rejected'
                ? 'Your qualification was rejected. Please contact an admin for more information.'
                : 'An admin will review your screenshot soon. Check back later for your status.'}
            </p>
            <span className={statusBadge(qual.status)} style={{ fontSize: 14, padding: '6px 16px' }}>
              {qual.status.toUpperCase()}
            </span>
            {qual.screenshot_url && (
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Your submitted proof:</p>
                <img
                  src={qual.screenshot_url}
                  alt="Submitted proof"
                  style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, border: '2px solid var(--border-color)' }}
                />
              </div>
            )}
            <button className="btn btn-secondary btn-sm" onClick={load} style={{ marginTop: 16 }}>
              🔄 Refresh Status
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
