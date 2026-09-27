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
  const [resume, setResume] = useState<{ name: string; sha: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    setPolicy(null); setResume(null); setConfirmed(false)
    fetch(`${API_BASE}/api/hr-assistant/autopilot`, { cache: 'no-store' })
      .then(r => readApiResponse<Policy>(r, '托管策略读取失败'))
      .then(r => { if (!cancelled && r.data) setPolicy({ ...r.data, replyMode: r.data.enabled ? r.data.replyMode : 'AUTO', historyMode: r.data.enabled ? r.data.historyMode : 'RECENT' }) })
      .catch(e => { if (!cancelled) setStatus(friendlyApiError(e, '托管策略读取失败')) })
    const refreshDeliveries = () => fetch(`${API_BASE}/api/hr-assistant/autopilot/deliveries`, { cache: 'no-store' })
      .then(r => readApiResponse<Record<string, number>>(r, '通知状态读取失败'))
      .then(r => { if (!cancelled && r.data) setDeliveries(r.data) }).catch(() => {})
    void refreshDeliveries()
    const timer = setInterval(() => void refreshDeliveries(), 15000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [profileId])

  async function selectResume(file?: File) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf') || file.size > 6_000_000) {
      setStatus('请选择不超过 6MB 的 PDF 简历，并确保 BOSS 已上传并选中同一文件。'); return
    }
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
      .map(v => v.toString(16).padStart(2, '0')).join('')
    setResume({ name: file.name, sha }); setConfirmed(false)
  }
  async function save(enabled: boolean) {
    if (!policy) return
    setBusy(true); setStatus('')
    try {
      const response = await localActionFetch(`${API_BASE}/api/hr-assistant/autopilot`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, expectedVersion: policy.version, enabled, rulesConfirmed: confirmed || !enabled,
          resumeName: resume?.name || policy.resumeName, resumeSha256: resume?.sha || policy.resumeSha256, replyMode: policy.replyMode, sharePhone: policy.sharePhone, shareResume: policy.shareResume, historyMode: policy.historyMode, historyDays: policy.historyDays || 30 }),
      })
      const result = await readApiResponse<Policy>(response, '托管授权保存失败')
      if (result.data) setPolicy({ ...policy, ...result.data, authorizationValid: true, blockers: [] })
      setStatus(enabled ? '值班规则已确认。请打开 BOSS 专用标签，核对账号后开始值班。' : '已关闭自动托管。')
    } catch (e) { setStatus(friendlyApiError(e, '托管授权保存失败')) }
    finally { setBusy(false) }
  }
  return <section className="space-y-3 rounded-lg border p-4">
    <h3 className="font-semibold">HR 自动回复设置</h3>
    {policy && <>
      <p className="whitespace-pre-wrap text-sm leading-6">{policy.rules}</p>
      <label className="block text-sm">回复方式 <select aria-label="回复方式" className="ml-2 rounded border p-2" value={policy.replyMode} onChange={e => { setPolicy({ ...policy, replyMode: e.target.value }); setConfirmed(false) }}>
        <option value="AUTO">确认规则后自动发送，关键事项问我</option><option value="REVIEW">逐条确认后发送</option>
      </select></label>
      <p className="text-sm">当前沟通口径：期望薪资 {policy.communicationProfile?.expectedSalary || '待补充'}；地点 {policy.communicationProfile?.workLocation || '待补充'}；到岗 {policy.communicationProfile?.availability || '待补充'}；面试 {policy.communicationProfile?.interviewAvailability || '待补充'}。先保存下方沟通资料，再确认规则。</p>
      {policy.authorizationValid === false && <p className="text-sm text-amber-700">授权尚未确认或资料发生变化；重新确认前不会自动发送。</p>}
      {policy.blockers?.map(reason => <p key={reason} className="text-sm text-amber-700">{reason}</p>)}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={policy.sharePhone} onChange={e => { setPolicy({ ...policy, sharePhone: e.target.checked }); setConfirmed(false) }} />HR 明确索要时，允许发送已配置电话</label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={policy.shareResume} onChange={e => { setPolicy({ ...policy, shareResume: e.target.checked }); setConfirmed(false) }} />HR 明确索要时，允许发送下方指定 PDF 简历</label>
      <label className="block text-sm">已有消息 <select aria-label="已有消息处理" className="ml-2 rounded border p-2" value={policy.historyMode} onChange={e => { setPolicy({ ...policy, historyMode: e.target.value, historyDays: 30 }); setConfirmed(false) }}>
        <option value="RECENT">一并处理最近 30 天待回复会话</option><option value="NEW_ONLY">仅处理开启后的新消息</option>
      </select></label>
      <p className="text-sm">状态：{policy.enabled ? policy.authorizationValid === false ? '授权待重新确认' : policy.paused ? '已暂停' : '已授权，是否值守以连接状态为准' : '尚未启用'}。普通回复静默，例外发到已配置 QQ 群。</p>
      {settingsDirty && <p className="text-sm text-amber-700">请先保存沟通资料与 QQ 设置，再核对并确认值班规则。</p>}
      <p className="text-xs text-muted-foreground">QQ 通知：待发送 {deliveries.PENDING || 0}，已确认 {deliveries.CONFIRMED || 0}，失败 {deliveries.FAILED || 0}，结果未知 {deliveries.UNKNOWN || 0}。结果未知不会自动重发，请核对群内消息。</p>
      <label className="block text-sm">指定自动发送的 PDF 简历
        <input type="file" accept="application/pdf,.pdf" className="mt-2 block" onChange={e => void selectResume(e.target.files?.[0])} />
      </label>
      <p className="text-xs text-muted-foreground">{resume?.name || policy.resumeName || '未指定（不影响普通文字回复）'}。仅核验文件指纹；发送前必须与 BOSS 已选中的附件一致；若页面无法提供原件核验，将交给你处理。微信、其他文件和证件需人工确认。</p>
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
