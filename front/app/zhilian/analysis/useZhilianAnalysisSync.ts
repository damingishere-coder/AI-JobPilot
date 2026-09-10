'use client'

import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '@/lib/api'
import { sendChromeBridgeMessage, subscribeChromeBridgeEvents } from '@/lib/chromeBridge'
import { createSSEWithBackoff } from '@/lib/sse'
import { scanEventMatchesProfile } from '@/lib/scan-profile'

export function useZhilianAnalysisSync(profileId: number, refresh: () => Promise<unknown>, hasPending: boolean) {
  const refreshRef = useRef(refresh)
  const pendingRef = useRef(hasPending)
  const [scanning, setScanning] = useState(false)
  const [queueBusy, setQueueBusy] = useState(false)
  useEffect(() => { refreshRef.current = refresh; pendingRef.current = hasPending }, [refresh, hasPending])
  useEffect(() => {
    let disposed = false
    let inFlight = false
    let wasRunning = false
    let hadQueuedTasks = false
    let debounce: ReturnType<typeof setTimeout> | undefined
    const requestRefresh = () => {
      if (disposed || document.visibilityState === 'hidden') return
      clearTimeout(debounce)
      debounce = setTimeout(() => { if (!disposed) void refreshRef.current() }, 200)
    }
    const progress = (payload: Record<string, unknown> | undefined) => {
      if (!scanEventMatchesProfile(payload, profileId, true)) return
      requestRefresh()
    }
    const tick = async () => {
      if (disposed || inFlight || document.visibilityState === 'hidden') return
      inFlight = true
      try {
        const [status, queue] = await Promise.all([
          sendChromeBridgeMessage({ type: 'ZHILIAN_SCAN_STATUS', platform: 'zhilian', profileId }, 2000),
          fetch(`${API_BASE}/api/ai/job-analysis/tasks?platform=zhilian&limit=1`, { cache: 'no-store', signal: AbortSignal.timeout(4000) })
            .then(async response => response.ok ? response.json() : null).catch(() => null),
        ])
        if (disposed) return
        const running = Boolean(status.isRunning || status.hasStoredTask)
        const queued = queue?.success === true ? Number(queue.queueSize || 0) > 0 : hadQueuedTasks
        setScanning(running); setQueueBusy(queued)
        if (running || wasRunning || queued || hadQueuedTasks || pendingRef.current) await refreshRef.current()
        wasRunning = running; hadQueuedTasks = queued
      } finally { inFlight = false }
    }
    const unsubscribe = subscribeChromeBridgeEvents(event => {
      if (event.payload?.platform === 'zhilian') progress(event.payload)
    })
    const stream = typeof EventSource === 'undefined' ? null : createSSEWithBackoff(`${API_BASE}/api/zhilian/stream`, {
      listeners: [{ name: 'progress', handler: event => {
        try {
          const envelope = JSON.parse(event.data)
          const payload = envelope.data ?? envelope
          progress(typeof payload === 'string' ? JSON.parse(payload) : payload)
        } catch { /* Ignore malformed events; periodic status checks remain active. */ }
      } }],
    })
    const visible = () => { requestRefresh(); void tick() }
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    const timer = window.setInterval(() => void tick(), 5000)
    void tick()
    return () => {
      disposed = true
      clearTimeout(debounce)
      window.clearInterval(timer)
      unsubscribe()
      stream?.close()
      window.removeEventListener('focus', visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [profileId])
  return scanning || queueBusy || hasPending
}
