import React, { useEffect } from 'react'
import { throttle } from '../utils/throttle'

const throttledWarn = throttle((...args: any[]) => console.warn(...args), 200)

// Lightweight performance monitor that logs long tasks and frame drops to console.
export default function PerformanceMonitor() {
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return

    try {
      const obs = new PerformanceObserver((list) => {
        const report = (entry: any) => {
          if (entry.duration > 50) {
            throttledWarn(`[Perf] Long task: ${Math.round(entry.duration)}ms — ${entry.name || 'task'}`)
          }
        }
        for (const entry of list.getEntries()) {
          // Long Task API entries
          if ((entry as any).entryType === 'longtask') {
            report(entry)
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
        throttledWarn(`[Perf] requestAnimationFrame gap ${Math.round(elapsed)}ms`)
      }
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => { if (rafId != null) cancelAnimationFrame(rafId) }
  }, [])

  return null
}
