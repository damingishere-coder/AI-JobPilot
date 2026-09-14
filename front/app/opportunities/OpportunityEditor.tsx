'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { applicationStatuses, eventLabel, eventSourceLabel, jobDescription, localDateTimeInput, opportunityApi, stages, type OpportunityDetail, type OpportunityEvent } from '@/lib/opportunities'
import FeedbackSection from './FeedbackSection'
import OpportunityInterviews from '../interviews/OpportunityInterviews'
import { interviewEventSummary } from '@/lib/interviews'

export default function OpportunityEditor({ detail, onSaved, onClose }: { detail: OpportunityDetail; onSaved: () => void; onClose: () => void }) {
  const [stage, setStage] = useState(detail.stage)
  const [interest, setInterest] = useState(detail.interest)
  const [note, setNote] = useState(detail.note)
  const [nextAction, setNextAction] = useState(detail.nextAction)
  const [followUp, setFollowUp] = useState(localDateTimeInput(detail.follow_up_at))
  const [correction, setCorrection] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Keep a failed command's identity for an uncertain network response; changed content gets a new identity.
  const [pending, setPending] = useState<{ body: string; key: string } | null>(null)
  const [events, setEvents] = useState(detail.events)
  const [hasOlder, setHasOlder] = useState(detail.events.length >= 200)
  const lastObservation = events.reduce((latest, event) => event.type === 'HR_INBOUND_OBSERVED' ? Math.max(latest, event.id) : latest, 0)
  async function save(archived?: boolean) {
    if (followUp && !Number.isFinite(new Date(followUp).getTime())) { setError('请填写有效跟进时间'); return }
    const value = { version: detail.version, stage, interest, note, nextAction, followUpAt: followUp ? new Date(followUp).toISOString() : '', archived, correctionOf: correction ? Number(correction) : null, reason }
    const body = JSON.stringify(value)
    const command = pending?.body === body ? pending : { body, key: crypto.randomUUID() }
    setPending(command); setBusy(true); setError('')
    try { await opportunityApi(`/${detail.id}`, { ...value, eventKey: command.key }); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败，请刷新后核对') }
    finally { setBusy(false) }
  }
  async function reviewMessages() {
    setBusy(true); setError('')
    try { await opportunityApi(`/${detail.id}/review-observations`, { version: detail.version, throughEventId: lastObservation }); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败，请刷新核对') }
    finally { setBusy(false) }
  }
  async function loadOlder() {
    setBusy(true); setError('')
    try {
      const before = events[events.length - 1]?.id
      const result = await opportunityApi<{ items: OpportunityEvent[]; hasMore: boolean }>(`/${detail.id}/events?before=${before}`)
      setEvents(current => [...current, ...result.items]); setHasOlder(result.hasMore)
    } catch (e) { setError(e instanceof Error ? e.message : '历史加载失败') }
    finally { setBusy(false) }
  }
  return <section className="space-y-4 rounded-xl border bg-card p-5" aria-label="机会详情">
    <div className="flex justify-between gap-3"><h2 className="text-xl font-semibold">{detail.job_name || '历史岗位'} · {detail.company_name || '公司未知'}</h2><Button variant="outline" onClick={onClose}>关闭</Button></div>
    <div className="grid gap-4 md:grid-cols-2">
      <label>求职阶段<select className="mt-1 block w-full rounded border bg-background p-2" value={stage} onChange={e => setStage(e.target.value)}>{Object.entries(stages).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <label>个人兴趣<select className="mt-1 block w-full rounded border bg-background p-2" value={interest} onChange={e => setInterest(e.target.value)}><option value="UNDECIDED">未表态</option><option value="INTERESTED">感兴趣</option><option value="NOT_INTERESTED">不感兴趣</option></select></label>
      <label>备注<textarea className="mt-1 block w-full rounded border bg-background p-2" maxLength={4000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <label>下一步事项<textarea className="mt-1 block w-full rounded border bg-background p-2" maxLength={500} value={nextAction} onChange={e => setNextAction(e.target.value)} /></label>
      <label>跟进时间（本机时区）<input type="datetime-local" className="mt-1 block w-full rounded border bg-background p-2" value={followUp} onChange={e => setFollowUp(e.target.value)} /></label>
    </div>
    <details><summary className="cursor-pointer text-sm">更正已有结果或回退阶段</summary><div className="mt-2 space-y-2">
      <label>选择要更正的事件<select className="ml-2 rounded border bg-background p-2" value={correction} onChange={e => setCorrection(e.target.value)}><option value="">不更正</option>{events.map(e => <option key={e.id} value={e.id}>#{e.id} {eventLabel(e.type)}</option>)}</select></label>
      <label className="block">更正原因<input className="ml-2 rounded border bg-background p-2" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
    </div></details>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => save()}>保存记录</Button><Button variant="outline" disabled={busy} onClick={() => save(!detail.archived)}>{detail.archived ? '恢复到当前列表' : '归档此机会'}</Button>{['boss', 'zhilian'].includes(detail.platform) && <Link className="p-2 text-sm underline" href={`/${detail.platform}/analysis`}>原平台分析与投递对账</Link>}</div>
    <FeedbackSection detail={detail} onSaved={onSaved} />
    <OpportunityInterviews opportunityId={detail.id} version={detail.version} onSaved={onSaved} />
    {lastObservation > 0 && <div className="space-y-2"><Button variant="outline" disabled={busy} onClick={reviewMessages}>已查看这些 HR 消息提醒</Button><p className="text-xs text-muted-foreground">只清除已加载消息的待核实提醒，不会确认回复、Offer 或其他结果；新消息仍会再次提醒。</p></div>}
    <details><summary className="cursor-pointer">JD 与 AI 分析</summary><p className="my-3 whitespace-pre-wrap text-sm">{jobDescription(detail.job_snapshot)}</p>{detail.analyses.map(a => <p key={a.id} className="mb-2 text-sm">分析 #{a.id} · {a.score} 分 · {a.decision} · 分析简历 {a.resume_version_id ? `v${a.resume_version_id}` : '版本未知'}<br />{a.summary}</p>)}</details>
    <div><h3 className="font-medium">投递记录</h3>{detail.applications.length === 0 && <p className="text-sm text-muted-foreground">尚无投递请求</p>}{detail.applications.map(a => <p key={a.id} className="mt-1 text-sm">#{a.id} · {applicationStatuses[a.state]} · {a.evidence || '无结果证据'}</p>)}</div>
    <details open><summary className="cursor-pointer font-medium">时间线（已加载 {events.length} 条）</summary><ol className="mt-2 space-y-2">{events.map(e => <li key={e.id} className="border-l-2 pl-3 text-sm"><span>#{e.id} · {eventLabel(e.type)} · {eventSourceLabel(e.source)}</span><br /><span className="text-muted-foreground">{e.occurred_at || `发生时间未知；记录于 ${e.observed_at}`}</span>{e.type.startsWith('INTERVIEW_') && <p>{interviewEventSummary(e.payload)}</p>}{e.reason && <p>{e.type === 'CORRECTION' ? '更正原因' : '备注'}：{e.reason}</p>}</li>)}</ol>{hasOlder && <Button variant="outline" disabled={busy} onClick={loadOlder}>加载更早记录</Button>}</details>
  </section>
}
