import { getChromeBridgeStatus, sendChromeBridgeMessage } from '@/lib/chromeBridge'

export type ZhilianPageStatus = {
  connected: boolean
  ready: boolean
  message: string
}

export async function getZhilianPageStatus(): Promise<ZhilianPageStatus> {
  try {
    const bridge = await getChromeBridgeStatus()
    if (!bridge.success) return { connected: false, ready: false, message: bridge.message || 'Chrome扩展未连接，请加载或重新加载扩展。' }
    const status = await sendChromeBridgeMessage({ type: 'ZHILIAN_PAGE_STATUS', platform: 'zhilian' }, 8000)
    const ready = status.success === true && status.chromePageReady === true
      && !status.hasLoginPrompt && !status.hasSecurityPrompt
    return {
      connected: true,
      ready,
      message: status.hasSecurityPrompt ? '智联页面需要安全验证，请在 Chrome 中完成后重新检查。'
        : status.hasLoginPrompt ? '智联页面需要登录，请在 Chrome 中登录后重新检查。'
        : ready ? 'Chrome 中的智联页面可用，扫描时会再次检查目标页。'
        : status.message ? `${status.message}；若扩展刚更新，请重新加载扩展并刷新智联页面。`
        : '无法确认智联页面状态，请打开智联招聘页面，重新加载扩展后再检查。',
    }
  } catch {
    return { connected: false, ready: false, message: 'Chrome扩展状态检查失败，请重新检查连接。' }
  }
}
