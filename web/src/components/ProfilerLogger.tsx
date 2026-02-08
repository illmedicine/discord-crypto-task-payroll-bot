import React from 'react'

export default function ProfilerLogger({ id, children }: { id: string; children: React.ReactNode }) {
  function onRenderCallback(
    _id: string,
    phase: 'mount' | 'update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number,
    interactions: any
  ) {
    if (actualDuration > 30) {
      console.warn(`[Profiler] ${id} ${phase} took ${Math.round(actualDuration)}ms (base ${Math.round(baseDuration)}ms)`)
    }
  }

  return (
    <React.Profiler id={id} onRender={onRenderCallback}>
      {children}
    </React.Profiler>
  )
}
