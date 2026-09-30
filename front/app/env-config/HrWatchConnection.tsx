'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { API_BASE, readApiResponse, friendlyApiError } from '@/lib/api'
import { getChromeBridgeStatus, sendChromeBridgeMessage, REQUIRED_BACKGROUND_VERSION, REQUIRED_RUNTIME_PROTOCOL } from '@/lib/chromeBridge'
import { HR_BACKGROUND_PROTOCOL } from './HrAutopilotSettings'

type WatchStatus = {
  watching: boolean
  scanRunning?: boolean
  reviewReady?: boolean
  reviewCount?: number
  replyMode?: string
  profileId?: number
  currentProfileId?: number
  currentProfileName?: string
  profileSwitchBlocked?: boolean
  chromeBridge?: { tabId?: number; tabBound?: boolean }
}

export default function HrWatchConnection() {
  const [watch, setWatch] = useState<WatchStatus | null>(null)
  const [backendError, setBackendError] = useState('正在检查值守后端…')
  const [extension, setExtension] = useState(false)
  const [opening, setOpening] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let disposed = false
    let busy = false
    const refresh = async () => {
      if (busy) return
      busy = true
      try {
        const [backend, bridge] = await Promise.allSettled([
          (async () => {
            const response = await fetch(`${API_BASE}/api/hr-assistant/status`, { cache: 'no-store' })
            if (response.status === 404) throw new Error('当前后端缺少 BOSS 值守功能（HTTP 404），请使用包含值守功能的服务版本。')
            const result = await readApiResponse<WatchStatus>(response, '值守后端检查失败')
            if (!result.data || typeof result.data.watching !== 'boolean') throw new Error('值守接口响应格式不兼容，请更新前后端版本。')
            return result.data
          })(),
          getChromeBridgeStatus(),
        ])
        if (disposed) return
        setExtension(bridge.status === 'fulfilled' && bridge.value.success)
        if (backend.status === 'fulfilled') {
          setWatch(backend.value)
          setBackendError('')
        } else {
          setWatch(null)
          setBackendError(friendlyApiError(backend.reason, '无法连接值守后端'))
        }
      } finally { busy = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [])

  const openChat = async () => {
    setOpening(true)
    try {
      const response = await sendChromeBridgeMessage({ type: 'BOSS_HR_OPEN_CHAT' }, 5000)
      setMessage(response.success ? '已打开聊天页。可回到这里开始三个会话测试，系统自动选中 HR。' : response.message || '扩展未响应，请使用下方直接打开链接。')
    } catch (error) {
      setMessage(friendlyApiError(error, '打开聊天页失败，请使用下方直接打开链接。'))
    } finally { setOpening(false) }
  }

  const trial = async (stop = false) => {
    setOpening(true); setMessage('')
    try {
      const bridge = await getChromeBridgeStatus()
      const protocol = HR_BACKGROUND_PROTOCOL
      if (!bridge.success || bridge.hrReviewProtocol !== protocol || bridge.version !== REQUIRED_BACKGROUND_VERSION || bridge.runtimeProtocol !== REQUIRED_RUNTIME_PROTOCOL) throw new Error('请重新加载 1.10.0 或更新版 Chrome Bridge，并刷新工作台；当前扩展尚不支持工作台启动。')
      const response = await sendChromeBridgeMessage({ type: stop ? 'BOSS_HR_TRIAL_STOP' : 'BOSS_HR_TRIAL_START', expectedProfileId: watch?.currentProfileId, hrReviewProtocol: protocol }, 30000)
      if (!response.success) throw new Error(response.message || '启动未确认，请查看当前状态，不要重复点击。')
      setMessage(stop ? '已停止试运行和确认回发。' : '已开始：系统自动打开并读取最近三个待回复会话，建议发到 QQ。采集后保留确认回发连接，无需手动选 HR。')
      const status = await fetch(`${API_BASE}/api/hr-assistant/status`, { cache: 'no-store' })
      const result = await readApiResponse<WatchStatus>(status, '状态读取失败')
      if (result.data) setWatch(result.data)
    } catch (error) { setMessage(friendlyApiError(error, '操作未完成')) }
    finally { setOpening(false) }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={opening || !extension || !!backendError || !watch?.currentProfileId || watch?.watching} onClick={() => void trial()}>
          {opening ? '正在处理…' : '开始三个会话测试'}
        </Button>
        {watch?.watching && watch.replyMode === 'TRIAL_REVIEW' && <Button type="button" variant="outline" disabled={opening} onClick={() => void trial(true)}>停止测试</Button>}
        <Button type="button" disabled={opening} onClick={() => void openChat()}>
          {opening ? '正在打开…' : '打开 BOSS 专用值班页'}
        </Button>
        <a className="text-sm text-primary underline" href="https://www.zhipin.com/web/geek/chat?getjobs-autopilot=1" target="_blank" rel="noopener noreferrer">直接在浏览器打开</a>
      </div>
      <div role="status" className="space-y-1 text-sm">
        <p>{backendError || `值守后端可用 · ${watch?.reviewReady ? `本轮已生成 ${watch.reviewCount || 0}/3 张确认卡；系统已连接，确认后自动选中 HR 回发` : watch?.scanRunning ? '正在自动读取 HR 会话' : watch?.watching ? '值守中' : '已停止'}`}</p>
        {watch?.reviewReady && (watch.reviewCount || 0) < 3 && <p>最近候选中不足三个可处理的待回复会话，已回复、明确结束及已处理的消息不会补发。请核对本轮实际卡片数量。</p>}
        <p className="text-muted-foreground">先发建议到 QQ，只有你确认的内容才发送。每次发送至少间隔 10 秒；本轮采集完成后不再读取其他会话。</p>
        <p>Chrome 扩展：{extension ? '已连接' : '未连接，请加载或刷新投递牛马 Chrome Bridge 扩展，再刷新此页面。'}</p>
        <p>当前人物档案：{watch?.currentProfileName || '尚未读取'}{watch?.profileId ? ` · 值守档案 ID：${watch.profileId}` : ''}</p>
        <p>绑定标签页：{watch?.chromeBridge?.tabBound ? `#${watch.chromeBridge.tabId}` : '未绑定'}</p>
        {watch?.profileSwitchBlocked && <p>请先停止值守再切换人物档案；正在执行的采集或发送需要先处理完成。</p>}
        <p className="text-muted-foreground">切换人物档案不会切换 BOSS 登录账号。请确认聊天页登录的是对应求职者。</p>
        {message && <p>{message}</p>}
      </div>
    </div>
  )
}
