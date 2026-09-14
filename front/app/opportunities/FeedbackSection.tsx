'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { opportunityApi, type OpportunityDetail } from '@/lib/opportunities'

export const feedbackTypes: Record<string, string> = {
  RECRUITER_REPLIED: 'HR 已回复', CHATTING: '继续沟通', PHONE_SCREEN: '电话沟通', INTERVIEW_INVITED: '收到面试邀请',
  OFFER: '收到 Offer', REJECTED: '收到淘汰结果', WITHDRAWN: '主动退出', NO_REPLY_OBSERVED: '已检查，暂未回复', NO_INTERVIEW_OBSERVED: '已检查，暂未获得面试邀请',
}
type Conversation = { id: number; hrName: string; companyName: string; jobName: string; candidate: boolean; linked: number; linked_count: number }
type Message = { from: string; text: string; time: string; type: string }

export default function FeedbackSection({ detail, onSaved }: { detail: OpportunityDetail; onSaved: () => void }) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [type, setType] = useState('RECRUITER_REPLIED')
  const absence = type === 'NO_REPLY_OBSERVED' || type === 'NO_INTERVIEW_OBSERVED'
  const [occurred, setOccurred] = useState('')
  const [until, setUntil] = useState('')
  const [attempt, setAttempt] = useState('')
  const [conversation, setConversation] = useState('')
  const [resumeVersion, setResumeVersion] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ signature: string; key: string } | null>(null)
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) }
  }
  async function save(path: string, value: object) {
    const signature = JSON.stringify({ path, value })
    const command = pending?.signature === signature ? pending : { signature, key: crypto.randomUUID() }
    setPending(command)
    await opportunityApi(`/${detail.id}${path}`, { ...value, version: detail.version, eventKey: command.key })
    onSaved()
  }
  const confirmed = detail.applications.filter(a => a.state === 'CONFIRMED')
  const versions = Array.from(new Set(detail.analyses.map(a => a.resume_version_id).filter((id): id is number => id !== null)))
  return <section className="space-y-4 border-t pt-4" aria-label="结果反馈与会话关联">
    <h3 className="font-medium">记录真实反馈</h3>
    <p className="text-sm text-muted-foreground">请根据你实际观察的结果保存。收到面试邀请不等于已安排面试；AI 消息分类不会自动确认为结果。</p>
    <div className="grid gap-3 md:grid-cols-2">
      <label>反馈类型<select className="mt-1 block w-full rounded border bg-background p-2" value={type} onChange={e => setType(e.target.value)}>{Object.entries(feedbackTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>发生时间（不确定可留空）<input type="datetime-local" className="mt-1 block w-full rounded border bg-background p-2" value={occurred} onChange={e => setOccurred(e.target.value)} /></label>
      {absence && <label>已核对结果的截止时间<input type="datetime-local" required className="mt-1 block w-full rounded border bg-background p-2" value={until} onChange={e => setUntil(e.target.value)} /></label>}
      <label>归属投递记录<select className="mt-1 block w-full rounded border bg-background p-2" value={attempt} onChange={e => { setAttempt(e.target.value); setResumeVersion('') }}><option value="">归属未知 / 与投递无关</option>{confirmed.map(a => <option key={a.id} value={a.id}>投递 #{a.id} · {a.requested_at}</option>)}</select></label>
      <label>关联会话<select className="mt-1 block w-full rounded border bg-background p-2" value={conversation} onChange={e => setConversation(e.target.value)}><option value="">无 / 尚未关联</option>{conversations?.filter(c => c.linked).map(c => <option key={c.id} value={c.id}>会话 #{c.id} · {c.hrName || '历史名称已清理'}</option>)}</select></label>
      <label>平台实际发送的简历<select disabled={!attempt} className="mt-1 block w-full rounded border bg-background p-2" value={resumeVersion} onChange={e => setResumeVersion(e.target.value)}><option value="">尚未核实，版本未知</option>{versions.map(id => <option key={id} value={id}>我已核实：实际发送版本 #{id}</option>)}</select><span className="text-xs text-muted-foreground">仅在核实网站实际发送版本后选择，不能从分析版本推断。</span></label>
      <label>反馈备注<textarea maxLength={1000} className="mt-1 block w-full rounded border bg-background p-2" value={note} onChange={e => setNote(e.target.value)} /></label>
    </div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <Button disabled={busy || (absence && (!until || !attempt))} onClick={() => run(() => save('/feedback', {
      type, occurredAt: occurred ? new Date(occurred).toISOString() : null, observedUntil: absence && until ? new Date(until).toISOString() : null,
      attemptId: attempt ? Number(attempt) : null, conversationId: conversation ? Number(conversation) : null,
      actualSentResumeVersionId: resumeVersion ? Number(resumeVersion) : null, note,
    }))}>确认记录反馈</Button>
    <details><summary className="cursor-pointer font-medium">关联已采集的 HR 会话</summary><div className="mt-3 space-y-3">
      <p className="text-sm text-muted-foreground">同名岗位或同一 HR 只能作为候选。关联多个机会后，每条结果仍需指定归属。这里只读取本机已有会话，不访问招聘账号。</p>
      <Button variant="outline" disabled={busy} onClick={() => run(async () => setConversations(await opportunityApi<Conversation[]>(`/${detail.id}/conversations`)))}>加载已采集会话</Button>
      {conversations?.length === 0 && <p className="text-sm">当前档案暂无该平台会话。</p>}
      {conversations?.map(c => <div key={c.id} className="space-y-2 rounded border p-3"><p className="text-sm">会话 #{c.id} · {c.hrName || '历史名称已清理'} · {c.companyName} · {c.jobName}{c.candidate && !c.linked ? '（候选，尚未确认）' : ''}</p>
        {c.linked_count > 1 && <p className="text-sm text-amber-600">此会话关联多个机会，不自动分配消息结果。</p>}
        <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => run(() => save('/conversations', { conversationId: c.id, active: !c.linked }))}>{c.linked ? '取消关联' : '确认关联此机会'}</Button>
          {!!c.linked && <Button variant="outline" disabled={busy} onClick={() => run(async () => setMessages(await opportunityApi<Message[]>(`/${detail.id}/conversations/${c.id}/messages`)))}>查看保留期内消息</Button>}</div>
      </div>)}
      {messages.length > 0 && <div className="max-h-72 space-y-2 overflow-auto rounded border p-3">{messages.map((m, i) => <p key={i} className="whitespace-pre-wrap text-sm">{m.from} · {m.time}<br />{m.text || `[${m.type}]`}</p>)}</div>}
    </div></details>
  </section>
}
