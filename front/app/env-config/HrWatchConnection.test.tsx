import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import HrWatchConnection from './HrWatchConnection'
import { HR_BACKGROUND_PROTOCOL } from './HrAutopilotSettings'
import { getChromeBridgeStatus, sendChromeBridgeMessage } from '@/lib/chromeBridge'

vi.mock('@/lib/chromeBridge', () => ({
  getChromeBridgeStatus: vi.fn(), sendChromeBridgeMessage: vi.fn(),
  REQUIRED_BACKGROUND_VERSION: 'background-test', REQUIRED_RUNTIME_PROTOCOL: 'runtime-test',
}))
beforeEach(() => { vi.mocked(getChromeBridgeStatus).mockResolvedValue({ success: true }) })
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('shows the bound profile and opens chat through the extension without starting watch', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {
    watching: true, profileId: 2, currentProfileId: 2, currentProfileName: '求职者乙',
    profileSwitchBlocked: true, chromeBridge: { tabId: 77, tabBound: true },
  } }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(sendChromeBridgeMessage).mockResolvedValue({ success: true })
  render(<HrWatchConnection />)
  expect(await screen.findByText(/求职者乙/)).toBeInTheDocument()
  expect(screen.getByText('绑定标签页：#77')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '打开 BOSS 专用值班页' }))
  expect(await screen.findByText(/已打开聊天页/)).toBeInTheDocument()
  expect(sendChromeBridgeMessage).toHaveBeenCalledWith({ type: 'BOSS_HR_OPEN_CHAT' }, 5000)
  expect(fetchMock.mock.calls.every(([url]) => String(url).endsWith('/status'))).toBe(true)
})

it('distinguishes a missing backend from an unavailable extension and offers the fixed fallback URL', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
  vi.mocked(getChromeBridgeStatus).mockResolvedValue({ success: false })
  render(<HrWatchConnection />)
  expect(await screen.findByText(/当前后端缺少 BOSS 值守功能/)).toBeInTheDocument()
  expect(screen.getByText(/Chrome 扩展：未连接/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '直接在浏览器打开' })).toHaveAttribute('href', 'https://www.zhipin.com/web/geek/chat?getjobs-autopilot=1')
})

it('starts a bounded review from the workbench without asking the user to select an HR', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ success: true, data: { watching: false, currentProfileId: 4 } }), { headers: { 'Content-Type': 'application/json' } })))
  vi.mocked(getChromeBridgeStatus).mockResolvedValue({ success: true, hrReviewProtocol: HR_BACKGROUND_PROTOCOL, version: 'background-test', runtimeProtocol: 'runtime-test' })
  vi.mocked(sendChromeBridgeMessage).mockResolvedValue({ success: true })
  render(<HrWatchConnection />)
  const start = await screen.findByRole('button', { name: '开始三个会话测试' })
  await vi.waitFor(() => expect(start).toBeEnabled())
  fireEvent.click(start)
  expect(await screen.findByText(/已开始：系统自动打开/)).toBeInTheDocument()
  expect(sendChromeBridgeMessage).toHaveBeenCalledWith({ type: 'BOSS_HR_TRIAL_START', expectedProfileId: 4, hrReviewProtocol: HR_BACKGROUND_PROTOCOL }, 30000)
})

it('refuses the old extension before starting review work', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ success: true, data: { watching: false, currentProfileId: 4 } }), { headers: { 'Content-Type': 'application/json' } })))
  vi.mocked(getChromeBridgeStatus).mockResolvedValue({ success: true, hrReviewProtocol: '2026-09-28-hr-review-identity', version: 'background-test', runtimeProtocol: 'runtime-test' })
  render(<HrWatchConnection />)
  const start = await screen.findByRole('button', { name: '开始三个会话测试' })
  await vi.waitFor(() => expect(start).toBeEnabled())
  fireEvent.click(start)
  expect(await screen.findByText(/当前扩展尚不支持工作台启动/)).toBeInTheDocument()
  expect(sendChromeBridgeMessage).not.toHaveBeenCalled()
})
