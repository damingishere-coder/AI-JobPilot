'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { BiCalendar } from 'react-icons/bi'
import ProfileSwitcher from '@/app/components/ProfileSwitcher'
import PageHeader from '@/app/components/PageHeader'
import { Button } from '@/components/ui/button'
import { interviewModes, interviewPreparation, interviewStatuses, interviewTime, interviewViews, loadInterviews, type Interview } from '@/lib/interviews'
import { opportunityApi, platformLabels, type Opportunity, type OpportunityDetail } from '@/lib/opportunities'
import { confirmNavigation } from '@/lib/use-unsaved-changes'
import InterviewForm from './InterviewForm'

export default function InterviewsPage() {
  return <Suspense fallback={<p role="status">正在读取面试…</p>}><InterviewWorkspace /></Suspense>
}
function InterviewWorkspace() {
  const params = useSearchParams()
  const view = Object.hasOwn(interviewViews, params.get('view') || '') ? params.get('view')! : 'UPCOMING'
  const page = Math.max(1, Math.min(10001, Number(params.get('page')) || 1))
  const q = params.get('q') || ''
  const [profileId, setProfileId] = useState<number | null>(null)
  const active = useRef<number | null>(null)
  const [items, setItems] = useState<Interview[] | null>(null)
  const [total, setTotal] = useState(0)
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState<Interview | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selected, setSelected] = useState<(OpportunityDetail & { nextRound: number }) | null>(null)
  const [choices, setChoices] = useState<Opportunity[]>([])
  const [choiceTotal, setChoiceTotal] = useState<number | null>(null)
  const [choicePage, setChoicePage] = useState(1)
  const [choiceSearch, setChoiceSearch] = useState('')
  const [choiceLoading, setChoiceLoading] = useState(false)
  const [choiceError, setChoiceError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(q)
  const [observedAt, setObservedAt] = useState(0)
  const editorSessionRef = useRef(0)
  const [editorSession, setEditorSession] = useState(0)
  const panel = useRef<HTMLElement>(null)
  const editingId = editing?.id
  const profileChanged = useCallback((profile: { id: number } | null) => { active.current = profile?.id ?? null; setProfileId(active.current); setItems(null); setEditing(null); setPickerOpen(false); setSelected(null); setEditorSession(++editorSessionRef.current) }, [])
  useEffect(() => {
    if (!profileId) return
    const controller = new AbortController()
    setLoading(true)
    loadInterviews(undefined, page, 20, controller.signal, view, q).then(result => {
      if (controller.signal.aborted) return
      if (result.profileId !== profileId) throw new Error('档案已在其他窗口改变，请刷新档案列表')
      setItems(result.items); setTotal(result.total); setError(''); setObservedAt(Date.now())
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [profileId, page, revision, view, q])
  useEffect(() => {
    if (!pickerOpen || selected || !profileId) return
    const controller = new AbortController()
    setChoiceLoading(true); setChoiceError(''); setChoiceTotal(null)
    const timer = window.setTimeout(() => {
      opportunityApi<{ items: Opportunity[]; total: number }>(`?archived=false&page=${choicePage}&size=20&q=${encodeURIComponent(choiceSearch)}`, undefined, controller.signal)
        .then(result => { if (!controller.signal.aborted) { setChoices(result.items); setChoiceTotal(result.total) } })
        .catch(e => { if (!controller.signal.aborted) setChoiceError(e.message) })
        .finally(() => { if (!controller.signal.aborted) setChoiceLoading(false) })
    }, 200)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [pickerOpen, selected, profileId, choicePage, choiceSearch])
  function closeEditor() { if (confirmNavigation()) { setEditorSession(++editorSessionRef.current); setEditing(null); setPickerOpen(false); setSelected(null) } }
  useEffect(() => {
    if (!pickerOpen && !editingId) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; panel.current?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && confirmNavigation()) { setEditorSession(++editorSessionRef.current); setEditing(null); setPickerOpen(false); setSelected(null) }
      if (event.key !== 'Tab') return
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]') || [])
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', keyboard)
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', keyboard); previous?.focus() }
  }, [pickerOpen, editingId])
  function navigate(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    Object.entries(changes).forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key) })
    window.history.pushState(null, '', `/interviews${next.size ? `?${next}` : ''}`)
  }
  async function chooseOpportunity(id: number) {
    const owner = active.current; const ownerSession = editorSessionRef.current
    const current = () => active.current === owner && editorSessionRef.current === ownerSession
    setChoiceLoading(true); setChoiceError('')
    try {
      const [detail, rounds] = await Promise.all([opportunityApi<OpportunityDetail>(`/${id}`), loadInterviews(id, 1, 100)])
      if (!current()) return
      const nextRound = Array.from({ length: 100 }, (_, i) => i + 1).find(round => !rounds.items.some(item => item.round_number === round))
      if (!nextRound) throw new Error('该机会已有 100 轮面试，请修改已有记录')
      setSelected({ ...detail, nextRound })
    } catch (e) { if (current()) setChoiceError(e instanceof Error ? e.message : '机会读取失败') }
    finally { if (current()) setChoiceLoading(false) }
  }
  const saved = (ownerSession: number) => {
    if (editorSessionRef.current !== ownerSession) return
    setEditorSession(++editorSessionRef.current); setEditing(null); setPickerOpen(false); setSelected(null); setRevision(value => value + 1)
  }
  const countLabel = loading ? '数量读取中…' : error ? '数量未知' : `${total} 轮面试`
  return <section className="space-y-5">
    <PageHeader title="面试与准备" subtitle="安排每一轮，准备下一场，核实已经过去的面试" icon={<BiCalendar />} actions={<><Button onClick={() => { if (!confirmNavigation()) return; setEditorSession(++editorSessionRef.current); setChoicePage(1); setChoiceSearch(''); setChoices([]); setChoiceTotal(null); setChoiceError(''); setEditing(null); setSelected(null); setPickerOpen(true) }}>新增面试轮次</Button><Button variant="outline" onClick={() => setRevision(value => value + 1)}>刷新面试</Button></>} />
    <ProfileSwitcher onProfileChange={profileChanged} />
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <nav className="flex flex-wrap gap-2" aria-label="面试视图">{Object.entries(interviewViews).map(([key, label]) => <Button key={key} size="sm" variant={view === key ? 'default' : 'outline'} onClick={() => navigate({ view: key, page: null })}>{label}</Button>)}</nav>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); navigate({ q: search.trim() || null, page: null }) }}><label className="min-w-48 flex-1 text-sm">搜索岗位或公司<input value={search} maxLength={200} onChange={event => setSearch(event.target.value)} className="mt-1 block w-full rounded-md border bg-background px-3 py-2" placeholder="输入岗位或公司名称" /></label><Button type="submit" variant="outline">搜索</Button>{items && <span className="pb-2 text-sm text-muted-foreground">{countLabel}</span>}</form>
    </div>
    {error && <div role="alert" className="rounded border border-destructive/30 p-4 text-destructive">{error}<Button className="ml-3" variant="outline" onClick={() => setRevision(value => value + 1)}>重试</Button></div>}
    {error && items && observedAt > 0 && <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">上次成功读取：{new Date(observedAt).toLocaleString('zh-CN')}。以下为旧结果，可能不符合当前筛选。</p>}
    {loading && <p role="status" className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">正在读取面试记录…</p>}
    {!loading && !error && items?.length === 0 && <div className="rounded-xl border bg-card p-8 text-center"><p className="font-medium">此视图暂无面试记录</p><p className="mt-2 text-sm text-muted-foreground">可以切换“全部面试”，或选择已有求职机会新增轮次。</p></div>}
    {!loading && items?.map(item => <article key={item.id} className="space-y-3 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{item.job_name || '历史岗位'} · 第 {item.round_number} 轮</h2><p className="mt-1 text-sm text-muted-foreground">{item.company_name} · {interviewModes[item.mode]} · {interviewStatuses[item.status]}</p></div><Button variant="outline" onClick={() => { if (confirmNavigation()) { setEditorSession(++editorSessionRef.current); setEditing(item); setPickerOpen(false); setSelected(null) } }}>编辑第 {item.round_number} 轮</Button></div>
      <p className="text-sm">{interviewTime(item)}</p>
      {item.status === 'SCHEDULED' && item.scheduled_at && new Date(item.scheduled_at).getTime() < observedAt && <p className="rounded bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">时间已过，请核实是否完成或需要改期。</p>}
      <div className="flex flex-wrap gap-2 text-xs">{Object.entries(interviewPreparation).map(([key, label]) => <span key={key} className={`rounded px-2 py-1 ${item.preparation.includes(key) ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200' : 'bg-muted text-muted-foreground'}`}>{item.preparation.includes(key) ? '✓ ' : '○ '}{label}</span>)}</div>
      <Link className="text-sm text-primary underline" href={`/opportunities?id=${item.opportunity_id}&tab=interviews`}>查看岗位与时间线{item.archived ? '（已归档）' : ''}</Link>
    </article>)}
    {items && !error && <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={loading || page === 1} onClick={() => navigate({ page: String(page - 1) })}>上一页</Button><span className="text-sm">{loading ? countLabel : `第 ${page} 页 · ${countLabel}`}</span><Button variant="outline" disabled={loading || page * 20 >= total} onClick={() => navigate({ page: String(page + 1) })}>下一页</Button></div>}
    <p className="text-xs text-muted-foreground">只有双方确认时间后才记为已安排。面试时间按记录时区显示，过期不会自动完成。</p>
    {(pickerOpen || editing) && <div className="fixed inset-0 z-[90] bg-black/30"><section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="interview-editor-title" className="absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto bg-background p-5 shadow-xl outline-none sm:p-6">
      <header className="mb-5 flex items-center justify-between gap-3"><h2 id="interview-editor-title" className="text-xl font-semibold">{editing ? '编辑面试' : selected ? '新增面试轮次' : '选择求职机会'}</h2><Button variant="outline" onClick={closeEditor}>关闭</Button></header>
      {editing ? <InterviewForm key={`${editing.id}:${editorSession}`} opportunityId={editing.opportunity_id} opportunityVersion={editing.opportunity_version} initial={editing} onSaved={() => saved(editorSession)} onClose={closeEditor} /> : selected ? <><p className="mb-4 text-sm text-muted-foreground">{selected.job_name} · {selected.company_name}</p><InterviewForm key={`${selected.id}:${editorSession}`} opportunityId={selected.id} opportunityVersion={selected.version} nextRound={selected.nextRound} onSaved={() => saved(editorSession)} onClose={closeEditor} /></> : <>
        <label className="block text-sm">搜索已有机会<input autoFocus value={choiceSearch} maxLength={200} onChange={event => { setChoiceSearch(event.target.value); setChoicePage(1) }} className="mt-1 block w-full rounded border bg-background px-3 py-2" placeholder="岗位或公司名称" /></label>
        {choiceLoading && <p role="status" className="mt-4 text-sm">正在读取机会…</p>}
        {choiceError && <p role="alert" className="mt-4 text-sm text-destructive">{choiceError}</p>}
        <div className="my-4 space-y-2">{choices.map(choice => <button type="button" key={choice.id} disabled={choiceLoading} className="block w-full rounded-xl border bg-card p-4 text-left hover:bg-muted" onClick={() => void chooseOpportunity(choice.id)}><p className="font-medium">{choice.job_name || '历史岗位'}</p><p className="mt-1 text-sm text-muted-foreground">{choice.company_name || '公司未知'} · {platformLabels[choice.platform]}</p></button>)}{choiceTotal !== null && !choiceLoading && !choiceError && choices.length === 0 && <p className="rounded border p-4 text-sm text-muted-foreground">没有符合搜索的机会，请调整关键词或先发现岗位。</p>}</div>
        <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={choiceLoading || choiceTotal === null || choicePage <= 1} onClick={() => setChoicePage(value => value - 1)}>上一页机会</Button><span className="text-sm">{choiceError ? '数量未知' : choiceLoading || choiceTotal === null ? '数量读取中…' : `${choiceTotal} 个机会`}</span><Button variant="outline" disabled={choiceLoading || choiceTotal === null || choicePage * 20 >= choiceTotal} onClick={() => setChoicePage(value => value + 1)}>下一页机会</Button></div>
      </>}
    </section></div>}
  </section>
}
