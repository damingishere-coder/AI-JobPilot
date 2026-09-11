export type ChromeBridgeResponse<T = unknown> = {
  success: boolean
  message?: string
  version?: string
  rawMessage?: string
  data?: T
  [key: string]: unknown
}

const SOURCE = 'GET_JOBS_PAGE'
const TARGET = 'GET_JOBS_EXTENSION'
export const REQUIRED_BACKGROUND_VERSION = '2026-09-11-boss-resume-lifecycle'
const SCAN_START_TYPES = new Set(['BOSS_SCAN_START', 'ZHILIAN_SCAN_START'])
const ALLOWED_BRIDGE_ORIGINS = new Set([
  'http://localhost:6866',
  'http://127.0.0.1:6866',
])

export type ChromeBridgeEvent = {
  type?: string
  payload?: {
    platform?: string
    type?: string
    message?: string
    timestamp?: number
    [key: string]: unknown
  }
  version?: string
  [key: string]: unknown
}

type ChromeBridgeMessageEnvelope<T = unknown> = {
  source?: string
  requestId?: string
  type?: string
  response?: ChromeBridgeResponse<T>
}

export async function sendChromeBridgeMessage<T = unknown>(payload: Record<string, unknown>, timeout = 30000): Promise<ChromeBridgeResponse<T>> {
  if (SCAN_START_TYPES.has(String(payload.type))) {
    const status = await sendBridgeRequest({ type: 'GET_JOBS_EXTENSION_PING' }, 3000)
    if (!status.success) return { success: false, message: status.message || 'Chrome扩展未连接，请先检查扩展连接。' }
    if (status.version !== REQUIRED_BACKGROUND_VERSION) {
      return {
        success: false,
        errorCode: 'EXTENSION_RELOAD_REQUIRED',
        version: status.version,
        message: `Chrome中运行的招聘扩展后台需要更新（当前：${status.version || '未知'}，需要：${REQUIRED_BACKGROUND_VERSION}）。请打开 chrome://extensions，找到“投递牛马 Chrome Bridge”点击重新加载，再刷新BOSS/智联页面及工作台。仅刷新招聘页面不能更新扩展后台。`,
      }
    }
  }
  return sendBridgeRequest<T>(payload, timeout)
}

function sendBridgeRequest<T = unknown>(payload: Record<string, unknown>, timeout = 30000): Promise<ChromeBridgeResponse<T>> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ success: false, message: '当前环境不支持Chrome扩展通信。' })
  }

  const targetOrigin = getBridgeTargetOrigin()
  if (!targetOrigin) {
    return Promise.resolve({ success: false, message: '当前页面来源不允许连接 Chrome Bridge。' })
  }

  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      resolve({ success: false, message: 'Chrome扩展未响应，请确认已加载 投递牛马 Chrome Bridge。' })
    }, timeout)

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return
      if (event.origin !== targetOrigin) return
      const data = event.data as ChromeBridgeMessageEnvelope<T>
      if (!data || data.source !== TARGET || data.requestId !== requestId) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(data.response || { success: false, message: 'Chrome扩展返回为空。' })
    }

    window.addEventListener('message', onMessage)
    window.postMessage({ ...payload, source: SOURCE, requestId }, targetOrigin)
  })
}

export async function pingChromeBridge(): Promise<boolean> {
  const res = await sendChromeBridgeMessage({ type: 'GET_JOBS_EXTENSION_PING' }, 1500)
  return !!res.success
}

export async function getChromeBridgeStatus(): Promise<ChromeBridgeResponse> {
  return sendChromeBridgeMessage({ type: 'GET_JOBS_EXTENSION_PING' }, 1500)
}

export function subscribeChromeBridgeEvents(handler: (event: ChromeBridgeEvent) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const targetOrigin = getBridgeTargetOrigin()
  if (!targetOrigin) return () => {}

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window) return
    if (event.origin !== targetOrigin) return
    const data = event.data as ChromeBridgeEvent & { source?: string }
    if (!data || data.source !== TARGET || data.type !== 'GET_JOBS_EXTENSION_EVENT') return
    handler(data)
  }

  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}

function getBridgeTargetOrigin(): string {
  if (typeof window === 'undefined') return ''
  const origin = window.location.origin
  return ALLOWED_BRIDGE_ORIGINS.has(origin) ? origin : ''
}
