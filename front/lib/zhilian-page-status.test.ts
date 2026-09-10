import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getChromeBridgeStatus, sendChromeBridgeMessage } from './chromeBridge'
import { getZhilianPageStatus } from './zhilian-page-status'
import { formatSetupMissingMessage, validateSetupForPlatform } from './setupChecklist'

vi.mock('./chromeBridge', () => ({ getChromeBridgeStatus: vi.fn(), sendChromeBridgeMessage: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getChromeBridgeStatus).mockResolvedValue({ success: true })
  vi.mocked(sendChromeBridgeMessage).mockResolvedValue({ success: true, chromePageReady: true })
})

describe('智联 Chrome 状态', () => {
  it('主动启动允许自动开页，并留出加载时间；登录和安全验证仍阻止扫描', async () => {
    vi.mocked(sendChromeBridgeMessage).mockResolvedValue({ success: true, chromePageReady: true, hasLoginPrompt: true })
    expect((await getZhilianPageStatus({ openIfMissing: true })).ready).toBe(false)
    expect(sendChromeBridgeMessage).toHaveBeenCalledWith({ type: 'ZHILIAN_PAGE_STATUS', platform: 'zhilian', openIfMissing: true }, 35000)
  })
  it('Chrome 可用时不再读取后端浏览器登录状态', async () => {
    const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/api/ready')
      ? { ready: true, status: "UP" } : { success: true, data: { introduce: '简介', prompt: '分析', resumeText: '简历' } } }))
    vi.stubGlobal('fetch', fetcher)
    const result = await validateSetupForPlatform('zhilian')
    expect(result.ready).toBe(true)
    expect(fetcher.mock.calls.some(([url]) => url.includes('login-status'))).toBe(false)
    expect(sendChromeBridgeMessage).toHaveBeenCalledWith({ type: 'ZHILIAN_PAGE_STATUS', platform: 'zhilian' }, 8000)
  })

  it.each([
    [{ success: true, hasLoginPrompt: true }, '登录'],
    [{ success: true, chromePageReady: true, hasSecurityPrompt: true }, '安全验证'],
    [{ success: true, chromePageReady: false, message: '页面正在加载' }, '加载'],
    [{ success: false, message: '未知消息类型' }, '重新加载扩展'],
    [{ success: true }, '无法确认'],
  ])('不会把扩展响应当成可用登录态：%j', async (response, text) => {
    vi.mocked(sendChromeBridgeMessage).mockResolvedValue(response)
    const result = await getZhilianPageStatus()
    expect(result.ready).toBe(false)
    expect(result.message).toContain(text)
  })

  it('未连接不继续查询；错误提示保留原因', async () => {
    vi.mocked(getChromeBridgeStatus).mockResolvedValue({ success: false, message: '扩展未连接' })
    expect((await getZhilianPageStatus()).connected).toBe(false)
    expect(sendChromeBridgeMessage).not.toHaveBeenCalled()
    expect(formatSetupMissingMessage('智联招聘', [{ key: 'zhilianLogin', title: '智联登录状态', done: false, state: 'warning', detail: '需要安全验证', actionLabel: '检查', href: '/zhilian' }])).toContain('需要安全验证')
  })
})
