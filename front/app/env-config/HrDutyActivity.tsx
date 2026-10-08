'use client'

import { useEffect, useState } from 'react'
import { API_BASE, localActionFetch, readApiResponse, friendlyApiError } from '@/lib/api'
import { useUnsavedChanges } from '@/lib/use-unsaved-changes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type Proposal = { id: number; profileId: number; version: number; status: string; companyName: string; hrName: string; sourceMessage: string; draft: string }
type Activity = { counts: Record<string, number>; progress: { processed: number; baseline_complete: number }; decisions: { proposalId: number; reason: string; origin: string }[] }
type View = 'legacy' | 'pending' | 'history'
type Filters = { q: string; status: string; size: number }
type SearchState = { draft: Filters; applied: Filters; page: number }
type ProposalPage = { profileId: number; view: string; status: string; q: string; page: number; size: number; total: number; totalPages: number; items: Proposal[] }
const labels: Record<string, string> = { OBSERVED: '处理中', GENERATING: '处理中', APPROVED: '等待发送', SENDING: '正在发送', SENT_CONFIRMED: '已发送', REVIEW_REQUIRED: '待你决定', SKIPPED: '无需回复', SEND_UNKNOWN: '发送结果未知', BLOCKED: '需人工处理', EXPIRED: '已失效' }
const attention = new Set(['REVIEW_REQUIRED', 'SEND_UNKNOWN', 'BLOCKED'])
const defaultFilters = (): Filters => ({ q: '', status: 'ALL', size: 10 })
const defaultSearch = (): Record<View, SearchState> => Object.fromEntries(['legacy', 'pending', 'history'].map(view => [view, { draft: defaultFilters(), applied: defaultFilters(), page: 1 }])) as Record<View, SearchState>

export default function HrDutyActivity({ profileId, view = 'legacy' }: { profileId: number; view?: View }) {
  const [rows, setRows] = useState<Proposal[]>([])
  const [activity, setActivity] = useState<Activity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState(defaultSearch)
  const [snapshot, setSnapshot] = useState<ProposalPage | null>(null)
  const [revision, setRevision] = useState(0)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [busyIds, setBusyIds] = useState<Set<number>>(() => new Set())
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null)
  const selected = search[view]
  const { q, status, size } = selected.applied
  const requestedPage = selected.page
  const criteriaChanged = selected.draft.q !== q || selected.draft.status !== status || selected.draft.size !== size
  useUnsavedChanges(`hr-replies-${profileId}`, Object.keys(drafts).length > 0)
  useEffect(() => {
    setRows([]); setSnapshot(null); setActivity(null); setDrafts({}); setBusyIds(new Set()); setLastSuccessAt(null); setSearch(defaultSearch())
  }, [profileId])
  useEffect(() => {
    let disposed = false, busy = false
    const controller = new AbortController()
    setLoading(true)
    async function refresh() {
      if (busy) return
      busy = true
      if (!disposed) setLoading(true)
      try {
        const parameters = new URLSearchParams({ profileId: String(profileId), view, status, q, page: String(requestedPage), size: String(size) })
        const [proposals, policy] = await Promise.all([
          fetch(`${API_BASE}/api/hr-assistant/proposals${view === 'legacy' ? '?includeClosed=true' : `/page?${parameters}`}`, { signal: controller.signal, cache: 'no-store' }).then(r => readApiResponse<Proposal[] | ProposalPage>(r, '回复记录读取失败')),
          fetch(`${API_BASE}/api/hr-assistant/autopilot`, { signal: controller.signal, cache: 'no-store' }).then(r => readApiResponse<{ profileId?: number; activity?: Activity }>(r, '值班进度读取失败')),
        ])
        if ((view !== 'legacy' || policy.data?.profileId !== undefined) && policy.data?.profileId !== profileId) throw new Error('值班进度档案不匹配，请重新读取；回复操作已锁定')
        let nextRows: Proposal[], nextSnapshot: ProposalPage | null = null
        if (view === 'legacy') {
          if (!Array.isArray(proposals.data)) throw new Error('回复记录响应格式不兼容，请重新读取')
          nextRows = proposals.data.filter(p => p.profileId === profileId)
        } else {
          const result = proposals.data as ProposalPage | undefined
          if (!result || !Array.isArray(result.items) || result.profileId !== profileId || result.items.some(row => row.profileId !== profileId)) throw new Error('回复记录档案不匹配，请重新读取')
          if (result.view !== view || result.status !== status || result.q !== q || result.size !== size
            || !Number.isInteger(result.page) || result.page < 1 || !Number.isInteger(result.totalPages) || result.totalPages < result.page
            || !Number.isInteger(result.total) || result.total < 0 || (view === 'pending' && result.items.some(row => !attention.has(row.status)))) throw new Error('回复记录分页响应格式不兼容，请重新读取')
          nextRows = result.items; nextSnapshot = result
        }
        if (!disposed) { setRows(nextRows); setSnapshot(nextSnapshot); setActivity(policy.data?.activity || null); setError(''); setLastSuccessAt(new Date().toLocaleString('zh-CN', { hour12: false })) }
      } catch (e) { if (!disposed) setError(friendlyApiError(e, '记录读取失败')) }
      finally { busy = false; if (!disposed) setLoading(false) }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 15000)
    return () => { disposed = true; controller.abort(); clearInterval(timer) }
  }, [profileId, view, q, status, size, requestedPage, revision])
  const currentPage = snapshot?.page || 1
  const pages = snapshot?.totalPages || 1
  const updateDraft = (patch: Partial<Filters>) => setSearch(current => ({ ...current, [view]: { ...current[view], draft: { ...current[view].draft, ...patch } } }))
  const applyFilters = () => setSearch(current => { const next = { ...current[view].draft, q: current[view].draft.q.trim() }; return { ...current, [view]: { draft: next, applied: next, page: 1 } } })
  const resetFilters = () => setSearch(current => ({ ...current, [view]: { draft: defaultFilters(), applied: defaultFilters(), page: 1 } }))
  const changePage = (page: number) => setSearch(current => ({ ...current, [view]: { ...current[view], page } }))
  const contents = <>
    {loading && <p role="status" className="text-sm text-muted-foreground">正在读取回复记录…</p>}
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span>{error}{rows.length > 0 ? '；下方保留上次读取的记录。' : ''}</span><Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>重新读取</Button></div>}
    {lastSuccessAt && <p className="text-xs text-muted-foreground">上次成功读取：{lastSuccessAt}{error ? ' · 当前显示此时的记录快照，操作已锁定。' : ''}</p>}
    {activity && <p className="text-sm text-muted-foreground">已保存 {activity.progress.processed} 次会话处理进度 · {activity.progress.baseline_complete ? '最近一轮扫描完成' : '尚未完成全部扫描，已保存进度可恢复'} · 已发送 {activity.counts.SENT_CONFIRMED || 0} · 待你决定 {activity.counts.REVIEW_REQUIRED || 0}</p>}
    {view !== 'legacy' && <form onSubmit={event => { event.preventDefault(); applyFilters() }} className="flex flex-wrap items-end gap-3">
      <label className="min-w-48 flex-1 space-y-1 text-sm"><span>搜索会话</span><Input maxLength={200} value={selected.draft.q} onChange={event => updateDraft({ q: event.target.value })} placeholder="公司、HR、岗位或消息内容" /></label>
      <label className="space-y-1 text-sm"><span>记录状态</span><select aria-label="记录状态" className="block h-10 rounded-lg border bg-background px-3" value={selected.draft.status} onChange={event => updateDraft({ status: event.target.value })}><option value="ALL">全部状态</option>{Object.entries(labels).filter(([value]) => view !== 'pending' || attention.has(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>每页条数</span><select aria-label="每页条数" className="block h-10 rounded-lg border bg-background px-3" value={selected.draft.size} onChange={event => updateDraft({ size: Number(event.target.value) })}>{[10, 25, 50].map(value => <option key={value} value={value}>{value} 条</option>)}</select></label>
      <Button type="submit" disabled={loading || (!criteriaChanged && currentPage === 1)}>应用筛选</Button>
      <Button type="button" variant="outline" onClick={resetFilters} disabled={loading || (!criteriaChanged && !q && status === 'ALL' && size === 10 && currentPage === 1)}>重置筛选</Button>
      {criteriaChanged && <span role="status" className="w-full text-xs text-muted-foreground">筛选有修改，点击应用后更新结果。</span>}
      {!loading && !error && snapshot && <span className="pb-2 text-sm text-muted-foreground">共 {snapshot.total} 条</span>}
    </form>}
    {!loading && !error && rows.length === 0 && <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{q || status !== 'ALL' ? '没有符合筛选的会话。' : view === 'pending' ? '当前没有需要你处理的会话。' : '暂无回复记录。开始值班后在这里查看实际发送结果。'}</div>}
    <div className={view === 'legacy' ? 'max-h-[32rem] space-y-3 overflow-y-auto' : 'space-y-3'}>{rows.map(row => <Reply key={`${profileId}:${row.id}`} row={row} decision={activity?.decisions.find(d => d.proposalId === row.id)} expanded={view === 'pending'} locked={loading || Boolean(error)} busy={busyIds.has(row.id)} onBusyChange={busy => setBusyIds(current => { const next = new Set(current); if (busy) next.add(row.id); else next.delete(row.id); return next })} edit={drafts[row.id] ?? null} onEdit={value => setDrafts(current => { const next = { ...current }; if (value === null || value === row.draft) delete next[row.id]; else next[row.id] = value; return next })} onSaved={() => setRevision(value => value + 1)} />)}</div>
    {view !== 'legacy' && snapshot && pages > 1 && <div className="flex items-center justify-end gap-3 text-sm"><Button variant="outline" size="sm" disabled={loading || Boolean(error) || currentPage === 1} onClick={() => changePage(currentPage - 1)}>上一页</Button><span>第 {currentPage} / {pages} 页</span><Button variant="outline" size="sm" disabled={loading || Boolean(error) || currentPage === pages} onClick={() => changePage(currentPage + 1)}>下一页</Button></div>}
  </>
  return view === 'legacy' ? <details className="space-y-3 rounded-xl border bg-card p-4 text-foreground"><summary className="cursor-pointer font-semibold">回复记录 <span className="ml-2 text-sm font-normal text-muted-foreground">{loading ? '正在读取…' : error ? '读取失败' : `${rows.length} 条 · 已发送 ${activity?.counts.SENT_CONFIRMED || 0} · 待你决定 ${activity?.counts.REVIEW_REQUIRED || 0} · 点击展开`}</span></summary>{contents}</details>
    : <section className="space-y-4" aria-label={view === 'pending' ? '待我处理的 HR 会话' : 'HR 回复历史'}>{contents}</section>
}

function Reply({ row, decision, expanded = false, locked, busy, onBusyChange, onSaved, edit, onEdit }: { row: Proposal; decision?: { reason: string; origin: string }; expanded?: boolean; locked: boolean; busy: boolean; onBusyChange: (busy: boolean) => void; onSaved: () => void; edit: string | null; onEdit: (value: string | null) => void }) {
  const [message, setMessage] = useState('')
  async function action(operation: string) {
    if (busy || locked) return
    onBusyChange(true); setMessage('')
    try {
      const response = await localActionFetch(`${API_BASE}/api/hr-assistant/proposals/${row.id}/${operation}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: row.version, draft: edit ?? row.draft }),
      })
      await readApiResponse(response, '操作未完成')
      onEdit(null); setMessage(operation === 'send' ? '已排队，等待 BOSS 标签执行；尚未确认发出。' : '已保存，记录即将刷新。'); onSaved()
    } catch (e) { setMessage(friendlyApiError(e, '操作未完成')) }
    finally { onBusyChange(false) }
  }
  return <details open={expanded || undefined} className="rounded-xl border bg-card p-4">
    <summary className="cursor-pointer text-sm font-medium">{row.companyName} / {row.hrName} · {labels[row.status] || row.status}{decision?.origin === 'BACKLOG' ? ' · 历史待办' : ''}</summary>
    <p className="my-3 whitespace-pre-wrap text-sm">HR：{row.sourceMessage}</p>
    <p className="my-2 text-sm text-muted-foreground">处理依据：{decision?.reason || '等待判断'}</p>
    {row.status === 'SEND_UNKNOWN' && <p className="my-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">发送结果未知，请先核对实际聊天回执；此处不提供重新发送。</p>}
    {row.status === 'REVIEW_REQUIRED' ? <>
      <Textarea aria-label={`回复 ${row.hrName}`} disabled={busy} value={edit ?? row.draft} onChange={e => onEdit(e.target.value)} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy || locked || edit === null || !edit.trim()} onClick={() => void action('revise')}>保存修改</Button>
        <Button type="button" disabled={busy || locked || edit !== null || !row.draft.trim()} onClick={() => void action('send')}>确认发送</Button>
        <Button type="button" variant="outline" disabled={busy || locked} onClick={() => void action('skip')}>跳过</Button>
      </div>
      {edit !== null && <p className="mt-2 text-xs text-muted-foreground">先保存修改，再确认发送。</p>}
    </> : <p className="whitespace-pre-wrap text-sm">回复：{row.draft || '无'}</p>}
    <p role="status" className="mt-2 text-sm">{message}</p>
  </details>
}
