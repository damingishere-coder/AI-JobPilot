"use client"

import AnalysisBasis from "./AnalysisBasis"
import AnalysisContent from "@/app/zhilian/analysis/AnalysisContent"
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { API_BASE } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { type CurrentProfile } from "@/app/components/CurrentProfileBadge"
import { lastZhilianRun, rememberZhilianRun } from "@/lib/zhilian-scan-context"

export default function ZhilianAnalysisPage() {
  const [profile, setProfile] = useState<CurrentProfile | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [scanRunId, setScanRunId] = useState("")
  const [latestRunId, setLatestRunId] = useState("")
  const profileIdRef = useRef<number | null>(null)
  const requestRef = useRef(0)
  const changeScope = (runId: string) => {
    setScanRunId(runId)
    const url = new URL(window.location.href)
    if (runId && profile) { url.searchParams.set('scanRunId', runId); url.searchParams.set('profileId', String(profile.id)) }
    else { url.searchParams.delete('scanRunId'); url.searchParams.delete('profileId') }
    window.history.replaceState(window.history.state, '', url)
  }
  const loadProfile = useCallback(async () => {
    const request = ++requestRef.current
    try {
      const response = await fetch(`${API_BASE}/api/profiles/current`, { cache: 'no-store' })
      if (!response.ok) throw new Error('读取当前档案失败，请重试。')
      const result = await response.json()
      if (result.success === false) throw new Error(result.message || '读取当前档案失败。')
      if (request !== requestRef.current) return
      const current: CurrentProfile | null = result.data || null
      if (profileIdRef.current !== (current?.id ?? null)) {
        const params = new URLSearchParams(window.location.search)
        const fromUrl = Number(params.get('profileId')) === current?.id ? params.get('scanRunId') || '' : ''
        setScanRunId(fromUrl)
        setLatestRunId(fromUrl || (current ? lastZhilianRun(current.id) : ''))
        if (current && fromUrl) rememberZhilianRun(current.id, fromUrl)
        if (!fromUrl) {
          const url = new URL(window.location.href)
          url.searchParams.delete('scanRunId'); url.searchParams.delete('profileId')
          window.history.replaceState(window.history.state, '', url)
        }
        profileIdRef.current = current?.id ?? null
      } else if (current) setLatestRunId(lastZhilianRun(current.id))
      setProfile(current)
      setError('')
    } catch (cause) {
      if (request === requestRef.current) setError(cause instanceof Error ? cause.message : '读取档案失败。')
    } finally { if (request === requestRef.current) setLoaded(true) }
  }, [])
  useEffect(() => {
    void loadProfile()
    const visible = () => { if (document.visibilityState !== 'hidden') void loadProfile() }
    const timer = window.setInterval(visible, 5000)
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    return () => {
      // Invalidate any in-flight profile query on unmount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++requestRef.current
      window.clearInterval(timer)
      window.removeEventListener('focus', visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [loadProfile])
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
      <span>当前档案：{profile?.name || (loaded ? '未新建档案' : '加载中…')}</span>
      <Button variant={!scanRunId ? 'default' : 'outline'} onClick={() => changeScope('')}>全部岗位</Button>
      <Button variant={scanRunId ? 'default' : 'outline'} disabled={!latestRunId} onClick={() => changeScope(latestRunId)}>本次扫描</Button>
      <Button asChild variant="outline"><Link href="/zhilian">返回智联配置</Link></Button>
    </div>
    {error ? <div role="alert">{error} <Button onClick={() => void loadProfile()}>重试</Button></div>
      : !loaded ? <p role="status">正在加载当前档案…</p>
      : !profile ? <p>请先新建或选择简历档案。</p>
      : <><AnalysisBasis key={profile.id} profileId={profile.id} /><AnalysisContent key={`${profile.id}:${scanRunId}`} profileId={profile.id} activeScanRunId={scanRunId} showHeader /></>}
  </div>
}
