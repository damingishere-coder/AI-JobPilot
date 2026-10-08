'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { BiHomeAlt } from 'react-icons/bi'
import ProfileSwitcher from './ProfileSwitcher'
import PageHeader from './PageHeader'
import { Button } from '@/components/ui/button'
import { API_BASE, friendlyApiError, readApiResponse } from '@/lib/api'
import { opportunityInterviewTime, opportunityTaskTab, platformLabels, type Opportunity } from '@/lib/opportunities'

type Count = { bucket: string; label: string; count: number; actionRequired: boolean; preview?: Opportunity[] }
export type Workbench = { profileId: number; generatedAt: string; day: string; timezone: string; counts: Count[] }
type HrPendingItem = { id: number; profileId: number; jobName: string; companyName: string; status: string; updatedAt: string | null }
type HrPendingPage = { profileId: number; view: string; status: string; q: string; page: number; size: number; total: number; totalPages: number; items: HrPendingItem[] }
type HrPendingSnapshot = { profileId: number; total: number; items: Omit<HrPendingItem, 'profileId'>[]; readAt: number }
const hrPendingStates: Record<string, { label: string; reason: string }> = {
  REVIEW_REQUIRED: { label: '待你决定', reason: '请审核回复草稿，再决定如何处理。' },
  SEND_UNKNOWN: { label: '发送结果未知', reason: '请先核对实际聊天结果，避免重复发送。' },
  BLOCKED: { label: '需人工处理', reason: '执行被阻止，请查看原因并决定下一步。' },
}

function HrPendingTasks({ profileId, revision }: { profileId: number | null; revision: number }) {
  const [snapshot, setSnapshot] = useState<HrPendingSnapshot | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
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
        const query = new URLSearchParams({ profileId: String(profileId), view: 'pending', status: 'ALL', q: '', page: '1', size: '3' })
        const response = await fetch(`${API_BASE}/api/hr-assistant/proposals/page?${query}`, { signal: request.signal, cache: 'no-store' })
        const envelope = await readApiResponse<HrPendingPage>(response, 'HR 待办读取失败')
        const value = envelope.data
        if (!value || !Array.isArray(value.items)) throw new Error('HR 待办响应不完整，请重新读取')
        if (value.profileId !== profileId || value.items.some(item => item.profileId !== profileId)) throw new Error('HR 待办档案不匹配，请刷新档案列表')
        if (value.view !== 'pending' || value.status !== 'ALL' || value.q !== '' || value.page !== 1 || value.size !== 3
          || !Number.isInteger(value.total) || value.total < 0 || !Number.isInteger(value.totalPages) || value.totalPages < 1
          || value.items.length !== Math.min(3, value.total) || value.items.some(item => !Number.isInteger(item.id) || item.id < 1 || !Object.hasOwn(hrPendingStates, item.status))) throw new Error('HR 待办分页响应不兼容，请重新读取')
        if (!request.signal.aborted && controller === request && !disposed) {
          // The page API also returns message bodies and drafts. Keep only safe task metadata on the home page.
          setSnapshot({ profileId, total: value.total, readAt: Date.now(), items: value.items.map(item => ({ id: item.id, jobName: typeof item.jobName === 'string' ? item.jobName : '', companyName: typeof item.companyName === 'string' ? item.companyName : '', status: item.status, updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null })) })
        }
      } catch (cause) { if ((!request.signal.aborted || timedOut) && controller === request && !disposed) setError(timedOut ? 'HR 待办读取超时，请稍后重试' : friendlyApiError(cause, 'HR 待办读取失败')) }
      finally { window.clearTimeout(deadline); if (controller === request && !disposed) setBusy(false) }
    }
    const startup = window.setTimeout(() => { void load(true) }, 0)
    const interval = window.setInterval(() => { void load() }, 30000)
    return () => { disposed = true; controller?.abort(); window.clearTimeout(startup); window.clearInterval(interval) }
  }, [profileId, revision, retry])
  const current = snapshot?.profileId === profileId ? snapshot : null
  const countLabel = !profileId ? '未选择档案' : busy ? '读取中…' : error ? '数量未知' : current ? String(current.total) : '数量未知'
  return <section aria-label="HR 待我处理" className="overflow-hidden rounded-xl border bg-card">
    <header className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3"><h2 className="text-lg font-semibold">HR 待我处理</h2><Link href="/hr" aria-label={`HR 待我处理 ${countLabel}`} className="flex shrink-0 items-center gap-3 text-sm font-medium text-primary"><span className="rounded bg-background px-2 py-1">{countLabel}</span><span>去处理 →</span></Link></header>
    <div className="space-y-2 p-4">
      <p className="text-sm text-muted-foreground">审核待决定回复、核对未知发送结果，或处理受阻任务。</p>
      {!profileId && <p className="text-sm text-muted-foreground">请先选择求职档案，再读取 HR 待办。</p>}
      {profileId && busy && <p role="status" className="text-sm text-muted-foreground">正在读取 HR 待办…</p>}
      {error && <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{error}；当前数量未知，未将读取失败记作零。<Button variant="outline" size="sm" className="ml-3" disabled={busy} onClick={() => setRetry(value => value + 1)}>重试 HR 待办</Button></div>}
      {current && <p className="text-xs text-muted-foreground">上次成功读取：{new Date(current.readAt).toLocaleString('zh-CN', { hour12: false })}{busy || error ? ` · 当前显示上次读取的 ${current.total} 条待办快照，可能已经变化。` : ` · 共 ${current.total} 条，预览最多 3 条。`}</p>}
      {!busy && !error && current?.total === 0 && <p className="text-sm text-muted-foreground">当前没有需要你处理的 HR 会话。</p>}
    </div>
    {!!current?.items.length && <ul className="divide-y border-t">{current.items.map(item => <li key={item.id}><Link href="/hr" className="block space-y-2 p-4 hover:bg-muted/50"><p className="break-words text-sm font-medium">{item.jobName || '岗位待核实'} · {item.companyName || '公司待核实'}</p><p className="text-sm"><span className="mr-2 rounded bg-muted px-2 py-1 text-xs font-medium">{hrPendingStates[item.status].label}</span>{hrPendingStates[item.status].reason}</p><p className="text-xs text-muted-foreground">更新：{item.updatedAt && Number.isFinite(Date.parse(item.updatedAt)) ? item.updatedAt.replace('T', ' ') : '时间未知'}</p><p className="text-xs text-primary">打开 HR 沟通处理 →</p></Link></li>)}</ul>}
  </section>
}

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
    {snapshot && <p className="text-sm text-muted-foreground">当前档案 · {snapshot.day} · 上海时间 · 截至 {new Date(snapshot.generatedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}；默认统计未归档机会，各分组可能重叠。</p>}
    <div><h2 className="mb-3 text-lg font-semibold">先处理这些事项</h2><div className="grid gap-4 lg:grid-cols-2">
      <HrPendingTasks profileId={profileId} revision={revision} />
      {actions.map(row => <article key={row.bucket} className="overflow-hidden rounded-xl border bg-card">
        <Link href={`/opportunities?bucket=${row.bucket}`} aria-label={`${row.label} ${row.count}`} className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3 text-sm font-medium hover:bg-muted"><span>{row.label}</span><span className="rounded bg-background px-2 py-1">{row.count}</span></Link>
        {row.preview?.length ? <ul className="divide-y">{row.preview.map(item => <li key={item.id}><Link className="block space-y-1 p-4 hover:bg-muted/50" href={`/opportunities?bucket=${row.bucket}&id=${item.id}&tab=${opportunityTaskTab(row.bucket)}`}><p className="text-sm font-medium">{item.job_name || '历史岗位'} · {item.company_name || '公司未知'}</p><p className="text-xs text-muted-foreground">{platformLabels[item.platform] || item.platform} · {item.location || '地点待核实'}</p>{item.follow_up_at && row.bucket === 'FOLLOW_UP' && <p className="text-xs text-primary">跟进时间：{new Date(item.follow_up_at).toLocaleString('zh-CN')}</p>}{item.interview_at && <p className="text-xs text-primary">第 {item.interview_round} 轮 · {opportunityInterviewTime(item)} · 准备 {item.interview_prepared ?? 0}/4 项</p>}<p className="text-xs text-primary">打开并处理 →</p></Link></li>)}</ul> : <p className="p-4 text-sm text-muted-foreground">打开列表查看需要处理的机会。</p>}
      </article>)}</div>{snapshot && !actions.length && <p className="mt-3 rounded-xl border bg-card p-5 text-muted-foreground">目前没有到期待处理机会，可以继续发现岗位或检查已投机会的回复。</p>}</div>
    {snapshot && <>
      <div><h2 className="mb-3 text-lg font-semibold">求职进度</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{progress.map(card)}</div><p className="mt-2 text-xs text-muted-foreground">“今日新发现”排除历史回填；其他分组为当前存量。“较高匹配”沿用现有分数（BOSS ≥75、智联 ≥65），不代表回复概率。“已投待回复”表示尚无确认回复记录，不代表已经检查过。</p></div>
    </>}
    <nav className="flex flex-wrap gap-3" aria-label="下一步入口"><Button asChild><Link href="/opportunities">查看全部机会</Link></Button><Button asChild variant="outline"><Link href="/boss">BOSS 岗位发现</Link></Button><Button asChild variant="outline"><Link href="/zhilian">智联岗位发现</Link></Button><Button asChild variant="outline"><Link href="/ai-config">维护求职档案</Link></Button></nav>
  </section>
}
