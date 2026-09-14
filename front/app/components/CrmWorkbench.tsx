'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { BiHomeAlt } from 'react-icons/bi'
import ProfileSwitcher from './ProfileSwitcher'
import PageHeader from './PageHeader'
import { Button } from '@/components/ui/button'
import { API_BASE, friendlyApiError } from '@/lib/api'

type Count = { bucket: string; label: string; count: number; actionRequired: boolean }
export type Workbench = { profileId: number; generatedAt: string; day: string; timezone: string; counts: Count[] }

export default function CrmWorkbench() {
  const [profileId, setProfileId] = useState<number | null>(null)
  const [snapshot, setSnapshot] = useState<Workbench | null>(null)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const profileChanged = useCallback((profile: { id: number } | null) => { setProfileId(profile?.id ?? null); setSnapshot(null) }, [])
  useEffect(() => {
    if (!profileId) return
    let controller: AbortController | null = null
    let disposed = false
    const load = async (initial = false) => {
      if (disposed || (!initial && document.visibilityState === 'hidden')) return
      controller?.abort(); const request = new AbortController(); controller = request
      let timedOut = false
      const deadline = window.setTimeout(() => { timedOut = true; request.abort() }, 8000)
      setBusy(true); setError('')
      try {
        const response = await fetch(`${API_BASE}/api/workbench`, { signal: request.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('工作台暂不可用，请稍后刷新')
        const value = await response.json() as Workbench
        if (value.profileId !== profileId) throw new Error('当前档案已在其他窗口改变，请刷新档案列表')
        if (!request.signal.aborted && !disposed) setSnapshot(value)
      } catch (e) { if ((!request.signal.aborted || timedOut) && !disposed) { setError(timedOut ? '工作台读取超时，请稍后刷新' : friendlyApiError(e, '工作台加载失败')); setSnapshot(null) } }
      finally { window.clearTimeout(deadline); if (controller === request && !disposed) setBusy(false) }
    }
    const startup = window.setTimeout(() => { void load(true) }, 0)
    const interval = window.setInterval(() => { void load() }, 30000)
    return () => { disposed = true; controller?.abort(); window.clearTimeout(startup); window.clearInterval(interval) }
  }, [profileId, revision])
  const actions = snapshot?.counts.filter(row => row.actionRequired && row.count > 0) || []
  const progress = snapshot?.counts.filter(row => !row.actionRequired) || []
  const card = (row: Count) => <Link key={row.bucket} href={`/opportunities?bucket=${row.bucket}`} className="rounded-xl border bg-card p-4 transition-colors hover:bg-muted">
    <p className="text-sm text-muted-foreground">{row.label}</p><p className="mt-2 text-3xl font-semibold">{row.count}</p>
  </Link>
  return <section className="space-y-5" aria-label="求职工作台">
    <PageHeader title="求职工作台" subtitle="先处理需要你确认、核对和跟进的机会" icon={<BiHomeAlt size={28} />} actions={<Button variant="outline" disabled={busy} onClick={() => setRevision(v => v + 1)}>刷新工作台</Button>} />
    <ProfileSwitcher onProfileChange={profileChanged} />
    {busy && <p role="status" className="text-sm text-muted-foreground">正在读取求职进度…</p>}
    {error && <p role="alert" className="rounded border border-red-200 p-4 text-red-600">{error}，未将读取失败记作零。</p>}
    {snapshot && <>
      <p className="text-sm text-muted-foreground">当前档案 · {snapshot.day} · 上海时间 · 截至 {new Date(snapshot.generatedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}；默认统计未归档机会，各分组可能重叠。</p>
      <div><h2 className="mb-3 text-lg font-semibold">先处理这些事项</h2>{actions.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{actions.map(card)}</div> : <p className="rounded-xl border bg-card p-5 text-muted-foreground">目前没有到期待处理事项，可以继续发现岗位或检查已投机会的回复。</p>}</div>
      <div><h2 className="mb-3 text-lg font-semibold">求职进度</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{progress.map(card)}</div><p className="mt-2 text-xs text-muted-foreground">“今日新发现”排除历史回填；其他分组为当前存量。“较高匹配”沿用现有分数（BOSS ≥75、智联 ≥65），不代表回复概率。“已投待回复”表示尚无确认回复记录，不代表已经检查过。</p></div>
    </>}
    <nav className="flex flex-wrap gap-3" aria-label="下一步入口"><Button asChild><Link href="/opportunities">查看全部机会</Link></Button><Button asChild variant="outline"><Link href="/boss">BOSS 岗位发现</Link></Button><Button asChild variant="outline"><Link href="/zhilian">智联岗位发现</Link></Button><Button asChild variant="outline"><Link href="/ai-config">维护求职档案</Link></Button></nav>
  </section>
}
