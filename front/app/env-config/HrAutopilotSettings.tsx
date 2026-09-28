'use client'

import { useEffect, useState } from 'react'
import { API_BASE, localActionFetch, readApiResponse, friendlyApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import HrDutyActivity from './HrDutyActivity'

type Policy = { version: number; enabled: boolean; paused: boolean; resumeName: string; resumeSha256: string; rules: string; facts: string; replyMode: string; sharePhone: boolean; shareResume: boolean; historyMode: string; historyDays: number; authorizationValid?: boolean; blockers?: string[]; communicationProfile?: Record<string, string> }

export default function HrAutopilotSettings({ profileId, settingsDirty = false }: { profileId: number; settingsDirty?: boolean }) {
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [deliveries, setDeliveries] = useState<Record<string, number>>({})
  useEffect(() => {
    let cancelled = false
    setPolicy(null); setConfirmed(false)
    fetch(`${API_BASE}/api/hr-assistant/autopilot`, { cache: 'no-store' })
      .then(r => readApiResponse<Policy>(r, '托管策略读取失败'))
      .then(r => { if (!cancelled && r.data) setPolicy({ ...r.data, replyMode: 'REVIEW', historyMode: r.data.enabled ? r.data.historyMode : 'RECENT' }) })
      .catch(e => { if (!cancelled) setStatus(friendlyApiError(e, '托管策略读取失败')) })
    const refreshDeliveries = () => fetch(`${API_BASE}/api/hr-assistant/autopilot/deliveries`, { cache: 'no-store' })
      .then(r => readApiResponse<Record<string, number>>(r, '通知状态读取失败'))
      .then(r => { if (!cancelled && r.data) setDeliveries(r.data) }).catch(() => {})
    void refreshDeliveries()
    const timer = setInterval(() => void refreshDeliveries(), 15000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [profileId])

  async function save(enabled: boolean) {
    if (!policy) return
    setBusy(true); setStatus('')
    try {
      const response = await localActionFetch(`${API_BASE}/api/hr-assistant/autopilot`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, expectedVersion: policy.version, enabled, rulesConfirmed: confirmed || !enabled,
          resumeName: policy.shareResume ? 'BOSS_NATIVE' : '', resumeSha256: '', replyMode: policy.replyMode, sharePhone: policy.sharePhone, shareResume: policy.shareResume, historyMode: policy.historyMode, historyDays: policy.historyDays || 30 }),
      })
      const result = await readApiResponse<Policy>(response, '托管授权保存失败')
      if (result.data) setPolicy({ ...policy, ...result.data, authorizationValid: true, blockers: [] })
      setStatus(enabled ? '值班规则已确认。请打开 BOSS 专用标签，核对账号后开始值班。' : '已关闭自动托管。')
    } catch (e) { setStatus(friendlyApiError(e, '托管授权保存失败')) }
    finally { setBusy(false) }
  }
  return <section className="space-y-3 rounded-lg border p-4">
    <h3 className="font-semibold">HR 回复确认设置</h3>
    {policy && <>
      <p className="whitespace-pre-wrap text-sm leading-6">{policy.rules}</p>
      <label className="block text-sm">回复方式 <select aria-label="回复方式" className="ml-2 rounded border p-2" value={policy.replyMode} onChange={e => { setPolicy({ ...policy, replyMode: e.target.value }); setConfirmed(false) }}>
        <option value="REVIEW">原话与建议发 QQ，逐条确认后发送</option>
      </select></label>
      <p className="text-sm">当前沟通口径：期望薪资 {policy.communicationProfile?.expectedSalary || '待补充'}；地点 {policy.communicationProfile?.workLocation || '待补充'}；到岗 {policy.communicationProfile?.availability || '待补充'}；面试 {policy.communicationProfile?.interviewAvailability || '待补充'}。先保存下方沟通资料，再确认规则。</p>
      {policy.authorizationValid === false && <p className="text-sm text-amber-700">授权尚未确认或资料发生变化；重新确认前不会自动发送。</p>}
      {policy.blockers?.map(reason => <p key={reason} className="text-sm text-amber-700">{reason}</p>)}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={policy.sharePhone} onChange={e => { setPolicy({ ...policy, sharePhone: e.target.checked }); setConfirmed(false) }} />HR 明确索要时，允许发送已配置电话</label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={policy.shareResume} onChange={e => { setPolicy({ ...policy, shareResume: e.target.checked }); setConfirmed(false) }} />HR 明确索要简历时，建议点击 BOSS「发简历」，由我逐条确认</label>
      <label className="block text-sm">已有消息 <select aria-label="已有消息处理" className="ml-2 rounded border p-2" value={policy.historyMode} onChange={e => { setPolicy({ ...policy, historyMode: e.target.value, historyDays: 30 }); setConfirmed(false) }}>
        <option value="RECENT">一并处理最近 30 天待回复会话</option><option value="NEW_ONLY">仅处理开启后的新消息</option>
      </select></label>
      <p className="text-sm">状态：{policy.enabled ? policy.authorizationValid === false ? '授权待重新确认' : policy.paused ? '已暂停' : '已授权，是否值守以连接状态为准' : '尚未启用'}。本阶段所有回复建议先发 QQ 确认，不自动回复 HR。</p>
      {settingsDirty && <p className="text-sm text-amber-700">请先保存沟通资料与 QQ 设置，再核对并确认值班规则。</p>}
      <p className="text-xs text-muted-foreground">QQ 通知：待发送 {deliveries.PENDING || 0}，已确认 {deliveries.CONFIRMED || 0}，失败 {deliveries.FAILED || 0}，结果未知 {deliveries.UNKNOWN || 0}。结果未知不会自动重发，请核对群内消息。</p>
      <p className="text-sm">简历直接使用 BOSS 聊天框下方的“发简历”按钮，不上传本地文件。弹窗、附件选择或发送回执不明确时交给你处理。</p>
      <p className="text-sm">先测试：点击“开始三个会话测试”，系统自动打开 HR 会话并把原话和建议发到 QQ。采集后等待你确认，再自动选中对应 HR 回发；不会继续读取其他会话。</p>
      {policy.facts && <details><summary className="text-sm">明确记住的个人事实</summary><p className="whitespace-pre-wrap text-sm">{policy.facts}</p></details>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已核对当前档案资料、QQ 群与操作人、分享授权及已有消息范围，同意按所选模式处理和发送回复。</label>
      <div className="flex gap-2">
        <Button type="button" disabled={busy || settingsDirty || !confirmed} onClick={() => void save(true)}>确认值班规则</Button>
        <Button type="button" variant="outline" disabled={busy || !policy.enabled} onClick={() => void save(false)}>关闭托管</Button>
      </div>
    </>}
    <p role="status" className="text-sm">{status}</p>
    <HrDutyActivity key={profileId} profileId={profileId} />
  </section>
}
