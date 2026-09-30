'use client'

import { useEffect, useState } from 'react'
import { API_BASE, localActionFetch, readApiResponse, friendlyApiError } from '@/lib/api'
import { getChromeBridgeStatus, sendChromeBridgeMessage } from '@/lib/chromeBridge'
import { Button } from '@/components/ui/button'
import HrDutyActivity from './HrDutyActivity'

export const HR_BACKGROUND_PROTOCOL = '2026-09-30-hr-background-v1'

type Policy = { version: number; enabled: boolean; paused: boolean; resumeName: string; resumeSha256: string; rules: string; facts: string; replyMode: string; sharePhone: boolean; shareResume: boolean; historyMode: string; historyDays: number; authorizationValid?: boolean; blockers?: string[]; communicationProfile?: Record<string, string> }
type HostState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'PAUSED' | 'RECOVERING' | 'BLOCKED'
type PageBinding = { watchSessionId?: string; hostGeneration?: string; pageDocumentId?: string }
type HostStatus = PageBinding & { transport: 'CHROME_BACKGROUND'; state: HostState; intentEnabled: boolean; paused?: boolean; pauseReason?: string; tabId?: number; accountName?: string; needsAccountConfirmation?: boolean; errorCode?: string; message?: string; lastPageSeenAt?: number | string; lastScanAt?: number | string; nextScanAt?: number | string }
type WatchStatus = PageBinding & { watching: boolean; transport?: string; lastPageHeartbeatAt?: number | string; lastSuccessfulScanAt?: number | string }
type Runtime = { host: HostStatus | null; watch: WatchStatus | null; hostError: string; backendError: string }
const stateLabels: Record<HostState, string> = { STOPPED: '已停止', STARTING: '正在后台核对账号与聊天页', RUNNING: '后台托管中', PAUSED: '已暂停', RECOVERING: '正在校验并恢复连接', BLOCKED: '需要处理后恢复' }

function hostData(value: unknown): HostStatus {
  const host = value as HostStatus | undefined
  if (!host || host.transport !== 'CHROME_BACKGROUND' || !Object.hasOwn(stateLabels, host.state)) throw new Error('后台托管状态格式不兼容，请重新加载 Chrome Bridge 1.10.0 并刷新工作台。')
  return host
}

async function readRuntime(): Promise<Runtime> {
  const [backend, extension] = await Promise.allSettled([
    fetch(`${API_BASE}/api/hr-assistant/status`, { cache: 'no-store' }).then(async response => {
      const result = await readApiResponse<WatchStatus>(response, '托管后端连接检查失败')
      if (!result.data || typeof result.data.watching !== 'boolean') throw new Error('托管后端状态格式不兼容。')
      return result.data
    }),
    sendChromeBridgeMessage({ type: 'BOSS_HR_HOST_STATUS', hrBackgroundProtocol: HR_BACKGROUND_PROTOCOL }, 3000).then(response => {
      if (!response.success) throw new Error(response.message || 'Chrome 扩展未连接，请加载 Chrome Bridge 1.10.0。')
      return hostData(response.data)
    }),
  ])
  return { host: extension.status === 'fulfilled' ? extension.value : null, watch: backend.status === 'fulfilled' ? backend.value : null,
    hostError: extension.status === 'rejected' ? friendlyApiError(extension.reason, '后台托管连接检查失败') : '',
    backendError: backend.status === 'rejected' ? friendlyApiError(backend.reason, '托管后端连接检查失败') : '' }
}

function timeLabel(value?: number | string) {
  if (!value) return '尚无记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '尚无记录' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

export default function HrAutopilotSettings({ profileId, settingsDirty = false }: { profileId: number; settingsDirty?: boolean }) {
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [accountConfirmed, setAccountConfirmed] = useState(false)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [runtime, setRuntime] = useState<Runtime>({ host: null, watch: null, hostError: '正在检查 Chrome 后台托管连接…', backendError: '' })
  const [deliveries, setDeliveries] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false, refreshing = false
    setPolicy(null); setConfirmed(false); setAccountConfirmed(false); setStatus('')
    fetch(`${API_BASE}/api/hr-assistant/autopilot`, { cache: 'no-store' })
      .then(r => readApiResponse<Policy>(r, '托管策略读取失败'))
      .then(r => { if (!cancelled && r.data) setPolicy({ ...r.data, replyMode: r.data.enabled ? r.data.replyMode : 'AUTO', historyMode: r.data.enabled ? r.data.historyMode : 'RECENT', historyDays: r.data.historyDays || 30 }) })
      .catch(e => { if (!cancelled) setStatus(friendlyApiError(e, '托管策略读取失败')) })
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try { const value = await readRuntime(); if (!cancelled) setRuntime(value) }
      finally { refreshing = false }
    }
    const refreshDeliveries = () => fetch(`${API_BASE}/api/hr-assistant/autopilot/deliveries`, { cache: 'no-store' })
      .then(r => readApiResponse<Record<string, number>>(r, '通知状态读取失败'))
      .then(r => { if (!cancelled && r.data) setDeliveries(r.data) }).catch(() => {})
    void refresh(); void refreshDeliveries()
    const runtimeTimer = setInterval(() => void refresh(), 5000)
    const deliveryTimer = setInterval(() => void refreshDeliveries(), 15000)
    return () => { cancelled = true; clearInterval(runtimeTimer); clearInterval(deliveryTimer) }
  }, [profileId])

  async function savePolicy(enabled: boolean) {
    if (!policy) throw new Error('请先读取当前档案的托管规则。')
    const resumeName = policy.shareResume ? policy.resumeName || 'BOSS_NATIVE' : ''
    const response = await localActionFetch(`${API_BASE}/api/hr-assistant/autopilot`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, expectedVersion: policy.version, enabled, rulesConfirmed: confirmed || !enabled,
        resumeName, resumeSha256: resumeName === 'BOSS_NATIVE' ? '' : policy.resumeSha256 || '', replyMode: policy.replyMode,
        sharePhone: policy.sharePhone, shareResume: policy.shareResume, historyMode: policy.historyMode, historyDays: policy.historyDays || 30 }),
    })
    const result = await readApiResponse<Policy>(response, '托管授权保存失败')
    if (!result.data) throw new Error('托管授权保存结果为空。')
    setPolicy(result.data)
    return result.data
  }

  async function command(operation: 'START' | 'PAUSE' | 'RESUME' | 'STOP') {
    const response = await sendChromeBridgeMessage({ type: `BOSS_HR_HOST_${operation}`, expectedProfileId: profileId,
      hrBackgroundProtocol: HR_BACKGROUND_PROTOCOL, ...(operation === 'START' || (operation === 'RESUME' && accountConfirmed) ? { accountBindingConfirmed: accountConfirmed } : {}) }, 30000)
    if (!response.success) throw new Error(response.message || '操作未确认，请核对连接状态。')
    const host = hostData(response.data)
    setRuntime(current => ({ ...current, host, hostError: '' }))
    return host
  }

  async function start() {
    if (!policy || settingsDirty || !confirmed || !accountConfirmed) return
    setBusy(true); setStatus('')
    try {
      const bridge = await getChromeBridgeStatus()
      if (!bridge.success || bridge.hrBackgroundProtocol !== HR_BACKGROUND_PROTOCOL) throw new Error('请重新加载 Chrome Bridge 1.10.0 并刷新工作台；当前扩展尚不支持后台托管。')
      const saved = await savePolicy(true)
      if (!saved.enabled || saved.authorizationValid !== true) throw new Error(saved.blockers?.join('；') || '托管授权尚未通过，请核对已保存的资料。')
      const host = await command('START')
      setStatus(host.state === 'RUNNING' ? '后台标签已连接，正在核对后端托管状态。' : host.state === 'BLOCKED' ? host.message || host.pauseReason || '账号或聊天页尚未核验，当前不会发送。' : '已开始后台准备，正在核对账号和聊天页；连接状态确认后才会处理消息。')
    } catch (e) { setStatus(friendlyApiError(e, '后台托管未启动')) }
    finally { setBusy(false) }
  }

  async function control(operation: 'PAUSE' | 'RESUME' | 'STOP') {
    setBusy(true); setStatus('')
    try {
      if (operation === 'STOP') {
        let stopError = ''
        try { await command('STOP') } catch (e) { stopError = friendlyApiError(e, '扩展停止未确认') }
        await savePolicy(false)
        if (stopError) setRuntime(current => ({ ...current, watch: null, hostError: stopError }))
        setConfirmed(false); setAccountConfirmed(false)
        setStatus(stopError ? `已撤销自动托管授权。${stopError}；请核对已触发步骤的回执。` : '已停止后台托管，并撤销自动托管授权。')
      } else {
        const host = await command(operation)
        setStatus(operation === 'PAUSE' ? '已暂停后台托管。' : host.state === 'RUNNING' ? '后台标签已恢复，正在核对后端托管状态。' : host.message || '正在重新核对账号、页面和已保存进度。')
      }
    } catch (e) { setStatus(friendlyApiError(e, '托管操作未完成')) }
    finally { setBusy(false) }
  }

  async function viewChat() {
    setBusy(true); setStatus('')
    try {
      const response = await sendChromeBridgeMessage({ type: 'BOSS_HR_HOST_VIEW', expectedProfileId: profileId, hrBackgroundProtocol: HR_BACKGROUND_PROTOCOL }, 5000)
      if (!response.success) throw new Error(response.message || '未能打开已绑定聊天页。')
      setStatus('已按你的点击显示托管聊天页，核对账号或完成验证后可返回工作台。')
    } catch (e) { setStatus(friendlyApiError(e, '查看托管页面失败')) }
    finally { setBusy(false) }
  }

  const host = runtime.host
  const active = host?.intentEnabled === true && host.state !== 'STOPPED'
  const accountReconfirmationRequired = host?.needsAccountConfirmation === true || host?.errorCode === 'ACCOUNT_RECONFIRM_REQUIRED'
  const paused = host?.state === 'PAUSED' || host?.state === 'BLOCKED' || accountReconfirmationRequired
  const bindingMatches = Boolean(host?.watchSessionId && host.hostGeneration && host.pageDocumentId
    && host.watchSessionId === runtime.watch?.watchSessionId && host.hostGeneration === runtime.watch.hostGeneration
    && host.pageDocumentId === runtime.watch.pageDocumentId)
  const running = host?.state === 'RUNNING' && !accountReconfirmationRequired && runtime.watch?.watching && runtime.watch.transport === 'CHROME_BACKGROUND' && bindingMatches && policy?.enabled && policy.authorizationValid === true
  const runtimeLabel = runtime.hostError ? '状态未确认' : accountReconfirmationRequired ? '等待重新核对 BOSS 账号' : host?.state === 'RUNNING' && !running ? '后台连接待核验' : host ? stateLabels[host.state] : '状态未确认'
  const availability = policy?.communicationProfile?.availability || ''
  const availabilityConflict = /随时|立即|马上/.test(availability) && /offer.{0,10}(两周|[1-9]\d*\s*(天|周|月))/i.test(availability)

  return <section className="space-y-3 rounded-lg border p-4">
    <h3 className="font-semibold">BOSS 一键后台托管</h3>
    <p className="text-sm">复用当前 Chrome 登录，在后台专用聊天标签中处理消息。Chrome 和标签需保持打开；你可以切换其他页面、最小化 Chrome 或继续使用桌面。</p>
    <div role="status" aria-live="polite" className="space-y-1 rounded border bg-muted/30 p-3 text-sm">
      <p>托管状态：{runtimeLabel}</p>
      <p>已核验 BOSS 账号：{host?.accountName || '尚未核验，开启时从聊天页读取'}</p>
      <p>后台标签：{host?.tabId ? `#${host.tabId}` : '尚未绑定'} · 最近读取页面：{timeLabel(host?.lastPageSeenAt || runtime.watch?.lastPageHeartbeatAt)}</p>
      <p>最近完成巡检：{timeLabel(host?.lastScanAt || runtime.watch?.lastSuccessfulScanAt)} · 下次巡检：{timeLabel(host?.nextScanAt)}</p>
      {runtime.hostError && <p className="text-amber-700">{runtime.hostError}</p>}
      {runtime.backendError && <p className="text-amber-700">{runtime.backendError}</p>}
      {(host?.pauseReason || host?.message) && <p className="text-amber-700">{host.pauseReason || host.message}</p>}
      {host?.errorCode && <p className="text-muted-foreground">处理原因：{host.errorCode}</p>}
    </div>
    {policy && <>
      <p className="text-sm">规则授权：{policy.enabled ? policy.authorizationValid === false ? '资料或规则需重新确认' : '已授权' : '未授权'}。授权与后台实际运行状态分别核验。</p>
      <fieldset className="space-y-3" disabled={busy || active}>
        <details><summary className="cursor-pointer text-sm">查看托管规则</summary><p className="whitespace-pre-wrap text-sm leading-6">{policy.rules}</p></details>
        <label className="block text-sm">回复方式 <select aria-label="回复方式" className="ml-2 rounded border p-2" value={policy.replyMode} onChange={e => { setPolicy({ ...policy, replyMode: e.target.value }); setConfirmed(false) }}>
          <option value="AUTO">普通对话自动回复，关键事项发 QQ</option>
          <option value="REVIEW">所有回复先发 QQ，逐条确认</option>
        </select></label>
        <p className="text-sm">当前沟通口径：期望薪资 {policy.communicationProfile?.expectedSalary || '待补充'}；地点 {policy.communicationProfile?.workLocation || '待补充'}；到岗 {policy.communicationProfile?.availability || '待补充'}；面试 {policy.communicationProfile?.interviewAvailability || '待补充'}。先保存下方沟通资料，再核对规则。</p>
        {availabilityConflict && <p className="text-sm text-amber-700">到岗资料同时包含立即到岗和等待 Offer 后的时间，请补充确认。系统保留原资料，相关到岗回复交给你在 QQ 确认。</p>}
        {policy.authorizationValid === false && <p className="text-sm text-amber-700">资料及规则核对完成后，点击一键开启将保存本次授权并启动后台托管。</p>}
        {policy.blockers?.map(reason => <p key={reason} className="text-sm text-amber-700">{reason}</p>)}
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={policy.sharePhone} onChange={e => { setPolicy({ ...policy, sharePhone: e.target.checked }); setConfirmed(false) }} />HR 明确索要时，允许发送已配置电话</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={policy.shareResume} onChange={e => { setPolicy({ ...policy, shareResume: e.target.checked }); setConfirmed(false) }} />HR 明确索要简历时，允许使用已授权简历；原生“发简历”仍逐条确认</label>
        <label className="block text-sm">已有消息 <select aria-label="已有消息处理" className="ml-2 rounded border p-2" value={policy.historyMode} onChange={e => { setPolicy({ ...policy, historyMode: e.target.value, historyDays: 30 }); setConfirmed(false) }}>
          <option value="RECENT">一并处理最近 30 天待回复会话</option><option value="NEW_ONLY">仅处理开启后的新消息</option>
        </select></label>
        {!active && <>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已核对当前档案资料、QQ 群与操作人、分享授权及已有消息范围，同意按所选模式处理和发送回复。</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accountConfirmed} onChange={e => setAccountConfirmed(e.target.checked)} />我确认当前 Chrome 的 BOSS 求职者账号属于本档案本人；开启时仍需读取并核验账号。</label>
        </>}
      </fieldset>
      {active && accountReconfirmationRequired && <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={accountConfirmed} onChange={e => setAccountConfirmed(e.target.checked)} />我已重新核对当前 Chrome 的 BOSS 求职者账号仍属于本档案本人，同意重新绑定并校验恢复。</label>}
      {settingsDirty && <p className="text-sm text-amber-700">请先保存沟通资料与 QQ 设置，再开启或恢复后台托管。</p>}
      {active && <p className="text-sm text-muted-foreground">需修改托管规则时先停止托管；暂停保留当前授权及进度。</p>}
      <div className="flex flex-wrap gap-2">
        {!active ? <Button type="button" disabled={busy || settingsDirty || !confirmed || !accountConfirmed} onClick={() => void start()}>{busy ? '正在处理…' : '一键开启后台托管'}</Button>
          : paused ? <Button type="button" disabled={busy || settingsDirty || policy.authorizationValid !== true || (accountReconfirmationRequired && !accountConfirmed)} onClick={() => void control('RESUME')}>恢复后台托管</Button>
            : <Button type="button" disabled={busy} onClick={() => void control('PAUSE')}>暂停后台托管</Button>}
        <Button type="button" variant="outline" disabled={busy || (!active && !policy.enabled)} onClick={() => void control('STOP')}>停止后台托管</Button>
        <Button type="button" variant="outline" disabled={busy || !host?.tabId} onClick={() => void viewChat()}>查看托管聊天页</Button>
      </div>
      <p className="text-sm">电脑休眠、Chrome 关闭、账号退出或页面验证会中断托管。连接恢复时先校验账号、页面和已保存进度；发送结果未知的记录不会自动重发。</p>
      <p className="text-xs text-muted-foreground">QQ 通知：待发送 {deliveries.PENDING || 0}，已确认 {deliveries.CONFIRMED || 0}，失败 {deliveries.FAILED || 0}，结果未知 {deliveries.UNKNOWN || 0}。结果未知不会自动重发，请核对群内消息。</p>
      <p className="text-sm">普通文字托管无需本地 PDF。电话和简历仅使用各自明确授权；面试安排、薪资承诺、未知事实等事项交给你处理。</p>
      {policy.facts && <details><summary className="text-sm">明确记住的个人事实</summary><p className="whitespace-pre-wrap text-sm">{policy.facts}</p></details>}
    </>}
    {status && <p role="status" className="text-sm">{status}</p>}
    <HrDutyActivity key={profileId} profileId={profileId} />
  </section>
}
