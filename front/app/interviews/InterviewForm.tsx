'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { localDateTimeInput, opportunityApi } from '@/lib/opportunities'
import { interviewModes, interviewPreparation, interviewStatuses, type Interview } from '@/lib/interviews'

export default function InterviewForm({ opportunityId, opportunityVersion, initial, nextRound = 1, onSaved, onClose }: {
  opportunityId: number; opportunityVersion: number; initial?: Interview; nextRound?: number; onSaved: () => void; onClose: () => void;
}) {
  const [round, setRound] = useState(initial?.round_number || nextRound)
  const [time, setTime] = useState(localDateTimeInput(initial?.scheduled_at || null))
  const [status, setStatus] = useState(initial?.status || 'PENDING')
  const [mode, setMode] = useState(initial?.mode || 'ONLINE')
  const [preparation, setPreparation] = useState(initial?.preparation || [])
  const [note, setNote] = useState(initial?.note || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ body: string; key: string } | null>(null)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  async function save() {
    if (status === 'SCHEDULED' && !time) { setError('已安排面试必须填写确认时间'); return }
    setBusy(true); setError('')
    try {
      const value = { id: initial?.id || null, version: initial?.version || 0, opportunityVersion, round, scheduledAt: time ? new Date(time).toISOString() : null, timezone, mode, status, preparation, note }
      const body = JSON.stringify(value)
      const command = pending?.body === body ? pending : { body, key: crypto.randomUUID() }
      setPending(command)
      await opportunityApi(`/${opportunityId}/interviews`, { ...value, eventKey: command.key }); onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败，请刷新核对') }
    finally { setBusy(false) }
  }
  return <section className="space-y-4 rounded-lg border p-4" aria-label="编辑面试记录">
    <h3 className="font-medium">{initial ? '更新面试记录' : '新增面试轮次'}</h3>
    <p className="text-sm text-muted-foreground">只有双方确认时间后才选择“已安排”。这里只保存本机记录，不向 HR 发送消息或写入日历。</p>
    <div className="grid gap-3 md:grid-cols-2">
      <label>面试轮次<input type="number" min={1} max={100} value={round} onChange={e => setRound(Number(e.target.value))} className="mt-1 block w-full rounded border bg-background p-2" /></label>
      <label>面试状态<select value={status} onChange={e => setStatus(e.target.value)} className="mt-1 block w-full rounded border bg-background p-2">{Object.entries(interviewStatuses).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <label>时间（{timezone}）<input type="datetime-local" value={time} onChange={e => setTime(e.target.value)} className="mt-1 block w-full rounded border bg-background p-2" /></label>
      <label>面试方式<select value={mode} onChange={e => setMode(e.target.value)} className="mt-1 block w-full rounded border bg-background p-2">{Object.entries(interviewModes).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
    </div>
    <fieldset className="space-y-2"><legend className="mb-2 font-medium">人工准备清单</legend>{Object.entries(interviewPreparation).map(([key, text]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={preparation.includes(key)} onChange={e => setPreparation(items => e.target.checked ? [...items, key] : items.filter(item => item !== key))} />{text}</label>)}</fieldset>
    <Link href={`/opportunities?id=${opportunityId}`} className="text-sm underline">查看岗位 JD、分析与简历依据</Link>
    <label className="block">面试备注<textarea maxLength={4000} value={note} onChange={e => setNote(e.target.value)} className="mt-1 block w-full rounded border bg-background p-2" /></label>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <div className="flex gap-2"><Button disabled={busy} onClick={save}>确认保存面试</Button><Button variant="outline" disabled={busy} onClick={onClose}>关闭编辑</Button></div>
  </section>
}
