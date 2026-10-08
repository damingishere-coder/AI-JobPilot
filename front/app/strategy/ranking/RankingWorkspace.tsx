'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { strategyApi } from '@/lib/strategy'
import { confirmNavigation } from '@/lib/use-unsaved-changes'
import type { Preferences, RankingResult, RankingSettings } from '@/lib/ranking'
import PreferencesForm from './PreferencesForm'
import RankingList from './RankingList'

export default function RankingWorkspace({ profileId }: { profileId: number | null }) {
  const active = useRef(profileId)
  const [settings, setSettings] = useState<RankingSettings | null>(null)
  const [result, setResult] = useState<RankingResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => { active.current = profileId }, [profileId])
  useEffect(() => {
    if (!profileId) return
    const controller = new AbortController()
    setLoading(true); setError('')
    Promise.all([strategyApi<RankingSettings>('/ranking/settings', undefined, controller.signal), strategyApi<RankingResult>('/ranking', undefined, controller.signal)])
      .then(([config, data]) => {
        if (controller.signal.aborted) return
        if (config.profileId !== profileId || data.profileId !== profileId) throw new Error('档案已在其他窗口改变，请刷新')
        setSettings(config); setResult(data); setPreview(false)
      }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [profileId, revision])
  useEffect(() => {
    if (!preferencesOpen) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; panel.current?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreferencesOpen(false)
      if (event.key !== 'Tab') return
      const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]') || [])
      const first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', keyboard)
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', keyboard); previous?.focus() }
  }, [preferencesOpen])
  async function run(action: () => Promise<void>) {
    const owner = active.current; setBusy(true); setError('')
    try { await action() } catch (e) { if (owner === active.current) setError(e instanceof Error ? e.message : '推荐操作失败') }
    finally { if (owner === active.current) setBusy(false) }
  }
  async function showPreview(preferences: Preferences) {
    await run(async () => {
      const data = await strategyApi<RankingResult>('/ranking/preview', { profileId, preferences })
      if (active.current !== data.profileId) return
      setResult(data); setPreview(true)
    })
  }
  async function save(preferences: Preferences, enabled: boolean) {
    if (!settings) return
    await run(async () => {
      const config = await strategyApi<RankingSettings>('/ranking/settings', { profileId, version: settings.version, enabled, preferences })
      if (active.current !== config.profileId) return
      setSettings(config); setPreview(false); setPreferencesOpen(false)
      let data: RankingResult
      try { data = await strategyApi<RankingResult>('/ranking') }
      catch (e) { throw new Error(`偏好已保存，推荐列表读取失败，请刷新推荐。${e instanceof Error ? e.message : ''}`) }
      if (active.current !== data.profileId) return
      setResult(data)
    })
  }
  return <section className="space-y-4" aria-label="推荐机会工作区">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
      <div><h2 className="font-semibold">推荐机会</h2><p className="mt-1 text-sm text-muted-foreground">{settings ? settings.enabled ? '已启用偏好与反馈辅助排序' : '当前使用历史综合分排序' : '正在读取推荐设置'} · 不创建投递请求</p></div>
      <div className="flex flex-wrap gap-2"><Button disabled={!settings || busy} onClick={() => setPreferencesOpen(true)}>编辑求职偏好</Button><Button variant="outline" disabled={busy || loading} onClick={() => { if (confirmNavigation()) setRevision(value => value + 1) }}>刷新推荐</Button><Button asChild variant="outline"><Link href="/strategy">查看反馈统计</Link></Button></div>
    </div>
    {preview && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><span>正在预览偏好草稿，尚未保存。保存后才会启用新推荐顺序。</span><Button variant="outline" disabled={busy} onClick={() => run(async () => { const data = await strategyApi<RankingResult>('/ranking'); if (active.current === data.profileId) { setResult(data); setPreview(false) } })}>退出草稿预览</Button></div>}
    {loading && <p role="status" className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">正在读取推荐机会…</p>}
    {busy && <p role="status" className="text-sm text-muted-foreground">正在更新推荐…</p>}
    {error && <div role="alert" className="rounded border border-destructive/30 p-4 text-sm text-destructive">{error}<Button className="ml-3" variant="outline" disabled={busy || loading} onClick={() => { if (confirmNavigation()) setRevision(value => value + 1) }}>重试读取</Button></div>}
    {!loading && result && <RankingList key={`${revision}:${result.preferenceVersion}:${preview}:${result.strategyOrder}`} result={result} preview={preview} />}
    {settings && <div hidden={!preferencesOpen} className="fixed inset-0 z-[90] bg-black/30">
      <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="preference-panel-title" className="absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto bg-background p-5 shadow-xl outline-none sm:p-6">
        <header className="mb-5 flex items-center justify-between gap-3"><h2 id="preference-panel-title" className="text-xl font-semibold">求职偏好</h2><Button variant="outline" disabled={busy} onClick={() => setPreferencesOpen(false)}>收起偏好</Button></header>
        <p className="mb-4 text-sm text-muted-foreground">收起后保留当前草稿，可查看预览结果并继续编辑。</p>
        <PreferencesForm key={`${revision}:${settings.profileId}:${settings.version}`} settings={settings} busy={busy} onPreview={showPreview} onSave={value => save(value, true)} onDisable={() => { if (confirmNavigation()) void save(settings.preferences, false) }} />
      </section>
    </div>}
  </section>
}
