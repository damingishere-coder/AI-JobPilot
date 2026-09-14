'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { applicationStatuses, jobDescription, opportunityApi, stages, type OpportunityDetail } from '@/lib/opportunities'

export default function OpportunityEditor({ detail, onSaved, onClose }: { detail: OpportunityDetail; onSaved: () => void; onClose: () => void }) {
  const [stage, setStage] = useState(detail.stage)
  const [interest, setInterest] = useState(detail.interest)
  const [note, setNote] = useState(detail.note)
  const [nextAction, setNextAction] = useState(detail.nextAction)
  const [correction, setCorrection] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Keep a failed command's identity for an uncertain network response; changed content gets a new identity.
  const [pending, setPending] = useState<{ body: string; key: string } | null>(null)
  async function save(archived?: boolean) {
    const value = { version: detail.version, stage, interest, note, nextAction, archived, correctionOf: correction ? Number(correction) : null, reason }
    const body = JSON.stringify(value)
    const command = pending?.body === body ? pending : { body, key: crypto.randomUUID() }
    setPending(command); setBusy(true); setError('')
    try { await opportunityApi(`/${detail.id}`, { ...value, eventKey: command.key }); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败，请刷新后核对') }
    finally { setBusy(false) }
  }
  return <section className="space-y-4 rounded-xl border bg-card p-5" aria-label="机会详情">
    <div className="flex justify-between gap-3"><h2 className="text-xl font-semibold">{detail.job_name || '历史岗位'} · {detail.company_name || '公司未知'}</h2><Button variant="outline" onClick={onClose}>关闭</Button></div>
    <div className="grid gap-4 md:grid-cols-2">
      <label>求职阶段<select className="mt-1 block w-full rounded border bg-background p-2" value={stage} onChange={e => setStage(e.target.value)}>{Object.entries(stages).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <label>个人兴趣<select className="mt-1 block w-full rounded border bg-background p-2" value={interest} onChange={e => setInterest(e.target.value)}><option value="UNDECIDED">未表态</option><option value="INTERESTED">感兴趣</option><option value="NOT_INTERESTED">不感兴趣</option></select></label>
      <label>备注<textarea className="mt-1 block w-full rounded border bg-background p-2" maxLength={4000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <label>下一步事项<textarea className="mt-1 block w-full rounded border bg-background p-2" maxLength={500} value={nextAction} onChange={e => setNextAction(e.target.value)} /></label>
    </div>
    <details><summary className="cursor-pointer text-sm">更正已有结果或回退阶段</summary><div className="mt-2 space-y-2">
      <label>选择要更正的事件<select className="ml-2 rounded border bg-background p-2" value={correction} onChange={e => setCorrection(e.target.value)}><option value="">不更正</option>{detail.events.map(e => <option key={e.id} value={e.id}>#{e.id} {e.type}</option>)}</select></label>
      <label className="block">更正原因<input className="ml-2 rounded border bg-background p-2" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
    </div></details>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => save()}>保存记录</Button><Button variant="outline" disabled={busy} onClick={() => save(!detail.archived)}>{detail.archived ? '恢复到当前列表' : '归档此机会'}</Button>{['boss', 'zhilian'].includes(detail.platform) && <Link className="p-2 text-sm underline" href={`/${detail.platform}/analysis`}>原平台分析与投递对账</Link>}</div>
    <details><summary className="cursor-pointer">JD 与 AI 分析</summary><p className="my-3 whitespace-pre-wrap text-sm">{jobDescription(detail.job_snapshot)}</p>{detail.analyses.map(a => <p key={a.id} className="mb-2 text-sm">分析 #{a.id} · {a.score} 分 · {a.decision} · 分析简历 {a.resume_version_id ? `v${a.resume_version_id}` : '版本未知'}<br />{a.summary}</p>)}</details>
    <div><h3 className="font-medium">投递记录</h3>{detail.applications.length === 0 && <p className="text-sm text-muted-foreground">尚无投递请求</p>}{detail.applications.map(a => <p key={a.id} className="mt-1 text-sm">#{a.id} · {applicationStatuses[a.state]} · {a.evidence || '无结果证据'}</p>)}</div>
    <details open><summary className="cursor-pointer font-medium">最近 200 条时间线</summary><ol className="mt-2 space-y-2">{detail.events.map(e => <li key={e.id} className="border-l-2 pl-3 text-sm"><span>#{e.id} · {e.type} · {e.source}</span><br /><span className="text-muted-foreground">{e.occurred_at || `发生时间未知；记录于 ${e.observed_at}`}</span>{e.reason && <p>更正原因：{e.reason}</p>}</li>)}</ol></details>
  </section>
}
