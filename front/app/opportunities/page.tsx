'use client'

import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import ProfileSwitcher from '@/app/components/ProfileSwitcher'
import PageHeader from '@/app/components/PageHeader'
import { BiBriefcase } from 'react-icons/bi'
import { Button } from '@/components/ui/button'
import { opportunityApi, opportunityInterviewTime, opportunityTaskTab, platformLabels, stages, applicationStatuses, type Opportunity, type OpportunityDetail } from '@/lib/opportunities'
import { confirmNavigation } from '@/lib/use-unsaved-changes'
import OpportunityEditor, { type OpportunityTab } from './OpportunityEditor'
import RankingWorkspace from '../strategy/ranking/RankingWorkspace'

type OpportunityList = { items: Opportunity[]; total: number; scopeLabel?: string; profileId?: number }
function watchWideScreen(listener: () => void) {
  const media = window.matchMedia?.('(min-width: 1280px)')
  media?.addEventListener('change', listener)
  return () => media?.removeEventListener('change', listener)
}
function wideScreen() { return Boolean(window.matchMedia?.('(min-width: 1280px)').matches) }
export default function OpportunitiesPage() {
  return <Suspense fallback={<p className="p-6" role="status">正在加载机会…</p>}><OpportunityWorkspace /></Suspense>
}
function OpportunityWorkspace() {
  const params = useSearchParams()
  const selectedId = Number(params.get('id')) || null
  const archived = params.get('archived') === 'true'
  const stage = params.get('stage') || ''
  const bucket = params.get('bucket') || ''
  const platform = params.get('platform') || ''
  const applicationStatus = params.get('applicationStatus') || ''
  const q = params.get('q') || ''
  const recommended = params.get('view') === 'recommended'
  const initialTab = (['overview', 'feedback', 'interviews', 'records'].includes(params.get('tab') || '') ? params.get('tab') : opportunityTaskTab(bucket)) as OpportunityTab
  const page = Math.max(1, Math.min(10001, Number(params.get('page')) || 1))
  const [profileId, setProfileId] = useState<number | null>(null)
  const [rows, setRows] = useState<Opportunity[]>([])
  const [total, setTotal] = useState(0)
  const [detail, setDetail] = useState<OpportunityDetail | null>(null)
  const [scopeLabel, setScopeLabel] = useState('')
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [observedAt, setObservedAt] = useState(0)
  const [detailLoading, setDetailLoading] = useState(false)
  const filterSource = JSON.stringify({ platform, stage, applicationStatus, q })
  const [filterDraft, setFilterDraft] = useState({ source: filterSource, values: { platform, stage, applicationStatus, q } })
  const filters = filterDraft.source === filterSource ? filterDraft.values : { platform, stage, applicationStatus, q }
  const changeFilter = (key: keyof typeof filters, value: string) => setFilterDraft({ source: filterSource, values: { ...filters, [key]: value } })
  const activeProfile = useRef<number | null>(null)
  const selectedIdRef = useRef(selectedId)
  const detailRequest = useRef(0)
  selectedIdRef.current = selectedId
  const panel = useRef<HTMLDivElement>(null)
  const isWide = useSyncExternalStore(watchWideScreen, wideScreen, () => false)
  const listQuery = `?archived=${archived}&stage=${encodeURIComponent(stage)}&page=${page}&bucket=${encodeURIComponent(bucket)}&platform=${encodeURIComponent(platform)}&q=${encodeURIComponent(q)}&applicationStatus=${encodeURIComponent(applicationStatus)}`
  const changeProfile = useCallback((profile: { id: number } | null) => {
    activeProfile.current = profile?.id ?? null; setProfileId(activeProfile.current); setRows([]); setDetail(null); setLoaded(false)
  }, [setProfileId, setRows, setDetail, setLoaded])
  useEffect(() => {
    if (!profileId || recommended) return
    const controller = new AbortController()
    // Loading belongs to this abortable query; existing detail drafts remain mounted.
    setLoading(true); setError('')
    opportunityApi<OpportunityList>(listQuery, undefined, controller.signal).then(list => {
      if (controller.signal.aborted) return
      if (list.profileId && list.profileId !== profileId) throw new Error('档案已在其他窗口改变，请刷新档案列表')
      setRows(list.items); setTotal(list.total); setScopeLabel(list.scopeLabel || ''); setLoaded(true); setObservedAt(Date.now())
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [profileId, recommended, listQuery, revision])
  useEffect(() => {
    if (!profileId || !selectedId) return
    const controller = new AbortController()
    const sequence = ++detailRequest.current
    const current = () => !controller.signal.aborted && sequence === detailRequest.current && selectedIdRef.current === selectedId
    setDetailLoading(true); setDetailError('')
    opportunityApi<OpportunityDetail>(`/${selectedId}`, undefined, controller.signal).then(selected => {
      if (current()) setDetail(selected)
    }).catch(e => { if (current()) setDetailError(e.message) })
      .finally(() => { if (current()) setDetailLoading(false) })
    return () => controller.abort()
  }, [profileId, selectedId])
  function navigate(changes: Record<string, string | null>) {
    if ((Object.hasOwn(changes, 'id') || Object.hasOwn(changes, 'view')) && !confirmNavigation()) return
    if (Object.hasOwn(changes, 'id')) {
      const nextId = Number(changes.id) || null
      if (nextId !== selectedIdRef.current) { selectedIdRef.current = nextId; ++detailRequest.current }
    }
    const next = new URLSearchParams(params.toString())
    Object.entries(changes).forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key) })
    window.history.pushState(null, '', `/opportunities${next.size ? `?${next}` : ''}`)
  }
  async function refreshDetail() {
    if (!selectedId) return
    const owner = activeProfile.current
    const sequence = ++detailRequest.current
    const current = () => activeProfile.current === owner && selectedIdRef.current === selectedId && detailRequest.current === sequence
    setDetailLoading(true)
    try {
      const selected = await opportunityApi<OpportunityDetail>(`/${selectedId}`)
      if (!current()) return
      setDetail(selected); setDetailError(''); setRevision(value => value + 1)
    } catch (cause) { if (current()) throw cause }
    finally { if (current()) setDetailLoading(false) }
  }
  useEffect(() => {
    if (!selectedId) return
    const previous = document.activeElement as HTMLElement | null
    const narrow = !isWide
    panel.current?.focus({ preventScroll: true })
    const overflow = document.body.style.overflow
    if (narrow) document.body.style.overflow = 'hidden'
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && confirmNavigation()) {
        selectedIdRef.current = null; ++detailRequest.current
        const next = new URLSearchParams(window.location.search); next.delete('id'); next.delete('tab')
        window.history.pushState(null, '', `/opportunities${next.size ? `?${next}` : ''}`)
      }
      if (!narrow || event.key !== 'Tab') return
      const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary') || []).filter(element => !element.closest('[hidden]') && element.tabIndex !== -1 && (!element.closest('details:not([open])') || element.tagName === 'SUMMARY'))
      const first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', keyboard)
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', keyboard); previous?.focus({ preventScroll: true }) }
  }, [selectedId, isWide])
  const activeDetail = selectedId && detail?.id === selectedId ? detail : null
  const countLabel = loading ? '数量读取中…' : error ? '数量未知' : loaded ? `${total} 个机会` : '数量读取中…'
  return <section className="space-y-5">
    <PageHeader title="求职机会" subtitle="选岗位、跟进回复，再推进面试与结果" icon={<BiBriefcase />} actions={<Button variant="outline" onClick={() => { setRevision(value => value + 1); if (selectedId) void refreshDetail().catch(e => setDetailError(e.message)) }}>刷新</Button>} />
    <ProfileSwitcher onProfileChange={changeProfile} />
    <nav className="flex flex-wrap gap-2" aria-label="机会视图">
      <Button variant={!recommended && !archived ? 'default' : 'outline'} onClick={() => navigate({ view: null, archived: null, page: null, bucket: null })}>当前机会</Button>
      <Button variant={recommended ? 'default' : 'outline'} onClick={() => navigate({ view: 'recommended', id: null, archived: null, page: null, bucket: null })}>推荐机会</Button>
      <Button variant={archived && !recommended ? 'default' : 'outline'} onClick={() => navigate({ view: null, archived: 'true', page: null, bucket: null })}>已归档</Button>
    </nav>
    {recommended ? <RankingWorkspace profileId={profileId} /> : <>
      <div className="rounded-xl border bg-card p-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); navigate({ platform: filters.platform || null, stage: filters.stage || null, applicationStatus: filters.applicationStatus || null, q: filters.q.trim() || null, page: null }) }}>
          <label className="min-w-48 flex-1 text-sm">搜索岗位或公司<input className="mt-1 block w-full rounded-md border bg-background px-3 py-2" maxLength={200} value={filters.q} onChange={event => changeFilter('q', event.target.value)} placeholder="输入岗位或公司名称" /></label>
          <label className="text-sm">平台<select className="mt-1 block rounded-md border bg-background p-2" value={filters.platform} onChange={event => changeFilter('platform', event.target.value)}><option value="">全部平台</option>{Object.entries(platformLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="text-sm">阶段<select aria-label="求职阶段筛选" className="mt-1 block rounded-md border bg-background p-2" value={filters.stage} onChange={event => changeFilter('stage', event.target.value)}><option value="">全部阶段</option>{Object.entries(stages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="text-sm">投递状态<select className="mt-1 block rounded-md border bg-background p-2" value={filters.applicationStatus} onChange={event => changeFilter('applicationStatus', event.target.value)}><option value="">全部状态</option>{Object.entries(applicationStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <Button type="submit">应用筛选</Button>
          <Button type="button" variant="outline" onClick={() => { setFilterDraft({ source: filterSource, values: { platform: '', stage: '', applicationStatus: '', q: '' } }); navigate({ platform: null, stage: null, applicationStatus: null, q: null, bucket: null, page: null }) }}>重置筛选</Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground"><span>当前档案 · {!loading && !error && scopeLabel ? scopeLabel : '当前筛选'} · {countLabel}</span>{bucket && <Button variant="outline" size="sm" onClick={() => navigate({ bucket: null, page: null })}>清除事项筛选</Button>}</div>
      </div>
      {error && <div role="alert" className="rounded border border-destructive/30 p-4 text-sm text-destructive">{error}<Button className="ml-3" variant="outline" onClick={() => setRevision(value => value + 1)}>重试读取</Button></div>}
      {error && loaded && observedAt > 0 && <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">上次成功读取：{new Date(observedAt).toLocaleString('zh-CN')}。以下为旧结果，可能不符合当前筛选。</p>}
      <div className={`grid items-start gap-5 ${activeDetail ? 'xl:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.4fr)]' : ''}`}>
        <div className="min-w-0 space-y-3">
          {loading && <p role="status" className="rounded border bg-card p-5 text-sm text-muted-foreground">正在加载机会…</p>}
          {!loading && !error && rows.length === 0 && <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">此范围暂无机会。可调整筛选，或前往 <Link className="underline" href="/boss">BOSS</Link> / <Link className="underline" href="/zhilian">智联</Link> 发现岗位。</p>}
          {!loading && rows.map(row => <button key={row.id} type="button" aria-pressed={selectedId === row.id} className={`w-full space-y-2 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedId === row.id ? 'border-primary ring-1 ring-primary' : ''}`} onClick={() => navigate({ id: String(row.id), tab: opportunityTaskTab(bucket) })}>
            <div className="flex items-start justify-between gap-3"><p className="font-semibold">{row.job_name || '历史岗位名称未知'}</p><span className="shrink-0 rounded bg-muted px-2 py-1 text-xs">{stages[row.stage]}</span></div>
            <p className="text-sm text-muted-foreground">{row.company_name || '公司未知'} · {platformLabels[row.platform] || row.platform}</p>
            <p className="text-sm">{row.salary || '薪资待核实'} · {row.location || '地点待核实'}{row.match_score != null ? ` · 匹配 ${row.match_score} 分` : ''}</p>
            <p className="text-xs text-muted-foreground">投递：{applicationStatuses[row.application_status || ''] || '状态未知，待核实'}</p>
            {row.task_summary && <p className="text-sm text-primary">{row.task_summary}</p>}
            {row.follow_up_at && <p className="text-xs text-muted-foreground">跟进时间：{new Date(row.follow_up_at).toLocaleString('zh-CN')}</p>}
            {row.interview_at && <p className="text-xs text-muted-foreground">第 {row.interview_round} 轮 · {opportunityInterviewTime(row)} · 准备 {row.interview_prepared ?? 0}/4 项</p>}
          </button>)}
          {loaded && !error && <div className="flex items-center justify-between gap-3 py-2"><Button variant="outline" disabled={loading || page <= 1} onClick={() => navigate({ page: String(page - 1) })}>上一页</Button><span className="text-sm">{loading ? '数量读取中…' : `第 ${page} 页`}</span><Button variant="outline" disabled={loading || page * 20 >= total} onClick={() => navigate({ page: String(page + 1) })}>下一页</Button></div>}
        </div>
        {selectedId && <div className="fixed inset-0 z-[80] bg-black/30 xl:static xl:z-auto xl:bg-transparent" onClick={event => { if (event.target === event.currentTarget) navigate({ id: null, tab: null }) }}><div ref={panel} tabIndex={-1} role={isWide ? undefined : 'dialog'} aria-modal={isWide ? undefined : true} aria-label="所选机会" className="h-full overflow-y-auto bg-background p-3 shadow-xl outline-none md:ml-auto md:w-[75vw] md:max-w-4xl md:p-5 xl:max-h-[calc(100vh-7rem)] xl:w-full xl:max-w-none xl:bg-transparent xl:p-0 xl:shadow-none">
          {detailLoading && !activeDetail && <div className="flex items-center justify-between gap-3 p-5"><p role="status">正在读取机会详情…</p><Button variant="outline" onClick={() => navigate({ id: null, tab: null })}>关闭</Button></div>}
          {detailError && <div role="alert" className="mb-3 rounded border border-destructive/30 p-4 text-destructive">{detailError}<Button variant="outline" className="ml-3" onClick={() => void refreshDetail().then(() => setDetailError('')).catch(e => setDetailError(e.message))}>重试</Button><Button variant="outline" className="ml-2" onClick={() => navigate({ id: null, tab: null })}>关闭</Button></div>}
          {activeDetail && <OpportunityEditor key={`${profileId}:${activeDetail.id}`} detail={activeDetail} initialTab={initialTab} onClose={() => navigate({ id: null, tab: null })} onSaved={refreshDetail} />}
        </div></div>}
      </div>
    </>}
  </section>
}
