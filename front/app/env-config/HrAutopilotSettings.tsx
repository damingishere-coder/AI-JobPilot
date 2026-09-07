'use client'

import { useEffect, useState } from 'react'
import { API_BASE, localActionFetch, readApiResponse, friendlyApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'

type Policy = { version: number; enabled: boolean; paused: boolean; resumeName: string; resumeSha256: string; rules: string; facts: string }

export default function HrAutopilotSettings({ profileId }: { profileId: number }) {
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
      .then(r => { if (!cancelled && r.data) setPolicy(r.data) })
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
          resumeName: resume?.name || policy.resumeName, resumeSha256: resume?.sha || policy.resumeSha256 }),
      })
      const result = await readApiResponse<Policy>(response, '托管授权保存失败')
      if (result.data) setPolicy(result.data)
      setStatus(enabled ? '托管规则已确认。请在 BOSS 助手打开专用标签，再点击开始值守；第一轮历史只整理。' : '已关闭自动托管。')
    } catch (e) { setStatus(friendlyApiError(e, '托管授权保存失败')) }
    finally { setBusy(false) }
  }
  return <section className="space-y-3 rounded-lg border p-4">
    <h3 className="font-semibold">AI 托管授权</h3>
    {policy && <>
      <p className="whitespace-pre-wrap text-sm leading-6">{policy.rules}</p>
      <p className="text-sm">状态：{policy.enabled ? policy.paused ? '已暂停' : '已授权，是否值守以连接状态为准' : '尚未启用'}。普通回复静默，例外发到已配置 QQ 群。</p>
      <p className="text-xs text-muted-foreground">QQ 通知：待发送 {deliveries.PENDING || 0}，已确认 {deliveries.CONFIRMED || 0}，失败 {deliveries.FAILED || 0}，结果未知 {deliveries.UNKNOWN || 0}。结果未知不会自动重发，请核对群内消息。</p>
      <label className="block text-sm">指定自动发送的 PDF 简历
        <input type="file" accept="application/pdf,.pdf" className="mt-2 block" onChange={e => void selectResume(e.target.files?.[0])} />
      </label>
      <p className="text-xs text-muted-foreground">{resume?.name || policy.resumeName || '尚未指定文件'}。仅核验文件指纹；发送前必须与 BOSS 已选中的附件一致；若页面无法提供原件核验，将交给你处理。微信、其他文件和证件需人工确认。</p>
      {policy.facts && <details><summary className="text-sm">明确记住的个人事实</summary><p className="whitespace-pre-wrap text-sm">{policy.facts}</p></details>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已核对上方托管边界、下方 QQ 群和操作人，以及指定简历；同意仅处理启用后的新消息。</label>
      <div className="flex gap-2">
        <Button type="button" disabled={busy || !confirmed} onClick={() => void save(true)}>确认托管规则</Button>
        <Button type="button" variant="outline" disabled={busy || !policy.enabled} onClick={() => void save(false)}>关闭托管</Button>
      </div>
    </>}
    <p role="status" className="text-sm">{status}</p>
  </section>
}
