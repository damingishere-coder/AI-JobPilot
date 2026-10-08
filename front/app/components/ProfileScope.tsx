'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { API_BASE, friendlyApiError, readApiResponse } from '@/lib/api'
import { confirmNavigation, hasUnsavedChanges } from '@/lib/use-unsaved-changes'
import type { Profile } from './ProfileSwitcher'

type ProfileResult = { profiles: Profile[]; current: Profile | null }
type Scope = ProfileResult & {
  loading: boolean; error: string
  conflicted: boolean
  switching: boolean
  beginSwitch: () => boolean
  endSwitch: () => void
  refresh: (acceptChange?: boolean) => Promise<ProfileResult>
  canSwitch: () => boolean
  registerGuard: (id: string, guard: () => boolean) => () => void
}
const ProfileContext = createContext<Scope | null>(null)
export function useProfileScope() { return useContext(ProfileContext) }

export function ProfileScopeProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ProfileResult>({ profiles: [], current: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [conflicted, setConflicted] = useState(false)
  const [switching, setSwitching] = useState(false)
  const switchingRef = useRef(false)
  const guards = useRef(new Map<string, () => boolean>())
  const request = useRef(0)
  const currentRef = useRef<Profile | null>(null)
  const refresh = useCallback(async (acceptChange = false) => {
    const sequence = ++request.current
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/profiles`, { cache: 'no-store' })
      const envelope = await readApiResponse<Profile[]>(response, '档案读取失败') as { data?: Profile[]; current?: Profile }
      const profiles = Array.isArray(envelope.data) ? envelope.data : []
      const next = { profiles, current: envelope.current || profiles.find(item => item.isActive === 1) || profiles[0] || null }
      if (sequence === request.current) {
        if (!acceptChange && currentRef.current && next.current?.id !== currentRef.current.id && hasUnsavedChanges()) {
          setConflicted(true)
          setError('档案已在其他窗口改变。当前草稿已保留，请放弃修改后刷新档案再继续。')
          return { profiles, current: currentRef.current }
        }
        currentRef.current = next.current
        setData(next); setError(''); setConflicted(false)
      }
      return next
    } catch (cause) {
      if (sequence === request.current) setError(friendlyApiError(cause, '档案读取失败'))
      throw cause
    } finally { if (sequence === request.current) setLoading(false) }
  }, [])
  const registerGuard = useCallback((id: string, guard: () => boolean) => {
    guards.current.set(id, guard)
    return () => { guards.current.delete(id) }
  }, [])
  const canSwitch = useCallback(() => {
    if (switchingRef.current) return false
    if (hasUnsavedChanges()) return confirmNavigation()
    return [...guards.current.values()].every(guard => guard())
  }, [])
  const beginSwitch = useCallback(() => {
    if (!canSwitch()) return false
    switchingRef.current = true; setSwitching(true); return true
  }, [canSwitch])
  const endSwitch = useCallback(() => { switchingRef.current = false; setSwitching(false) }, [])
  useEffect(() => {
    const lifecycleRequest = request
    void refresh().catch(() => {})
    const focus = () => { void refresh().catch(() => {}) }
    window.addEventListener('focus', focus)
    return () => { ++lifecycleRequest.current; window.removeEventListener('focus', focus) }
  }, [refresh])
  const value = useMemo(() => ({ ...data, loading, error, conflicted, switching, beginSwitch, endSwitch, refresh, canSwitch, registerGuard }), [data, loading, error, conflicted, switching, beginSwitch, endSwitch, refresh, canSwitch, registerGuard])
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}
