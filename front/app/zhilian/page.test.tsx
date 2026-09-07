import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Page from './page'
import { sendChromeBridgeMessage } from '@/lib/chromeBridge'

vi.mock('@/lib/zhilian-page-status', () => ({ getZhilianPageStatus: async () => ({ connected: true, ready: true, message: 'Chrome 智联可用' }) }))
vi.mock('@/lib/setupChecklist', () => ({ validateSetupForPlatform: async () => ({ ready: true, missing: [] }), formatSetupMissingMessage: () => '' }))
vi.mock('@/lib/chromeBridge', () => ({ sendChromeBridgeMessage: vi.fn(async () => ({ success: true })), subscribeChromeBridgeEvents: () => () => {} }))
afterEach(() => vi.unstubAllGlobals())

it('配置页不再嵌入分析；启动后提供带档案与批次的独立结果入口', async () => {
  sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/config') ? {
    success: true, hasProfile: true, currentProfile: { id: 4, name: '测试档案' },
    config: { keywords: '["开发"]', cityCode: '489', salary: '0000,9999999', searchJobLimit: 20 },
    options: { city: [{ name: '全国', code: '489' }], salary: [{ name: '不限', code: '0000,9999999' }] },
  } : { success: true, data: { keywords: [] } } })))
  render(<Page />)
  await screen.findByText('Chrome 智联可用')
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(screen.queryByText('岗位列表')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '智联分析' })).toHaveAttribute('href', '/zhilian/analysis')
  const start = await screen.findByRole('button', { name: '开始扫描' })
  await waitFor(() => expect(start).toBeEnabled())
  fireEvent.click(start)
  const link = await screen.findByRole('link', { name: '查看本次扫描结果' })
  expect(link.getAttribute('href')).toMatch(/\/zhilian\/analysis\?profileId=4&scanRunId=zhilian-/)
  expect(vi.mocked(sendChromeBridgeMessage).mock.calls.filter(([message]) => message.type === 'ZHILIAN_SCAN_START')).toHaveLength(1)
})
