'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { API_BASE, friendlyApiError, localActionFetch, readApiResponse } from '@/lib/api'

type Proposal = { id: number; conversationId: number; version: number; status: string; hrName: string; companyName: string; draft: string }
type Step = { id: string; action_type: string; status: string }
type Target = { id: string; hrName: string; companyName: string; status: string; reason: string; steps: Step[]; previousAttempts?: { old_proposal_id: number; action_type: string; status: string }[] }
type Status = { installed: boolean; protocol: string; running: boolean; executing: boolean; status: string; reason?: string; runId?: string; targets: Target[] }
const labels: Record<string, string> = {
  IDLE: '尚未开始', RUNNING: '正在处理', STOPPING: '正在停止并核验回执', PAUSED: '已暂停', COMPLETED: '本轮处理结束', ARCHIVED: '正文已按保留期清理',
  PENDING_CAPTURE: '正在定位和读取', REVIEW_REQUIRED: '等你确认', QUEUED: '等待桌面', PREPARED: '已核对，准备发送',
  SUBMITTING: '正在发送', SENT_CONFIRMED: '已确认发送', PARTIAL: '部分完成', SEND_UNKNOWN: '发送结果未知',
  BLOCKED: '已阻塞', STALE: '原回复已失效', SKIPPED: '已跳过', PENDING: '尚未发送',
}

export default function HrVisualPanel({ profileId, profileName }: { profileId: number; profileName: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [accountName, setAccountName] = useState(profileName)
  const [bindingConfirmed, setBindingConfirmed] = useState(false)
  const refresh = useCallback(async () => {
    const response = await fetch(`${API_BASE}/api/hr-assistant/visual/status`, { cache: 'no-store' })
    const result = await readApiResponse<Status>(response, '视觉执行器状态读取失败')
    if (!result.data || !Array.isArray(result.data.targets)) throw new Error('视觉接口版本不兼容')
    setStatus(result.data)
  }, [])
  useEffect(() => {
    let disposed = false
    const poll = async () => { try { if (!disposed) await refresh() } catch (e) { if (!disposed) setError(friendlyApiError(e, '状态读取失败')) } }
    void poll()
    const timer = window.setInterval(() => void poll(), 5000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [refresh, profileId])
  const loadChoices = async () => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`${API_BASE}/api/hr-assistant/proposals?includeClosed=true`, { cache: 'no-store' })
      const result = await readApiResponse<Proposal[]>(response, '读取已有会话失败')
      const seen = new Set<number>()
      const choices = (Array.isArray(result.data) ? result.data : []).filter(p => {
        if (seen.has(p.conversationId)) return false
        seen.add(p.conversationId)
        return ['REVIEW_REQUIRED', 'EXPIRED'].includes(p.status)
      })
      setProposals(choices); setSelected([])
    } catch (e) { setError(friendlyApiError(e, '读取失败')) }
    finally { setBusy(false) }
  }
  const act = async (operation: 'start' | 'pause' | 'resume') => {
    setBusy(true); setError('')
    try {
      const response = await localActionFetch(`${API_BASE}/api/hr-assistant/visual/${operation === 'start' ? 'start' : `${status?.runId}/${operation}`}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        ...(operation === 'start' ? { body: JSON.stringify({ profileId, accountName, accountBindingConfirmed: bindingConfirmed, protocol: status?.protocol, targets: selected.map(id => {
          const p = proposals.find(p => p.id === id)!
          return { proposalId: p.id, expectedVersion: p.version, draft: p.draft, approved: false, sendResume: false }
        }) }) } : {}),
      })
      await readApiResponse(response, '视觉操作未完成'); await refresh()
    } catch (e) { setError(friendlyApiError(e, '视觉操作未完成')) }
    finally { setBusy(false) }
  }
  return <section className="space-y-3 rounded-lg border p-4" aria-label="BOSS视觉聊天测试">
    <p className="font-medium">本机 Chrome 视觉聊天 · QQ 逐条确认</p>
    <p className="text-sm text-muted-foreground">自动选中 HR 并核对公司、读取正文，确认后回发。每个动作至少间隔 5 秒；只处理本轮选定的三个会话。</p>
    <p role="status">{status ? `${labels[status.status] || status.status}${status.reason ? `：${status.reason}` : ''}` : '正在检查视觉执行器…'}</p>
    {status && !status.installed && <p>视觉环境尚未安装，请运行项目 hr-visual/setup.ps1 后重试。</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={busy || status?.running || status?.executing || !status?.installed} onClick={() => void loadChoices()}>选择三个已有会话</Button>
      {selected.length > 0 && <Button type="button" disabled={busy || selected.length !== 3 || status?.running || !accountName.trim() || (accountName !== profileName && !bindingConfirmed)} onClick={() => void act('start')}>读取并发送 QQ 建议卡（{selected.length}/3）</Button>}
      {status?.running && <Button type="button" variant="outline" disabled={busy} onClick={() => void act('pause')}>暂停视觉测试</Button>}
      {status?.runId && ['PAUSED', 'BLOCKED'].includes(status.status) && <Button type="button" disabled={busy || status.executing} onClick={() => void act('resume')}>恢复并重新核对</Button>}
    </div>
    {proposals.length > 0 && !status?.running && <div className="space-y-2">
      <label className="block text-sm">BOSS 登录姓名
        <input className="ml-2 rounded border px-2 py-1" value={accountName} onChange={e => { setAccountName(e.target.value); setBindingConfirmed(false) }} />
      </label>
      {accountName !== profileName && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bindingConfirmed} onChange={e => setBindingConfirmed(e.target.checked)} />确认这个 BOSS 账号属于当前档案“{profileName}”</label>}
      {proposals.map(p => <label key={p.id} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={selected.includes(p.id)} disabled={busy || (!selected.includes(p.id) && selected.length >= 3)} onChange={e => setSelected(prev => e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id))} />
        {p.hrName} · {p.companyName}
      </label>)}
    </div>}
    {(status?.targets || []).map(t => <div key={t.id} className="rounded border p-2 text-sm">
      <p>{t.hrName} · {t.companyName}：{labels[t.status] || t.status}</p>
      <p>{t.reason}</p>
      {t.steps.map(s => <p key={s.id}>{s.action_type === 'TEXT' ? '文字回复' : 'BOSS 原生简历'}：{labels[s.status] || s.status}</p>)}
      {!!t.previousAttempts?.length && <details><summary>之前的尝试记录（保留原结果）</summary>{t.previousAttempts.map((s, i) => <p key={i}>#{s.old_proposal_id} · {s.action_type === 'TEXT' ? '文字回复' : 'BOSS 原生简历'}：{labels[s.status] || s.status}</p>)}</details>}
    </div>)}
    {error && <p role="alert">{error}</p>}
  </section>
}
