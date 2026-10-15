'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import ProfileSwitcher from '@/app/components/ProfileSwitcher'
import { Button } from '@/components/ui/button'
import { strategyApi } from '@/lib/strategy'
import type { Preferences, RankingResult, RankingSettings } from '@/lib/ranking'
import PreferencesForm from './PreferencesForm'
import RankingList from './RankingList'

export default function RankingPage() {
  const [profileId, setProfileId] = useState<number | null>(null)
  const active = useRef<number | null>(null)
  const [settings, setSettings] = useState<RankingSettings | null>(null)
  const [result, setResult] = useState<RankingResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  const [revision, setRevision] = useState(0)
  const changeProfile = useCallback((profile: { id: number } | null) => { active.current = profile?.id ?? null; setProfileId(active.current); setSettings(null); setResult(null); setBusy(false) }, [])
  useEffect(() => {
    if (!profileId) return
    const controller = new AbortController()
    Promise.all([strategyApi<RankingSettings>('/ranking/settings', undefined, controller.signal), strategyApi<RankingResult>('/ranking', undefined, controller.signal)])
      .then(([config, data]) => { if (controller.signal.aborted) return; if (config.profileId !== profileId || data.profileId !== profileId) throw new Error('档案已在其他窗口改变，请刷新'); setSettings(config); setResult(data); setPreview(false); setError('') })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [profileId, revision])
  async function run(action: () => Promise<void>) {
    const owner = active.current; setBusy(true); setError('')
    try { await action() } catch (e) { if (owner === active.current) setError(e instanceof Error ? e.message : '排序操作失败') }
    finally { if (owner === active.current) setBusy(false) }
  }
  async function showPreview(preferences: Preferences) {
    await run(async () => { const data = await strategyApi<RankingResult>('/ranking/preview', { profileId, preferences }); if (active.current !== data.profileId) return; setResult(data); setPreview(true) })
  }
  async function save(preferences: Preferences, enabled: boolean) {
    if (!settings) return
    await run(async () => {
      const config = await strategyApi<RankingSettings>('/ranking/settings', { profileId, version: settings.version, enabled, preferences })
      if (active.current !== config.profileId) return
      setSettings(config)
      const data = await strategyApi<RankingResult>('/ranking'); if (active.current !== data.profileId) return
      setResult(data); setPreview(false)
    })
  }
  return <main className="mx-auto max-w-6xl space-y-5 p-6"><h1 className="text-2xl font-semibold">三维推荐与偏好</h1><p className="text-sm text-muted-foreground">把能力匹配、个人偏好和真实反馈分开看，再决定关注哪些岗位。</p><ProfileSwitcher onProfileChange={changeProfile} />
    <div className="flex gap-3"><Button asChild variant="outline"><Link href="/strategy">查看反馈统计</Link></Button><Button variant="outline" disabled={busy} onClick={() => setRevision(v => v + 1)}>刷新已保存设置</Button></div>
    {busy && <p role="status">正在更新推荐…</p>}{error && <p role="alert" className="text-red-600">{error}</p>}
    {settings && <PreferencesForm key={`${settings.profileId}:${settings.version}`} settings={settings} busy={busy} onPreview={showPreview} onSave={value => save(value, true)} onDisable={() => save(settings.preferences, false)} />}
    {result && <RankingList key={`${revision}:${result.preferenceVersion}:${preview}:${result.strategyOrder}`} result={result} preview={preview} />}
  </main>
}
