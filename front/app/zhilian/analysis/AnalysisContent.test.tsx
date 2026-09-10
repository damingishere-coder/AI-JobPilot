import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AnalysisContent from './AnalysisContent'
import { sendChromeBridgeMessage } from '@/lib/chromeBridge'
vi.mock('@/lib/chromeBridge', () => ({ sendChromeBridgeMessage: vi.fn() }))

vi.mock('./useZhilianAnalysisSync', () => ({ useZhilianAnalysisSync: () => false }))
vi.mock('@/components/communication/GreetingDraftDialog', () => ({ GreetingDraftDialog: ({ job, onConfirm }: { job: unknown; onConfirm: (value: { finalGreeting: string }) => Promise<void> }) => job ? <div>投递确认对话框<button onClick={() => void onConfirm({ finalGreeting: '已审核话术' })}>确认执行</button></div> : null }))

const stats = { kpi: { total: 25, delivered: 0, waitingConfirm: 1, pending: 0, filtered: 0, failed: 0 },
  overview: { aiAvgScore: 96, priorityCompanyCount: 25, missingLinkCount: 25, missingSalaryCount: 0 },
  charts: { byStatus: [], byCity: [], byCompany: [], byExperience: [], byDegree: [], salaryBuckets: [] } }
const list = (title = '测试岗位') => ({ items: [{ id: 1, jobId: 'job-1', jobTitle: title, deliveryStatus: '待确认', aiScore: 80 }], total: 25, page: 1, size: 20 })
const response = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, "alert").mockImplementation(() => {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => vi.unstubAllGlobals())

it('列表和统计使用相同档案、批次和筛选；点击岗位先打开确认框', async () => {
  const fetcher = vi.fn(async (url: string) => response(url.includes('/stats?') ? stats : list()))
  vi.stubGlobal('fetch', fetcher)
  render(<AnalysisContent profileId={4} activeScanRunId="run-4" showHeader />)
  await waitFor(() => expect(screen.getAllByText('测试岗位').length).toBeGreaterThan(0))
  expect(fetcher.mock.calls.every(([url]) => new URL(url, "http://127.0.0.1:6866").searchParams.get('profileId') === '4')).toBe(true)
  expect(fetcher.mock.calls.every(([url]) => new URL(url, "http://127.0.0.1:6866").searchParams.get('scanRunId') === 'run-4')).toBe(true)
  fireEvent.change(screen.getByPlaceholderText('公司或岗位关键词'), { target: { value: '开发' } })
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.includes('keyword=')).length).toBe(2))
  fireEvent.click(screen.getAllByRole('button', { name: 'Chrome投递' })[0])
  expect(screen.getByText('投递确认对话框')).toBeInTheDocument()
  expect(fetcher.mock.calls.every(([url]) => !url.includes('/confirm'))).toBe(true)
}, 15000)

it('HTTP 失败显示重试，不把失败伪装成空库', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ message: '服务暂时不可用' }, false)))
  render(<AnalysisContent profileId={4} showHeader />)
  expect(await screen.findByRole('alert')).toHaveTextContent('服务暂时不可用')
  expect(screen.queryByText('当前档案暂无智联岗位，请返回智联配置开始扫描。')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
})

it('较早筛选请求的迟到响应不会覆盖新结果', async () => {
  const pending: Array<(data: ReturnType<typeof response>) => void> = []
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('keyword=')) return Promise.resolve(response(url.includes('/stats?') ? stats : list('新筛选结果')))
    return new Promise(resolve => pending.push(resolve))
  }))
  render(<AnalysisContent profileId={4} />)
  fireEvent.change(screen.getByPlaceholderText('公司或岗位关键词'), { target: { value: '新' } })
  await waitFor(() => expect(screen.getAllByText('新筛选结果').length).toBeGreaterThan(0))
  await act(async () => { pending[0](response(list('旧筛选结果'))); pending[1](response(stats)) })
  expect(screen.queryByText('旧筛选结果')).not.toBeInTheDocument()
})


it('确认请求断网时不自动重发，不调用 Chrome 投递', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/confirm')) throw new Error('response lost')
    return response(url.includes('/stats?') ? stats : list())
  })
  vi.stubGlobal('fetch', fetcher)
  render(<AnalysisContent profileId={4} />)
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Chrome投递' }).length).toBeGreaterThan(0))
  fireEvent.click(screen.getAllByRole('button', { name: 'Chrome投递' })[0])
  fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
  await waitFor(() => expect(window.alert).toHaveBeenCalled())
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/confirm'))).toHaveLength(1)
  expect(sendChromeBridgeMessage).not.toHaveBeenCalled()
})

it('Chrome 返回未知结果时只回写 UNKNOWN，不重复投递', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/confirm')) return response({ success: true, task: { id: 1, requestKey: 'request-1' } })
    if (url.endsWith('/delivery-result')) return response({ success: true })
    return response(url.includes('/stats?') ? stats : list())
  })
  vi.stubGlobal('fetch', fetcher)
  vi.mocked(sendChromeBridgeMessage).mockResolvedValue({ success: false, persisted: false, message: '结果未知' })
  render(<AnalysisContent profileId={4} />)
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Chrome投递' }).length).toBeGreaterThan(0))
  fireEvent.click(screen.getAllByRole('button', { name: 'Chrome投递' })[0])
  fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('结果未知'))
  expect(sendChromeBridgeMessage).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/delivery-result'))).toHaveLength(1)
})

it('图表默认折叠并位于岗位列表之后，可以展开再收起', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('/stats?') ? stats : list())))
  render(<AnalysisContent profileId={4} />)
  const table = await screen.findByRole('table', { name: '智联岗位列表' })
  const charts = screen.getByRole('region', { name: '分析图表' })
  expect(table.compareDocumentPosition(charts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const toggle = screen.getByRole('button', { name: /展开图表/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('投递状态分布')).not.toBeInTheDocument()
  fireEvent.click(toggle)
  expect(screen.getByText('投递状态分布')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /收起图表/ }))
  expect(screen.queryByText('投递状态分布')).not.toBeInTheDocument()
})

it('不感兴趣使用跳过接口，移出待确认并保留记录，不调用Chrome或删除接口', async () => {
  let skipped = false
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/skip?')) { skipped = true; return response({ success: true }) }
    return response(url.includes('/stats?') ? stats : { ...list(), items: [{ ...list().items[0], deliveryStatus: skipped ? '已跳过' : '待确认' }] })
  })
  vi.stubGlobal('fetch', fetcher)
  render(<AnalysisContent profileId={4} />)
  fireEvent.click((await screen.findAllByRole('button', { name: '不感兴趣' }))[0])
  await waitFor(() => expect(screen.queryByRole('button', { name: '不感兴趣' })).not.toBeInTheDocument())
  expect(screen.getByText(/标记为不感兴趣/)).toBeInTheDocument()
  expect(fetcher).toHaveBeenCalledWith('/api/zhilian/jobs/1/skip?profileId=4', expect.objectContaining({ method: 'POST' }))
  expect(fetcher.mock.calls.filter(([url]) => url.includes('/skip?'))).toHaveLength(1)
  expect(sendChromeBridgeMessage).not.toHaveBeenCalled()
})

it('跳过失败保留待确认岗位，不自动重发写入', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/skip?')) return response({ success: false, message: '投递已经开始，无法跳过' })
    return response(url.includes('/stats?') ? stats : list())
  })
  vi.stubGlobal('fetch', fetcher)
  render(<AnalysisContent profileId={4} />)
  fireEvent.click((await screen.findAllByRole('button', { name: '不感兴趣' }))[0])
  expect(await screen.findByText('投递已经开始，无法跳过')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: '不感兴趣' })).toHaveLength(2)
  expect(fetcher.mock.calls.filter(([url]) => url.includes('/skip?'))).toHaveLength(1)
})

it('匹配理由解析JSON为摘要和风险，列表使用宽列而不是挤压所有字段', async () => {
  const aiReason = JSON.stringify({ summary: '有真实的内容运营经验', risks: ['缺少保险行业经验'], strengths: ['内容制作'] })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('/stats?') ? stats : { ...list(), items: [{ ...list().items[0], aiReason }] })))
  render(<AnalysisContent profileId={4} />)
  await screen.findAllByText('有真实的内容运营经验')
  expect(screen.queryByText(aiReason)).not.toBeInTheDocument()
  expect(screen.getByText('缺少保险行业经验')).toBeInTheDocument()
  expect(screen.getByRole('table', { name: '智联岗位列表' })).toHaveClass('table-fixed', 'min-w-[1120px]')
  expect(screen.getAllByRole('columnheader')).toHaveLength(5)
})
