import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Page from './page'
import { sendChromeBridgeMessage, subscribeChromeBridgeEvents, type ChromeBridgeEvent } from '@/lib/chromeBridge'
import { validateSetupForPlatform } from '@/lib/setupChecklist'

vi.mock('@/lib/zhilian-page-status', () => ({ getZhilianPageStatus: async () => ({ connected: true, ready: true, message: 'Chrome 智联可用' }) }))
vi.mock('@/lib/setupChecklist', () => ({ validateSetupForPlatform: vi.fn(async () => ({ ready: true, missing: [] })), formatSetupMissingMessage: () => '' }))
vi.mock('@/lib/chromeBridge', () => ({ sendChromeBridgeMessage: vi.fn(async () => ({ success: true })), subscribeChromeBridgeEvents: vi.fn(() => () => {}) }))
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.clearAllMocks() })

it('配置页不再嵌入分析；启动后提供带档案与批次的独立结果入口', async () => {
  sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/config') ? {
    success: true, hasProfile: true, currentProfile: { id: 4, name: '测试档案' },
    config: { keywords: '["开发"]', cityCode: '489', salary: '0000,9999999', searchJobLimit: 20 },
    options: { city: [{ name: '全国', code: '489' }], salary: [{ name: '不限', code: '0000,9999999' }] },
  } : url.includes('/config/options/filters') ? {success:true,version:'2026-09-08',cityCode:'489',cityName:'全国',source:'https://fe-api.zhaopin.com/c/i/search/base/data',options:{}} : { success: true, data: { keywords: [] } } })))
  render(<Page />)
  await screen.findByText('Chrome 智联可用')
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(screen.queryByText('岗位列表')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '智联分析' })).toHaveAttribute('href', '/zhilian/analysis')
  const start = await screen.findByRole('button', { name: '开始扫描' })
  await waitFor(() => expect(start).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '20' }))
  const counts = screen.getAllByRole('option').map(option => Number(option.textContent))
  expect(counts).toEqual(Array.from({ length: 40 }, (_, index) => (index + 1) * 5))
  fireEvent.click(screen.getByRole('option', { name: '25' }))
  fireEvent.click(start)
  const link = await screen.findByRole('link', { name: '查看本次扫描结果' })
  expect(link.getAttribute('href')).toMatch(/\/zhilian\/analysis\?profileId=4&scanRunId=zhilian-/)
  expect(vi.mocked(sendChromeBridgeMessage).mock.calls.filter(([message]) => message.type === 'ZHILIAN_SCAN_START')).toHaveLength(1)
  expect(validateSetupForPlatform).toHaveBeenCalledWith('zhilian', { openPlatformPageIfMissing: true })
  expect(sendChromeBridgeMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ZHILIAN_SCAN_START', config: expect.objectContaining({ searchJobLimit: 25 }) }))
})

const partialResult = {
  success: true, profileId: 4, runId: 'zhilian-test-partial', isRunning: false, stage: 'complete', outcome: 'partial',
  keywordResults: [
    { keywordIndex: 1, keyword: '开发', collected: 3, historyDuplicates: 0, detailFailures: 0, stopReason: 'target_reached', outcome: 'complete' },
    { keywordIndex: 2, keyword: '运营', collected: 0, historyDuplicates: 19, detailFailures: 4, stopReason: 'timeout_safety_cap', outcome: 'failed' }
  ]
}

function stubConfig() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/config') ? {
    success: true, hasProfile: true, currentProfile: { id: 4, name: '测试档案' },
    config: { keywords: '["开发"]', cityCode: '489', searchJobLimit: 20 }, options: { city: [], salary: [] }
  } : url.includes('/config/options/filters') ? {success:true,options:{}} : {} })))
}

it('刷新后从扩展恢复部分完成结果和批次入口', async () => {
  stubConfig()
  vi.mocked(sendChromeBridgeMessage).mockImplementation(async message => message.type === 'ZHILIAN_SCAN_STATUS' ? partialResult : { success: true })
  render(<Page />)
  await screen.findByText('采集结果 · 部分完成')
  expect(screen.getByText(/未完成关键词：运营/)).toBeInTheDocument()
  expect(screen.getByText(/历史重复 19 个，同轮重复 0 个，详情失败 4 个/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '查看本次扫描结果' })).toHaveAttribute('href', '/zhilian/analysis?profileId=4&scanRunId=zhilian-test-partial')
  expect(screen.getByRole('button', { name: '开始扫描' })).toBeEnabled()
})

it('事件即时显示部分完成并拒绝其他档案的结果', async () => {
  stubConfig()
  vi.mocked(sendChromeBridgeMessage).mockResolvedValue({ success: true })
  let handler: ((event: ChromeBridgeEvent) => void) | undefined
  vi.mocked(subscribeChromeBridgeEvents).mockImplementation(callback => { handler = callback; return () => {} })
  render(<Page />)
  await screen.findByText('测试档案')
  act(() => handler?.({ payload: { ...partialResult, profileId: 99, platform: 'zhilian', operation: 'scan' } }))
  expect(screen.queryByText('采集结果 · 部分完成')).not.toBeInTheDocument()
  act(() => handler?.({ payload: { ...partialResult, platform: 'zhilian', operation: 'scan' } }))
  await screen.findByText('采集结果 · 部分完成')
})

it('状态轮询不恢复其他档案的采集结果', async () => {
  stubConfig()
  vi.mocked(sendChromeBridgeMessage).mockResolvedValue({ ...partialResult, profileId: 99 })
  render(<Page />)
  await screen.findByText('测试档案')
  await waitFor(() => expect(sendChromeBridgeMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ZHILIAN_SCAN_STATUS' }), 2000))
  expect(screen.queryByLabelText('关键词采集结果')).not.toBeInTheDocument()
})

it('同档案旧批次事件不能覆盖新批次结果', async () => {
  stubConfig()
  vi.mocked(sendChromeBridgeMessage).mockResolvedValue({ success: true })
  let handler: ((event: ChromeBridgeEvent) => void) | undefined
  vi.mocked(subscribeChromeBridgeEvents).mockImplementation(callback => { handler = callback; return () => {} })
  render(<Page />)
  await screen.findByText('测试档案')
  act(() => handler?.({ payload: { ...partialResult, runId: 'zhilian-200', platform: 'zhilian', operation: 'scan' } }))
  await screen.findByText('采集结果 · 部分完成')
  act(() => handler?.({ payload: { ...partialResult, runId: 'zhilian-100', outcome: 'complete', keywordResults: [], platform: 'zhilian', operation: 'scan' } }))
  expect(screen.getByText('采集结果 · 部分完成')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '查看本次扫描结果' })).toHaveAttribute('href', '/zhilian/analysis?profileId=4&scanRunId=zhilian-200')
})

it('扩展暂时离线时刷新仍保留本档案关键词结束原因', async () => {
  stubConfig()
  localStorage.setItem('getjobs-scan-result:zhilian:4', JSON.stringify(partialResult))
  vi.mocked(sendChromeBridgeMessage).mockResolvedValue({success:false,message:'扩展离线'})
  const first = render(<Page />)
  expect(await screen.findByText('采集结果 · 部分完成')).toBeInTheDocument()
  expect(screen.getByText(/已达到关键词时间上限/)).toBeInTheDocument()
  first.unmount()
  render(<Page />)
  expect(await screen.findByText('采集结果 · 部分完成')).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'继续未完成关键词'})).toBeEnabled()
})
