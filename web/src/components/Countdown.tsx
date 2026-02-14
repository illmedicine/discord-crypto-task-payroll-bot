import { useEffect, useState } from 'react'

/* ------------------------------------------------------------------ */
/*  Hook: useTick — forces a re-render every `interval` ms             */
/* ------------------------------------------------------------------ */
export function useTick(intervalMs = 1000) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
}

/* ------------------------------------------------------------------ */
/*  Pure helper: human-readable time-left string                       */
/* ------------------------------------------------------------------ */
export function formatTimeLeft(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const diff = new Date(dateStr).getTime() - Date.now()
  if (diff <= 0) return 'Ended'
  const totalSec = Math.floor(diff / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/* ------------------------------------------------------------------ */
/*  Pure helper: human-readable time-ago string                        */
/* ------------------------------------------------------------------ */
export function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

/* ------------------------------------------------------------------ */
/*  Component: live countdown badge                                    */
/* ------------------------------------------------------------------ */
type CountdownProps = {
  endsAt: string | null | undefined
  prefix?: string   // e.g. "⏱️ " or "Ends in "
  endedText?: string
}

export default function Countdown({ endsAt, prefix = '⏱️ ', endedText = 'Ended' }: CountdownProps) {
  useTick(1000)
  if (!endsAt) return null
  const text = formatTimeLeft(endsAt)
  const ended = text === 'Ended'
  return (
    <span style={{ color: ended ? 'var(--accent-red, #e74c3c)' : 'var(--text-secondary)' }}>
      {ended ? endedText : `${prefix}${text}`}
    </span>
  )
}
