import React, { useEffect } from 'react'

// Lightweight performance monitor that logs long tasks and frame drops to console.
export default function PerformanceMonitor() {
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return

    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // Long Task API entries
          if ((entry as any).entryType === 'longtask') {
            const e = entry as any
            if (e.duration > 50) {
              // Keep messages concise
              console.warn(`[Perf] Long task: ${Math.round(e.duration)}ms — ${e.name || 'task'}`)
            }
          }
        }
      })

      obs.observe({ entryTypes: ['longtask'] as any })

      return () => obs.disconnect()
    } catch (err) {
      // noop
    }
  }, [])

  // Also hook into rAF to detect frame budget exceedances
  useEffect(() => {
    let rafId: number | null = null
    let last = performance.now()

    function tick(now: number) {
      const elapsed = now - last
      last = now
      if (elapsed > 40) {
        console.warn(`[Perf] requestAnimationFrame gap ${Math.round(elapsed)}ms`)
      }
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => { if (rafId != null) cancelAnimationFrame(rafId) }
  }, [])

  return null
}
