'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { API_BASE, friendlyApiError, localActionFetch, readApiResponse } from '@/lib/api'

type Proposal = { id: number; conversationId: number; version: number; status: string; hrName: string; companyName: string; draft: string }
type Step = { id: string; action_type: string; status: string; reviewed_at?: string }
type Target = { id: string; hrName: string; companyName: string; status: string; reason: string; steps: Step[]; previousAttempts?: { old_proposal_id: number; action_type: string; status: string }[] }
type Observation = { stage?: string; detail?: string; errorCode?: string; observedAt?: number; elapsedSeconds?: number; hrName?: string; companyName?: string }
type Batch = { id?: string; status?: string; stage?: string; reason?: string; replyMode?: string; processingDiscovered?: boolean; coverageComplete?: boolean; discovered?: number; checked?: number; pendingReview?: number; sent?: number; items?: { id: string; hrName: string; companyName: string; kind: string; status: string; reason: string; notificationStatus?: string; canRecheck?: boolean }[] }
type Status = { installed: boolean; protocol: string; running: boolean; executing: boolean; status: string; reason?: string; runId?: string; targets: Target[]; resumeRule?: { enabled: boolean; state: string; reason: string }; batch?: Batch; observation?: { current?: Observation; lastSuccess?: Observation; updatedAt?: number } }
const VISUAL_PROTOCOL = '2026-09-29-hr-visual-v3'
const labels: Record<string, string> = {
  IDLE: '尚未开始', RUNNING: '正在处理', STOPPING: '正在停止并核验回执', PAUSED: '已暂停', COMPLETED: '本轮处理结束', ARCHIVED: '正文已按保留期清理',
  PENDING_CAPTURE: '正在定位和读取', REVIEW_REQUIRED: '等你确认', QUEUED: '等待桌面', PREPARED: '已核对，准备发送',
  SUBMITTING: '正在发送', SENT_CONFIRMED: '已确认发送', PARTIAL: '部分完成', SEND_UNKNOWN: '发送结果未知',
  BLOCKED: '已阻塞', STALE: '原回复已失效', SKIPPED: '已跳过', PENDING: '尚未发送', PRIORITY_PENDING: '优先核验',
  WAITING_CHROME: '等待 Chrome', OPENED_ONCE: '本轮已打开一次', WAITING_LIST: '等待联系人列表', LIST_READY: '联系人列表已加载',
  LIST_READY_NO_SELECTION: '列表已加载，尚未选择 HR', SELECTING_HR: '正在选择 HR', WAITING_BODY: '等待聊天正文', BODY_VERIFIED: '正文已核验',
  DISCOVERING: '正在逐屏读取联系人', OBSERVATION_FAILED: '本次读取失败', EXECUTOR_ERROR: '视觉执行器异常',
  LIST_FILTERED_EMPTY: '联系人搜索无可见结果',
  STARTING: '正在启动本轮', FINISHED: '本轮扫描完成', INCOMPLETE: '本轮停止，仍有未完成项', EXCLUDED: '本轮排除', VERIFIED: '已只读核验', DATE_UNKNOWN: '日期待核验', READ_FAILED: '正文未读完整', WAITING_REVIEW: '等你确认',
}

export default function HrVisualPanel({ profileId, profileName }: { profileId: number; profileName: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [accountName, setAccountName] = useState(profileName)
  const [bindingConfirmed, setBindingConfirmed] = useState(false)
  const [resumeConfirmed, setResumeConfirmed] = useState(false)
  const [directConfirmed, setDirectConfirmed] = useState(false)
  const batchRequestKey = useRef<string | null>(null)
  const batchActive = ['STARTING', 'RUNNING'].includes(status?.batch?.status || '')
  const compatible = status?.protocol === VISUAL_PROTOCOL
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
      if (operation !== 'pause' && !compatible) throw new Error('前后端视觉协议不匹配，请先更新工作台')
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
  const reconcile = async (targetId: string) => {
    setBusy(true); setError('')
    try {
      const response = await localActionFetch(`${API_BASE}/api/hr-assistant/visual/${status?.runId}/targets/${targetId}/reconcile`, { method: 'POST' })
      await readApiResponse(response, '回执仍未确认；没有重发'); await refresh()
    } catch (e) { setError(friendlyApiError(e, '回执仍未确认；没有重发')) }
    finally { setBusy(false) }
  }
  const setResumeRule = async (enabled: boolean) => {
    setBusy(true); setError('')
    try {
      if (enabled && !compatible) throw new Error('前后端视觉协议不匹配，请先更新工作台')
      const response = await localActionFetch(`${API_BASE}/api/hr-assistant/visual/resume-rule`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, protocol: status?.protocol, enabled, confirmed: resumeConfirmed, accountName, accountBindingConfirmed: bindingConfirmed }),
      })
      await readApiResponse(response, '简历规则保存失败'); await refresh()
    } catch (e) { setError(friendlyApiError(e, '简历规则保存失败')) }
    finally { setBusy(false) }
  }
  const batchAction = async (action: 'start' | 'pause' | 'resume') => {
    setBusy(true); setError('')
    try {
      if (action !== 'pause' && !compatible) throw new Error('前后端视觉协议不匹配，请先更新工作台')
      if (action === 'start') batchRequestKey.current ||= crypto.randomUUID()
      const response = await localActionFetch(`${API_BASE}/api/hr-assistant/visual/batches${action === 'start' ? '' : `/${status?.batch?.id}/${action}`}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        ...(action === 'start' ? { body: JSON.stringify({ profileId, protocol: VISUAL_PROTOCOL, requestKey: batchRequestKey.current,
          accountName, accountBindingConfirmed: bindingConfirmed, resumeSharingConfirmed: resumeConfirmed }) } : {}),
      })
      await readApiResponse(response, '单轮操作未完成')
      batchRequestKey.current = null
      await refresh()
    } catch (e) { setError(friendlyApiError(e, '单轮操作未完成')) }
    finally { setBusy(false) }
  }
  const prioritize = async (itemId: string, recheck = false) => {
    setBusy(true); setError('')
    try {
      if (!compatible) throw new Error('前后端视觉协议不匹配，请先更新工作台')
      const response = await localActionFetch(`${API_BASE}/api/hr-assistant/visual/batches/${status?.batch?.id}/items/${itemId}/${recheck ? 'recheck' : 'prioritize'}`, { method: 'POST' })
      await readApiResponse(response, '优先处理未启动'); await refresh()
    } catch (e) { setError(friendlyApiError(e, '优先处理未启动')) }
    finally { setBusy(false) }
  }
  const processDiscovered = async () => {
    setBusy(true); setError('')
    try {
      if (!compatible) throw new Error('前后端视觉协议不匹配，请先更新工作台')
      const response = await localActionFetch(`${API_BASE}/api/hr-assistant/visual/batches/${status?.batch?.id}/process`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocol: VISUAL_PROTOCOL, replyMode: directConfirmed ? 'AUTO' : 'REVIEW', directRepliesConfirmed: directConfirmed }),
      })
      await readApiResponse(response, '整轮处理未启动'); await refresh()
    } catch (e) { setError(friendlyApiError(e, '整轮处理未启动')) }
    finally { setBusy(false) }
  }
  return <section className="space-y-3 rounded-lg border p-4" aria-label="BOSS视觉聊天测试">
    <p className="font-medium">本机 Chrome 视觉聊天 · {status?.batch?.replyMode === 'AUTO' ? '本轮直接回复' : 'QQ 逐条确认'}</p>
    <p className="text-sm text-muted-foreground">自动选中 HR 并核对公司、读取正文。发送动作至少间隔 5 秒；未知结果不重发。可检查一轮其他 HR，或使用原三会话测试入口。</p>
    <div className="space-y-2 rounded border p-3 text-sm" aria-label="单轮检查其他HR">
      <p className="font-medium">检查一轮其他 HR</p>
      <p>最近 30 天，排除此前测试会话；明确索要简历时分享 BOSS 原生简历，{status?.batch?.replyMode === 'AUTO' ? '普通文字审核通过后直接回复' : '文字回复发 QQ 等你确认'}。只打开一次，本轮结束后停止，不开启持续巡检。</p>
      <p>使用下方填写的 BOSS 登录姓名和简历分享授权。</p>
      {!compatible && status && <p role="alert">前后端视觉协议不匹配，不能启动。</p>}
      <Button type="button" disabled={busy || !compatible || batchActive || status?.batch?.status === 'PAUSED' || status?.running || status?.executing || !status?.installed || !resumeConfirmed || !accountName.trim() || (accountName !== profileName && !bindingConfirmed)} onClick={() => void batchAction('start')}>检查一轮其他 HR</Button>
      {batchActive && <Button type="button" variant="outline" disabled={busy} onClick={() => void batchAction('pause')}>暂停本轮</Button>}
      {status?.batch?.status === 'PAUSED' && <Button type="button" variant="outline" disabled={busy || status.executing} onClick={() => void batchAction('resume')}>从保留进度恢复（不重新开页）</Button>}
      {status?.batch?.status === 'PAUSED' && (status.batch.discovered || 0) > 0 && status.batch.stage !== 'BOOTSTRAP' && <div className="space-y-2">
        <label className="flex items-center gap-2"><input type="checkbox" checked={directConfirmed} onChange={e => setDirectConfirmed(e.target.checked)} />本轮普通文字经审核后直接回复，无需 QQ 确认</label>
        <p>依次处理已收集的全部会话，保留未完成的列表范围。需要承诺或资料不足的会话记为待处理，继续其他人；不启用持续值守。</p>
        <Button type="button" disabled={busy || !compatible || status.executing || status.running} onClick={() => void processDiscovered()}>处理已发现的全部会话（{status.batch.discovered} 人）</Button>
      </div>}
      {status?.batch?.id && <>
        <p>本轮回复模式：{status.batch.replyMode === 'AUTO' ? '普通文字审核通过后直接发送，不发送 QQ 确认卡' : '普通文字经 QQ 确认后发送'}{status.batch.processingDiscovered && '；正在依次处理已收集名单，不重新枚举'}</p>
        <p>{labels[status.batch.status || ''] || status.batch.status}：{status.batch.reason}</p>
        <p>发现 {status.batch.discovered || 0} 人 · 检查 {status.batch.checked || 0} 人 · 待确认 {status.batch.pendingReview || 0} 条 · 已确认发送 {status.batch.sent || 0} 条</p>
        <p>列表范围：{status.batch.coverageComplete ? '已确认到达末尾' : '尚未确认完整覆盖'}</p>
        <details><summary>本轮逐项结果</summary>{status.batch.items?.map(item => <div key={item.id} className="my-2">
          <p>{item.hrName} · {item.companyName}：{labels[item.status] || item.status}；{item.reason}{item.notificationStatus && `；QQ 通知：${({ CONFIRMED: '已确认送达', PENDING: '等待通道发送', UNKNOWN: '结果未知，未重发', FAILED: '发送失败', NOT_QUEUED: '尚未排队' } as Record<string, string>)[item.notificationStatus] || item.notificationStatus}`}</p>
          {status.batch?.status === 'PAUSED' && status.batch.stage === 'DISCOVER' && item.kind === 'CONTACT' && item.status === 'PENDING' &&
            <Button type="button" variant="outline" disabled={busy || !compatible || status.executing || status.running} onClick={() => void prioritize(item.id)}>优先处理此会话，随后继续扫描</Button>}
          {status.batch?.status === 'PAUSED' && (status.batch.stage === 'DISCOVER' || (status.batch.processingDiscovered && status.batch.stage === 'PROCESS')) && item.canRecheck &&
            <Button type="button" variant="outline" disabled={busy || !compatible || status.executing || status.running} onClick={() => void prioritize(item.id, true)}>重新核验未进入发送的会话</Button>}
        </div>)}</details>
      </>}
    </div>
    {status?.observation?.current && <div className="rounded border p-3 text-sm" aria-label="最近页面观察">
      <p>{labels[status.observation.current.stage || ''] || status.observation.current.stage}：{status.observation.current.detail}</p>
      {status.observation.current.hrName && <p>核对目标：{status.observation.current.hrName} · {status.observation.current.companyName}</p>}
      <p>本次观察：{status.observation.current.observedAt ? new Date(status.observation.current.observedAt).toLocaleTimeString() : '未知'}{status.observation.current.elapsedSeconds !== undefined ? ` · 等待 ${status.observation.current.elapsedSeconds} 秒` : ''}</p>
      {status.observation.lastSuccess?.observedAt && <p>最近成功观察：{new Date(status.observation.lastSuccess.observedAt).toLocaleTimeString()}（历史观察，不代表当前页面仍然就绪）</p>}
    </div>}
    <div className="space-y-2 rounded border p-3 text-sm">
      <p className="font-medium">独立规则：HR 索要简历时直接发送</p>
      <p>优先点击简历请求卡片的“同意”，否则使用 BOSS“发简历”。普通文字仍须 QQ 确认。每分钟检查当前已加载的联系人列表，预览变化后核对正文；未加载的历史联系人不视为已检查。</p>
      <p>规则状态：{status?.resumeRule?.enabled ? (status.resumeRule.state === 'WATCHING' ? '已启用' : '已暂停') : '未启用'}{status?.resumeRule?.reason ? ` · ${status.resumeRule.reason}` : ''}</p>
      <label className="block">BOSS 登录姓名<input className="ml-2 rounded border px-2 py-1" value={accountName} onChange={e => { setAccountName(e.target.value); setBindingConfirmed(false) }} /></label>
      {accountName !== profileName && <label className="flex items-center gap-2"><input type="checkbox" checked={bindingConfirmed} onChange={e => setBindingConfirmed(e.target.checked)} />确认这个 BOSS 账号属于当前档案“{profileName}”</label>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={resumeConfirmed} onChange={e => setResumeConfirmed(e.target.checked)} />允许向明确索要简历的 HR 直接分享当前 BOSS 简历</label>
      {status?.resumeRule?.enabled && status.resumeRule.state === 'WATCHING'
        ? <Button type="button" variant="outline" disabled={busy} onClick={() => void setResumeRule(false)}>关闭自动简历规则</Button>
        : <Button type="button" disabled={busy || !compatible || batchActive || status?.running || status?.executing || !status?.installed || !resumeConfirmed || !accountName.trim() || (accountName !== profileName && !bindingConfirmed)} onClick={() => void setResumeRule(true)}>启用自动简历规则</Button>}
    </div>
    <p role="status">{status ? `${labels[status.status] || status.status}${status.reason ? `：${status.reason}` : ''}` : '正在检查视觉执行器…'}</p>
    {status && !status.installed && <p>视觉环境尚未安装，请运行项目 hr-visual/setup.ps1 后重试。</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={busy || !compatible || batchActive || status?.running || status?.executing || !status?.installed} onClick={() => void loadChoices()}>选择三个已有会话</Button>
      {selected.length > 0 && <Button type="button" disabled={busy || selected.length !== 3 || status?.running || !accountName.trim() || (accountName !== profileName && !bindingConfirmed)} onClick={() => void act('start')}>读取并发送 QQ 建议卡（{selected.length}/3）</Button>}
      {status?.running && <Button type="button" variant="outline" disabled={busy} onClick={() => void act('pause')}>暂停视觉测试</Button>}
      {status?.runId && ['PAUSED', 'BLOCKED'].includes(status.status) && <Button type="button" disabled={busy || status.executing} onClick={() => void act('resume')}>恢复并重新核对</Button>}
    </div>
    {proposals.length > 0 && !status?.running && <div className="space-y-2">
      {proposals.map(p => <label key={p.id} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={selected.includes(p.id)} disabled={busy || (!selected.includes(p.id) && selected.length >= 3)} onChange={e => setSelected(prev => e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id))} />
        {p.hrName} · {p.companyName}
      </label>)}
    </div>}
    {(status?.targets || []).map(t => <div key={t.id} className="rounded border p-2 text-sm">
      <p>{t.hrName} · {t.companyName}：{labels[t.status] || t.status}</p>
      <p>{t.reason}</p>
      {t.steps.map(s => <p key={s.id}>{s.action_type === 'TEXT' ? '文字回复' : 'BOSS 原生简历'}：{labels[s.status] || s.status}{s.reviewed_at ? '（原结果未知；只读复核已确认，未重发）' : ''}</p>)}
      {t.status === 'SEND_UNKNOWN' && !status?.running && <Button type="button" variant="outline" disabled={busy || status?.executing} onClick={() => void reconcile(t.id)}>只读核验发送回执</Button>}
      {!!t.previousAttempts?.length && <details><summary>之前的尝试记录（保留原结果）</summary>{t.previousAttempts.map((s, i) => <p key={i}>#{s.old_proposal_id} · {s.action_type === 'TEXT' ? '文字回复' : 'BOSS 原生简历'}：{labels[s.status] || s.status}</p>)}</details>}
    </div>)}
    {error && <p role="alert">{error}</p>}
  </section>
}
