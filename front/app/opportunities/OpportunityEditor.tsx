'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { applicationStatuses, eventLabel, eventSourceLabel, jobDescription, localDateTimeInput, opportunityApi, platformLabels, stages, type OpportunityDetail, type OpportunityEvent } from '@/lib/opportunities'
import { useUnsavedChanges } from '@/lib/use-unsaved-changes'
import FeedbackSection from './FeedbackSection'
import OpportunityInterviews from '../interviews/OpportunityInterviews'
import { interviewEventSummary } from '@/lib/interviews'

export type OpportunityTab = 'overview' | 'feedback' | 'interviews' | 'records'
const tabs: Record<OpportunityTab, string> = { overview: '概览', feedback: '沟通与反馈', interviews: '面试', records: '投递与记录' }
type Draft = { stage: string; interest: string; note: string; nextAction: string; followUp: string }

export default function OpportunityEditor({ detail, onSaved, onClose, initialTab = 'overview' }: {
  detail: OpportunityDetail; onSaved: () => void | Promise<void>; onClose: () => void; initialTab?: OpportunityTab;
}) {
  const [tab, setTab] = useState<OpportunityTab>(initialTab)
  const [draft, setDraft] = useState<Partial<Draft>>({})
  const [busy, setBusy] = useState(false)
  const base: Draft = { stage: detail.stage, interest: detail.interest, note: detail.note, nextAction: detail.nextAction, followUp: localDateTimeInput(detail.follow_up_at) }
  const value = { ...base, ...draft }
  const dirty = Object.entries(draft).some(([key, content]) => base[key as keyof Draft] !== content)
  useUnsavedChanges(`opportunity:${detail.id}:overview`, dirty || busy)
  const change = (key: keyof Draft, content: string) => setDraft(current => ({ ...current, [key]: content }))
  const [correction, setCorrection] = useState('')
  const [reason, setReason] = useState('')
  useUnsavedChanges(`opportunity:${detail.id}:correction`, Boolean(correction || reason))
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [pending, setPending] = useState<{ body: string; key: string } | null>(null)
  const [olderEvents, setOlderEvents] = useState<OpportunityEvent[]>([])
  const [hasOlder, setHasOlder] = useState(detail.events.length >= 200)
  const events = [...detail.events, ...olderEvents.filter(older => !detail.events.some(event => event.id === older.id))]
  const lastObservation = events.reduce((latest, event) => event.type === 'HR_INBOUND_OBSERVED' ? Math.max(latest, event.id) : latest, 0)
  async function save(archived?: boolean) {
    if (value.followUp && !Number.isFinite(new Date(value.followUp).getTime())) { setError('请填写有效跟进时间'); return }
    const request = { version: detail.version, stage: value.stage, interest: value.interest, note: value.note, nextAction: value.nextAction, followUpAt: value.followUp ? new Date(value.followUp).toISOString() : '', archived, correctionOf: correction ? Number(correction) : null, reason }
    const body = JSON.stringify(request)
    const command = pending?.body === body ? pending : { body, key: crypto.randomUUID() }
    setPending(command); setBusy(true); setError(''); setSaved('')
    try { await opportunityApi(`/${detail.id}`, { ...request, eventKey: command.key }); await onSaved(); setDraft({}); setCorrection(''); setReason(''); setPending(null); setSaved('记录已保存') }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败，请刷新后核对') }
    finally { setBusy(false) }
  }
  async function reviewMessages() {
    setBusy(true); setError('')
    try { await opportunityApi(`/${detail.id}/review-observations`, { version: detail.version, throughEventId: lastObservation }); await onSaved(); setSaved('消息提醒已标记为查看') }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败，请刷新核对') }
    finally { setBusy(false) }
  }
  async function loadOlder() {
    setBusy(true); setError('')
    try {
      const before = events[events.length - 1]?.id
      const result = await opportunityApi<{ items: OpportunityEvent[]; hasMore: boolean }>(`/${detail.id}/events?before=${before}`)
      setOlderEvents(current => [...current, ...result.items]); setHasOlder(result.hasMore)
    } catch (e) { setError(e instanceof Error ? e.message : '历史加载失败') }
    finally { setBusy(false) }
  }
  let snapshot: { salary?: string; location?: string } = {}
  try { snapshot = JSON.parse(detail.job_snapshot) } catch { /* Unknown historical metadata stays unknown. */ }
  return <section className="flex min-h-0 flex-col rounded-xl border bg-card" aria-label="机会详情">
    <header className="space-y-3 border-b p-5">
      <div className="flex items-start justify-between gap-3"><div><p className="mb-1 text-xs text-muted-foreground">{platformLabels[detail.platform] || detail.platform} · {detail.archived ? '已归档' : '当前机会'}</p><h2 className="text-xl font-semibold">{detail.job_name || '历史岗位'} · {detail.company_name || '公司未知'}</h2></div><Button variant="outline" onClick={onClose}>关闭</Button></div>
      <p className="text-sm text-muted-foreground">{snapshot.location || '地点待核实'} · {snapshot.salary || '薪资待核实'}</p>
      <div className="flex flex-wrap gap-2 text-sm"><span className="rounded bg-muted px-2 py-1">阶段：{stages[detail.stage]}</span><span className="rounded bg-muted px-2 py-1">投递：{applicationStatuses[detail.application_status || detail.applications[0]?.state || 'NOT_REQUESTED']}</span></div>
      <div role="tablist" aria-label="机会详情功能" className="flex flex-wrap gap-1">{Object.entries(tabs).map(([key, label], index) => <button key={key} type="button" id={`opportunity-tab-${key}`} role="tab" tabIndex={tab === key ? 0 : -1} aria-selected={tab === key} aria-controls={`opportunity-panel-${key}`} className={`rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} onClick={() => setTab(key as OpportunityTab)} onKeyDown={event => {
        const keys = Object.keys(tabs) as OpportunityTab[]
        const next = event.key === 'ArrowRight' ? (index + 1) % keys.length : event.key === 'ArrowLeft' ? (index + keys.length - 1) % keys.length : event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : -1
        if (next >= 0) { event.preventDefault(); setTab(keys[next]); document.getElementById(`opportunity-tab-${keys[next]}`)?.focus() }
      }}>{label}</button>)}</div>
    </header>
    <div className="space-y-4 p-5">
      {error && <p role="alert" className="rounded border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
      {saved && <p role="status" className="text-sm text-emerald-600">{saved}</p>}
      <section id="opportunity-panel-overview" role="tabpanel" aria-labelledby="opportunity-tab-overview" hidden={tab !== 'overview'} className="space-y-5">
        <fieldset disabled={busy} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label>求职阶段<select className="mt-1 block w-full rounded border bg-background p-2" value={value.stage} onChange={e => change('stage', e.target.value)}>{Object.entries(stages).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
          <label>个人兴趣<select className="mt-1 block w-full rounded border bg-background p-2" value={value.interest} onChange={e => change('interest', e.target.value)}><option value="UNDECIDED">未表态</option><option value="INTERESTED">感兴趣</option><option value="NOT_INTERESTED">不感兴趣</option></select></label>
          <label>备注<textarea className="mt-1 block w-full rounded border bg-background p-2" maxLength={4000} value={value.note} onChange={e => change('note', e.target.value)} /></label>
          <label>下一步事项<textarea className="mt-1 block w-full rounded border bg-background p-2" maxLength={500} value={value.nextAction} onChange={e => change('nextAction', e.target.value)} /></label>
          <label>跟进时间（本机时区）<input type="datetime-local" className="mt-1 block w-full rounded border bg-background p-2" value={value.followUp} onChange={e => change('followUp', e.target.value)} /></label>
        </div>
        <p className="text-xs text-muted-foreground">阶段是你的进度记录。收到回复、面试邀请或 Offer，请在“沟通与反馈”记录发生时间和投递归属，供策略复盘使用。</p>
        <details><summary className="cursor-pointer text-sm">更正已有结果或回退阶段</summary><div className="mt-2 space-y-2"><label>选择要更正的事件<select className="ml-2 rounded border bg-background p-2" value={correction} onChange={e => setCorrection(e.target.value)}><option value="">不更正</option>{events.map(e => <option key={e.id} value={e.id}>#{e.id} {eventLabel(e.type)}</option>)}</select></label><label className="block">更正原因<input className="ml-2 rounded border bg-background p-2" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label></div></details>
        <div className="flex flex-wrap items-center gap-2"><Button disabled={busy} onClick={() => save()}>保存记录</Button><Button variant="outline" disabled={busy} onClick={() => save(!detail.archived)}>{detail.archived ? '恢复到当前列表' : '归档此机会'}</Button>{dirty && <span className="text-xs text-amber-600">有未保存更改</span>}</div>
        </fieldset>
        <details open><summary className="cursor-pointer font-medium">JD 与 AI 分析</summary><p className="my-3 whitespace-pre-wrap text-sm">{jobDescription(detail.job_snapshot)}</p>{detail.analyses.map(a => <article key={a.id} className="mb-3 rounded border p-3 text-sm"><p>分析 #{a.id} · {a.score} 分 · {a.decision} · 分析简历 {a.resume_version_id ? `v${a.resume_version_id}` : '版本未知'}</p><p className="mt-2 whitespace-pre-wrap">{a.summary}</p></article>)}</details>
      </section>
      <section id="opportunity-panel-feedback" role="tabpanel" aria-labelledby="opportunity-tab-feedback" hidden={tab !== 'feedback'} className="space-y-4">
        {lastObservation > 0 && <div className="rounded border bg-muted/40 p-3"><Button variant="outline" disabled={busy} onClick={reviewMessages}>已查看这些 HR 消息提醒</Button><p className="mt-2 text-xs text-muted-foreground">只清除已加载消息的待核实提醒；新消息仍会再次提醒。确认真实结果请使用下方反馈表单。</p></div>}
        <FeedbackSection detail={detail} onSaved={onSaved} />
      </section>
      <section id="opportunity-panel-interviews" role="tabpanel" aria-labelledby="opportunity-tab-interviews" hidden={tab !== 'interviews'}><OpportunityInterviews opportunityId={detail.id} version={detail.version} onSaved={onSaved} /></section>
      <section id="opportunity-panel-records" role="tabpanel" aria-labelledby="opportunity-tab-records" hidden={tab !== 'records'} className="space-y-5">
        {['boss', 'zhilian'].includes(detail.platform) && <Button asChild variant="outline"><Link href={`/${detail.platform}/analysis`}>原平台分析与投递对账</Link></Button>}
        <div><h3 className="font-medium">投递记录</h3>{detail.applications.length === 0 && <p className="mt-2 text-sm text-muted-foreground">尚无投递请求</p>}{detail.applications.map(a => <div key={a.id} className="mt-2 rounded border p-3 text-sm"><p>#{a.id} · {applicationStatuses[a.state]}</p><p className="mt-1 text-muted-foreground">{a.evidence || '无结果证据'}</p></div>)}</div>
        <details><summary className="cursor-pointer font-medium">时间线（已加载 {events.length} 条）</summary><ol className="mt-3 space-y-3">{events.map(e => <li key={e.id} className="border-l-2 pl-3 text-sm"><p>#{e.id} · {eventLabel(e.type)} · {eventSourceLabel(e.source)}</p><p className="text-muted-foreground">{e.occurred_at || `发生时间未知；记录于 ${e.observed_at}`}</p>{e.type.startsWith('INTERVIEW_') && <p>{interviewEventSummary(e.payload)}</p>}{e.reason && <p>{e.type === 'CORRECTION' ? '更正原因' : '备注'}：{e.reason}</p>}</li>)}</ol>{hasOlder && <Button className="mt-3" variant="outline" disabled={busy} onClick={loadOlder}>加载更早记录</Button>}</details>
      </section>
    </div>
  </section>
}
