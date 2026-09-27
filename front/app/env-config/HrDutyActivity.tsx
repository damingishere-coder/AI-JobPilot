'use client'

import { useEffect, useState } from 'react'
import { API_BASE, localActionFetch, readApiResponse, friendlyApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'

type Proposal = { id: number; profileId: number; version: number; status: string; companyName: string; hrName: string; sourceMessage: string; draft: string }
type Activity = { counts: Record<string, number>; progress: { processed: number; baseline_complete: number }; decisions: { proposalId: number; reason: string; origin: string }[] }
const labels: Record<string, string> = { OBSERVED: '处理中', GENERATING: '处理中', APPROVED: '等待发送', SENDING: '正在发送', SENT_CONFIRMED: '已发送', REVIEW_REQUIRED: '待你决定', SKIPPED: '无需回复', SEND_UNKNOWN: '发送结果未知', BLOCKED: '需人工处理', EXPIRED: '已失效' }

export default function HrDutyActivity({ profileId }: { profileId: number }) {
  const [rows, setRows] = useState<Proposal[]>([])
  const [activity, setActivity] = useState<Activity | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false, busy = false
    async function refresh() {
      if (busy) return
      busy = true
      try {
        const [proposals, policy] = await Promise.all([
          fetch(`${API_BASE}/api/hr-assistant/proposals?includeClosed=true`).then(r => readApiResponse<Proposal[]>(r, '回复记录读取失败')),
          fetch(`${API_BASE}/api/hr-assistant/autopilot`).then(r => readApiResponse<{ activity: Activity }>(r, '值班进度读取失败')),
        ])
        if (!disposed) { setRows((proposals.data || []).filter(p => p.profileId === profileId)); setActivity(policy.data?.activity || null); setError('') }
      } catch (e) { if (!disposed) setError(friendlyApiError(e, '记录读取失败')) }
      finally { busy = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 15000)
    return () => { disposed = true; clearInterval(timer) }
  }, [profileId])
  return <div className="space-y-3 border-t pt-4">
    <h4 className="font-semibold">回复记录</h4>
    {activity && <p className="text-sm">已保存 {activity.progress.processed} 次会话处理进度 · {activity.progress.baseline_complete ? '最近一轮扫描完成' : '尚未完成全部扫描，已保存进度可恢复'} · 已发送 {activity.counts.SENT_CONFIRMED || 0} · 待你决定 {activity.counts.REVIEW_REQUIRED || 0}</p>}
    {error && <p role="alert">{error}</p>}
    {rows.length === 0 && <p className="text-sm text-muted-foreground">暂无回复记录。开始值班后在这里查看实际发送结果。</p>}
    {rows.map(row => <Reply key={`${profileId}:${row.id}`} row={row} decision={activity?.decisions.find(d => d.proposalId === row.id)} />)}
  </div>
}

function Reply({ row, decision }: { row: Proposal; decision?: { reason: string; origin: string } }) {
  const [edit, setEdit] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function action(operation: string) {
    setBusy(true); setMessage('')
    try {
      const response = await localActionFetch(`${API_BASE}/api/hr-assistant/proposals/${row.id}/${operation}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: row.version, draft: edit ?? row.draft }),
      })
      await readApiResponse(response, '操作未完成')
      setEdit(null); setMessage(operation === 'send' ? '已排队，等待 BOSS 标签执行；尚未确认发出。' : '已保存，记录即将刷新。')
    } catch (e) { setMessage(friendlyApiError(e, '操作未完成')) }
    finally { setBusy(false) }
  }
  return <details className="rounded border p-3">
    <summary className="cursor-pointer text-sm">{row.companyName} / {row.hrName} · {labels[row.status] || row.status}{decision?.origin === 'BACKLOG' ? ' · 历史待办' : ''}</summary>
    <p className="my-2 whitespace-pre-wrap text-sm">HR：{row.sourceMessage}</p>
    <p className="my-2 text-sm">处理依据：{decision?.reason || '等待判断'}</p>
    {row.status === 'REVIEW_REQUIRED' ? <>
      <textarea aria-label={`回复 ${row.hrName}`} className="w-full rounded border p-2" value={edit ?? row.draft} onChange={e => setEdit(e.target.value)} />
      <div className="flex gap-2">
        <Button type="button" disabled={busy || edit === null || !edit.trim()} onClick={() => void action('revise')}>保存修改</Button>
        <Button type="button" disabled={busy || edit !== null || !row.draft.trim()} onClick={() => void action('send')}>确认发送</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void action('skip')}>跳过</Button>
      </div>
    </> : <p className="whitespace-pre-wrap text-sm">回复：{row.draft || '无'}</p>}
    <p role="status" className="mt-2 text-sm">{message}</p>
  </details>
}
