'use client'
import { useCallback, useSyncExternalStore } from 'react'
import { readScanResult, type ScanResultData } from '@/app/zhilian/ScanResult'

const cache = new Map<string, {raw: string | null; result: ScanResultData | null}>()
const changedEvent = 'getjobs-scan-result-changed'
function snapshot(key: string) {
  try {
    const raw = localStorage.getItem(key)
    const previous = cache.get(key)
    if (previous?.raw === raw) return previous.result
    const result = raw ? readScanResult(JSON.parse(raw)) : null
    cache.set(key, {raw, result})
    return result
  } catch { return null }
}
function subscribe(notify: () => void) {
  window.addEventListener('storage', notify)
  window.addEventListener(changedEvent, notify)
  return () => { window.removeEventListener('storage', notify); window.removeEventListener(changedEvent, notify) }
}
const serverSnapshot = () => null
export function useScanResult(platform: string, profileId?: number) {
  const key = `getjobs-scan-result:${platform}:${profileId || 0}`
  const getSnapshot = useCallback(() => snapshot(key), [key])
  const result = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot)
  const update = useCallback((value: ScanResultData | null) => {
    try {
      if (value && profileId) localStorage.setItem(key, JSON.stringify(value))
      else localStorage.removeItem(key)
      window.dispatchEvent(new Event(changedEvent))
    } catch { /* Storage limits must not interrupt a scan. */ }
  }, [key, profileId])
  return [result, update] as const
}
