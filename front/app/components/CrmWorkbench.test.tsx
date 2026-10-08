import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import CrmWorkbench from './CrmWorkbench'

vi.mock('./ProfileSwitcher', async () => {
  const { useEffect } = await import('react')
  return { default: function FixtureProfile({ onProfileChange }: { onProfileChange: (profile: { id: number }) => void }) {
    useEffect(() => onProfileChange({ id: 1 }), [onProfileChange]); return <button onClick={() => onProfileChange({ id: 2 })}>切换虚构档案</button>
  } }
})
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const summary = (profileId = 1) => ({ profileId, day: '2026-09-14', generatedAt: '2026-09-14T01:00:00Z', timezone: 'Asia/Shanghai', counts: [] })
const hrPage = (profileId = 1, total = 0) => ({ profileId, view: 'pending', status: 'ALL', q: '', page: 1, size: 3, total, totalPages: Math.max(1, Math.ceil(total / 3)), items: Array.from({ length: Math.min(3, total) }, (_, index) => ({ id: index + 1, profileId, jobName: `合成HR岗位${index + 1}`, companyName: '虚构公司', status: ['REVIEW_REQUIRED', 'SEND_UNKNOWN', 'BLOCKED'][index], updatedAt: null, draft: '私密草稿不能出现在首页', sourceMessage: '私密原消息不能出现在首页', confirmationCode: '不能展示的确认码' })) })
const response = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, headers: new Headers({ 'Content-Type': 'application/json' }), text: async () => JSON.stringify(data), json: async () => data })
function mockReads(workbench: object | ((url: string, options: RequestInit) => unknown), hr: object | ((url: string, options: RequestInit) => unknown) = response({ success: true, data: hrPage() })) {
  const fetch = vi.fn((url: string, options: RequestInit) => {
    const selected = String(url).includes('/proposals/page') ? hr : workbench
    return Promise.resolve(typeof selected === 'function' ? selected(url, options) : selected)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
it('makes an unknown count link to the identical bucket and labels current stock separately from today', async () => {
  mockReads(response({ ...summary(), counts: [{ bucket: 'UNKNOWN', label: '结果未知待对账', count: 2, actionRequired: true }, { bucket: 'DISCOVERED_TODAY', label: '今日新发现', count: 0, actionRequired: false }] }))
  render(<CrmWorkbench />)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  const link = screen.getByRole('link', { name: /结果未知待对账 2/ })
  expect(link).toHaveAttribute('href', '/opportunities?bucket=UNKNOWN')
  expect(screen.getByText(/其他分组为当前存量/)).toBeInTheDocument()
})
it('does not turn an API failure into a zero count', async () => {
  mockReads(response({}, false))
  render(<CrmWorkbench />)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.queryByText('目前没有到期待处理事项')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /结果未知待对账/ })).not.toBeInTheDocument()
})
it('finishes a timed-out request with a visible retry path', async () => {
  mockReads((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  }))
  render(<CrmWorkbench />)
  await act(async () => { await vi.advanceTimersByTimeAsync(8001) })
  expect(screen.getByRole('alert')).toHaveTextContent('读取超时')
  expect(screen.getByText('刷新工作台')).toBeEnabled()
})
it('loads once in a hidden tab but skips background polling', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  const fetch = mockReads(response(summary()))
  render(<CrmWorkbench />)
  await act(async () => { await vi.advanceTimersByTimeAsync(30001) })
  expect(fetch.mock.calls.filter(([url]) => url.includes('/api/workbench'))).toHaveLength(1)
  expect(fetch.mock.calls.filter(([url]) => url.includes('/proposals/page'))).toHaveLength(1)
})
it('opens concrete interview preparation tasks in the matching detail tab with their time and round', async () => {
  mockReads(response({ ...summary(), counts: [{ bucket: 'INTERVIEW_PREPARE', label: '七天内面试待准备', count: 1, actionRequired: true, preview: [{ id: 7, job_name: '合成采购岗', company_name: '虚构公司', platform: 'boss', location: '上海', interview_round: 2, interview_at: '2030-01-01T01:00:00Z', interview_prepared: 1 }] }] }))
  render(<CrmWorkbench />)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  const link = screen.getByRole('link', { name: /合成采购岗/ })
  expect(link).toHaveAttribute('href', '/opportunities?bucket=INTERVIEW_PREPARE&id=7&tab=interviews')
  expect(link).toHaveTextContent('第 2 轮')
  expect(link).toHaveTextContent('准备 1/4 项')
})

it('loads HR counts and three task previews from one read while hiding private reply contents', async () => {
  const fetch = mockReads(response(summary()), response({ success: true, data: hrPage(1, 4) }))
  render(<CrmWorkbench />)
  expect(screen.getByRole('link', { name: /HR 待我处理 读取中/ })).toHaveAttribute('href', '/hr')
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  const region = within(screen.getByRole('region', { name: 'HR 待我处理' }))
  expect(region.getByRole('link', { name: 'HR 待我处理 4' })).toHaveAttribute('href', '/hr')
  expect(region.getAllByRole('link', { name: /打开 HR 沟通处理/ })).toHaveLength(3)
  expect(region.getByText(/避免重复发送/)).toBeInTheDocument()
  expect(region.getAllByText('更新：时间未知')).toHaveLength(3)
  expect(screen.queryByText(/私密|不能展示的确认码/)).not.toBeInTheDocument()
  const reads = fetch.mock.calls.filter(([url]) => url.includes('/proposals/page'))
  expect(reads).toHaveLength(1)
  const query = new URL(reads[0][0], 'http://localhost').searchParams
  expect(Object.fromEntries(query)).toEqual({ profileId: '1', view: 'pending', status: 'ALL', q: '', page: '1', size: '3' })
  expect(reads[0][1].method).toBeUndefined()
})

it('keeps successful HR task metadata on refresh failure and marks the new count unknown', async () => {
  let failed = false
  mockReads(response(summary()), () => failed ? response({ success: false, message: '合成读取失败' }, false) : response({ success: true, data: hrPage(1, 4) }))
  render(<CrmWorkbench />)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  failed = true
  fireEvent.click(screen.getByRole('button', { name: '刷新工作台' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  const region = within(screen.getByRole('region', { name: 'HR 待我处理' }))
  expect(region.getByRole('alert')).toHaveTextContent('数量未知')
  expect(region.getByText(/当前显示上次读取的 4 条待办快照/)).toBeInTheDocument()
  expect(region.getAllByRole('link', { name: /打开 HR 沟通处理/ })).toHaveLength(3)
  expect(region.queryByText('当前没有需要你处理的 HR 会话。')).not.toBeInTheDocument()
})

it('rejects an HR page from another profile without rendering its tasks', async () => {
  mockReads(response(summary()), response({ success: true, data: hrPage(2, 4) }))
  render(<CrmWorkbench />)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  const region = within(screen.getByRole('region', { name: 'HR 待我处理' }))
  expect(region.getByRole('alert')).toHaveTextContent('档案不匹配')
  expect(region.queryByText('合成HR岗位1 · 虚构公司')).not.toBeInTheDocument()
  expect(region.queryByText('当前没有需要你处理的 HR 会话。')).not.toBeInTheDocument()
})

it('ignores a late HR response after switching profiles and shows the new profiles empty state', async () => {
  let resolveOld!: (value: unknown) => void
  mockReads(response(summary()), url => new URL(url, 'http://localhost').searchParams.get('profileId') === '1'
    ? new Promise(resolve => { resolveOld = resolve }) : response({ success: true, data: hrPage(2) }))
  render(<CrmWorkbench />)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  fireEvent.click(screen.getByRole('button', { name: '切换虚构档案' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  await act(async () => { resolveOld(response({ success: true, data: hrPage(1, 4) })) })
  const region = within(screen.getByRole('region', { name: 'HR 待我处理' }))
  expect(region.getByText('当前没有需要你处理的 HR 会话。')).toBeInTheDocument()
  expect(region.getByRole('link', { name: 'HR 待我处理 0' })).toBeInTheDocument()
  expect(region.queryByText('合成HR岗位1 · 虚构公司')).not.toBeInTheDocument()
})

it('continues showing HR tasks when the opportunity summary fails', async () => {
  mockReads(response({}, false), response({ success: true, data: hrPage(1, 4) }))
  render(<CrmWorkbench />)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(screen.getByRole('alert')).toHaveTextContent('未将读取失败记作零')
  expect(screen.getByRole('link', { name: 'HR 待我处理 4' })).toBeInTheDocument()
})
