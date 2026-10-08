'use client'

import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '@/lib/api'

/** Read only queue observation; never starts analysis, collection, or delivery. */
export function useExperimentalAnalysisSync(platform: 'liepin' | '51job', refresh: () => Promise<unknown>) {
  const refreshRef = useRef(refresh)
  const [busy, setBusy] = useState(false)
  useEffect(() => { refreshRef.current = refresh }, [refresh])
  useEffect(() => {
    let disposed = false
    let inFlight = false
    let wasBusy = false
    const tick = async () => {
      if (disposed || inFlight || document.visibilityState === 'hidden') return
      inFlight = true
      try {
        const response = await fetch(`${API_BASE}/api/ai/job-analysis/tasks?platform=${platform}&limit=1`, { cache: 'no-store', signal: AbortSignal.timeout(4000) })
        if (!response.ok) return
        const data = await response.json()
        if (disposed || data.success === false) return
        const nextBusy = Number(data.queueSize || 0) > 0
        setBusy(nextBusy)
        if (nextBusy || wasBusy) await refreshRef.current()
        wasBusy = nextBusy
      } catch { /* Keep the last confirmed queue state while disconnected. */ }
      finally { inFlight = false }
    }
    const visible = () => { void tick() }
    const timer = window.setInterval(visible, 5000)
    window.addEventListener('focus', visible)
    void tick()
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', visible) }
  }, [platform])
  return busy
}
