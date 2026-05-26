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

export function sendChromeBridgeMessage<T = unknown>(payload: Record<string, unknown>, timeout = 30000): Promise<ChromeBridgeResponse<T>> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ success: false, message: '当前环境不支持Chrome扩展通信。' })
  }

  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      resolve({ success: false, message: 'Chrome扩展未响应，请确认已加载 Get Jobs Chrome Bridge。' })
    }, timeout)

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return
      const data = event.data as ChromeBridgeMessageEnvelope<T>
      if (!data || data.source !== TARGET || data.requestId !== requestId) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(data.response || { success: false, message: 'Chrome扩展返回为空。' })
    }

    window.addEventListener('message', onMessage)
    window.postMessage({ ...payload, source: SOURCE, requestId }, '*')
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

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window) return
    const data = event.data as ChromeBridgeEvent & { source?: string }
    if (!data || data.source !== TARGET || data.type !== 'GET_JOBS_EXTENSION_EVENT') return
    handler(data)
  }

  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
