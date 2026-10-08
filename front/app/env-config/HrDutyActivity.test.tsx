import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import HrDutyActivity from './HrDutyActivity'
import { hasUnsavedChanges } from '@/lib/use-unsaved-changes'

type Row = { id: number; profileId: number; version: number; status: string; companyName: string; hrName: string; sourceMessage: string; draft: string }
const row = (id = 1, status = 'REVIEW_REQUIRED'): Row => ({ id, profileId: 4, version: 1, status, companyName: '合成公司' + id, hrName: 'HR' + id, sourceMessage: '你好', draft: '回复' + id })
const response = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { 'Content-Type': 'application/json' } })
function pageResponse(url: string, items: Row[], total = items.length, page?: number) {
  const parameters = new URL(url, 'http://localhost').searchParams
  const size = Number(parameters.get('size'))
  return response({ profileId: 4, view: parameters.get('view'), status: parameters.get('status'), q: parameters.get('q'), size, page: page ?? Number(parameters.get('page')), total, totalPages: Math.max(1, Math.ceil(total / size)), items })
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('keeps the legacy array endpoint and collapsed records with useful send and review counts', async () => {
  const fetchMock = vi.fn(async (url: string) => response(url.includes('proposals') ? [row(1, 'SENT_CONFIRMED')] : { activity: { counts: { SENT_CONFIRMED: 1, REVIEW_REQUIRED: 2 }, progress: { processed: 1, baseline_complete: 0 }, decisions: [] } }))
  vi.stubGlobal('fetch', fetchMock)
  const { container } = render(<HrDutyActivity profileId={4} />)
  await screen.findByText(/1 条 · 已发送 1 · 待你决定 2/)
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/proposals?includeClosed=true'))).toBe(true)
  expect(fetchMock.mock.calls.some(([url]) => url.includes('/proposals/page'))).toBe(false)
  expect(container.querySelector('details')).not.toHaveAttribute('open')
  expect(screen.getByText(/合成公司1/).closest('details')).not.toHaveAttribute('open')
})

it('applies edited filters explicitly and preserves reply drafts after searching and resetting', async () => {
  const review = row(1)
  const unknown = row(2, 'SEND_UNKNOWN')
  const fetchMock = vi.fn(async (url: string) => !url.includes('/proposals') ? response({ profileId: 4 }) : pageResponse(url, new URL(url, 'http://localhost').searchParams.get('q') ? [unknown] : [review, unknown]))
  vi.stubGlobal('fetch', fetchMock)
  render(<HrDutyActivity profileId={4} view="pending" />)
  await screen.findByText(/合成公司1/)
  expect(screen.getByText(/发送结果未知，请先核对/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('回复 HR1'), { target: { value: '核对后答复' } })
  const readsBeforeEditing = fetchMock.mock.calls.length
  fireEvent.change(screen.getByLabelText('搜索会话'), { target: { value: '未知' } })
  expect(screen.getByLabelText('回复 HR1')).toHaveValue('核对后答复')
  expect(fetchMock.mock.calls).toHaveLength(readsBeforeEditing)
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
  await waitFor(() => expect(screen.queryByLabelText('回复 HR1')).not.toBeInTheDocument())
  expect(screen.getByText('共 1 条')).toBeInTheDocument()
  expect(hasUnsavedChanges()).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }))
  expect(await screen.findByLabelText('回复 HR1')).toHaveValue('核对后答复')
  expect(screen.getByLabelText('搜索会话')).toHaveValue('')
  expect(screen.getByRole('button', { name: '确认发送' })).toBeDisabled()
})

it('uses server totals beyond 200 and keeps unapplied filters and drafts when paging', async () => {
  const first = Array.from({ length: 10 }, (_, index) => row(index + 1))
  const second = Array.from({ length: 10 }, (_, index) => row(index + 11))
  const fetchMock = vi.fn(async (url: string) => {
    if (!url.includes('/proposals')) return response({ profileId: 4 })
    return pageResponse(url, new URL(url, 'http://localhost').searchParams.get('page') === '2' ? second : first, 231)
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<HrDutyActivity profileId={4} view="pending" />)
  await screen.findByText('共 231 条')
  expect(screen.getByText('第 1 / 24 页')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('回复 HR1'), { target: { value: '跨页保留草稿' } })
  fireEvent.change(screen.getByLabelText('搜索会话'), { target: { value: '尚未应用的关键词' } })
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await screen.findByLabelText('回复 HR11')
  expect(screen.queryByLabelText('回复 HR1')).not.toBeInTheDocument()
  expect(screen.getByText('第 2 / 24 页')).toBeInTheDocument()
  const lastRead = fetchMock.mock.calls.filter(([url]) => url.includes('/proposals')).at(-1)![0]
  const parameters = new URL(lastRead, 'http://localhost').searchParams
  expect(Object.fromEntries(parameters)).toMatchObject({ profileId: '4', view: 'pending', q: '', status: 'ALL', page: '2', size: '10' })
  fireEvent.click(screen.getByRole('button', { name: '上一页' }))
  expect(await screen.findByLabelText('回复 HR1')).toHaveValue('跨页保留草稿')
  expect(screen.getByLabelText('搜索会话')).toHaveValue('尚未应用的关键词')
  expect(within(screen.getByLabelText('回复 HR1').closest('details')!).getByRole('button', { name: '确认发送' })).toBeDisabled()
  expect(hasUnsavedChanges()).toBe(true)
})

it('applies status and page size together and resets them to the first default page', async () => {
  const fetchMock = vi.fn(async (url: string) => !url.includes('/proposals') ? response({ profileId: 4 }) : pageResponse(url, [row(2, 'SEND_UNKNOWN')], 1))
  vi.stubGlobal('fetch', fetchMock)
  render(<HrDutyActivity profileId={4} view="history" />)
  await screen.findByText('共 1 条')
  const initialReads = fetchMock.mock.calls.length
  fireEvent.change(screen.getByLabelText('记录状态'), { target: { value: 'SEND_UNKNOWN' } })
  fireEvent.change(screen.getByLabelText('每页条数'), { target: { value: '25' } })
  expect(fetchMock.mock.calls).toHaveLength(initialReads)
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('status=SEND_UNKNOWN') && url.includes('size=25'))).toBe(true))
  await screen.findByText('共 1 条')
  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }))
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url.includes('/proposals')).at(-1)![0]).toContain('status=ALL'))
  expect(screen.getByLabelText('每页条数')).toHaveValue('10')
  expect(screen.getByLabelText('记录状态')).toHaveValue('ALL')
})

it('distinguishes a failed read from a successfully empty queue', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('合成连接中断') }))
  render(<HrDutyActivity profileId={4} view="pending" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('合成连接中断')
  expect(screen.queryByText('当前没有需要你处理的会话。')).not.toBeInTheDocument()
  expect(screen.queryByText(/上次成功读取/)).not.toBeInTheDocument()
})

it('retains the last page and locks sending after a failed page read, then retries the requested page', async () => {
  vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('2026/10/8 12:00:00')
  let failed = true
  const fetchMock = vi.fn(async (url: string) => {
    if (!url.includes('/proposals')) return response({ profileId: 4 })
    const page = Number(new URL(url, 'http://localhost').searchParams.get('page'))
    if (page === 2 && failed) throw new Error('合成翻页失败')
    return pageResponse(url, [row(page === 2 ? 11 : 1)], 20)
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<HrDutyActivity profileId={4} view="pending" />)
  await screen.findByLabelText('回复 HR1')
  expect(screen.getByRole('button', { name: '确认发送' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('下方保留上次读取的记录')
  expect(screen.getByLabelText('回复 HR1')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '确认发送' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '跳过' })).toBeDisabled()
  expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument()
  expect(screen.getByText(/上次成功读取：2026\/10\/8 12:00:00/)).toHaveTextContent('当前显示此时的记录快照')
  failed = false
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
  await screen.findByLabelText('回复 HR11')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument()
})

it('keeps retained records read-only after a polling failure', async () => {
  const timers = vi.spyOn(globalThis, 'setInterval')
  let failed = false
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (failed) throw new Error('合成轮询失败')
    return url.includes('/proposals') ? pageResponse(url, [row()]) : response({ profileId: 4 })
  }))
  render(<HrDutyActivity profileId={4} view="pending" />)
  await screen.findByLabelText('回复 HR1')
  failed = true
  const poll = timers.mock.calls.find(([, interval]) => interval === 15000)?.[0]
  await act(async () => { if (typeof poll === 'function') poll() })
  expect(await screen.findByRole('alert')).toHaveTextContent('下方保留上次读取的记录')
  expect(screen.getByRole('button', { name: '确认发送' })).toBeDisabled()
})

it('rejects a foreign profile page instead of exposing its records as an empty success', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => !url.includes('/proposals') ? response({ profileId: 4 }) : response({ profileId: 9, items: [{ ...row(), profileId: 9 }] })))
  render(<HrDutyActivity profileId={4} view="pending" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('回复记录档案不匹配')
  expect(screen.queryByText(/合成公司1/)).not.toBeInTheDocument()
  expect(screen.queryByText('当前没有需要你处理的会话。')).not.toBeInTheDocument()
})

it('locks retained replies when the policy read belongs to another profile while preserving editable drafts', async () => {
  const timers = vi.spyOn(globalThis, 'setInterval')
  let foreign = false
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/proposals') ? pageResponse(url, [row()]) : response({ profileId: foreign ? 9 : 4 })))
  render(<HrDutyActivity profileId={4} view="pending" />)
  await screen.findByLabelText('回复 HR1')
  foreign = true
  const poll = timers.mock.calls.find(([, interval]) => interval === 15000)?.[0]
  await act(async () => { if (typeof poll === 'function') poll() })
  expect(await screen.findByRole('alert')).toHaveTextContent('值班进度档案不匹配')
  expect(screen.getByRole('button', { name: '确认发送' })).toBeDisabled()
  expect(screen.getByLabelText('回复 HR1')).toBeEnabled()
  fireEvent.change(screen.getByLabelText('回复 HR1'), { target: { value: '错档时仍保留草稿' } })
  expect(screen.getByLabelText('回复 HR1')).toHaveValue('错档时仍保留草稿')
  expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled()
})

it('freezes an in-flight reply draft even when paging away and back, without changing the send protocol', async () => {
  let resolveSave!: (response: Response) => void
  const save = new Promise<Response>(resolve => { resolveSave = resolve })
  let savedDraft = '回复1'
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/action-token')) return response({ token: 'local-action-token' })
    if (init?.method === 'POST') return save
    if (!url.includes('/proposals')) return response({ profileId: 4 })
    const page = Number(new URL(url, 'http://localhost').searchParams.get('page'))
    return pageResponse(url, [page === 2 ? row(11) : { ...row(), draft: savedDraft }], 20)
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<HrDutyActivity profileId={4} view="pending" />)
  await screen.findByLabelText('回复 HR1')
  fireEvent.change(screen.getByLabelText('回复 HR1'), { target: { value: '正在保存的回复' } })
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
  expect(screen.getByLabelText('回复 HR1')).toBeDisabled()
  const action = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(JSON.parse(String(action[1]!.body))).toEqual({ expectedVersion: 1, draft: '正在保存的回复' })
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await screen.findByLabelText('回复 HR11')
  fireEvent.click(screen.getByRole('button', { name: '上一页' }))
  expect(await screen.findByLabelText('回复 HR1')).toBeDisabled()
  expect(screen.getByLabelText('回复 HR1')).toHaveValue('正在保存的回复')
  await act(async () => { savedDraft = '正在保存的回复'; resolveSave(response({})); await save })
  await waitFor(() => expect(screen.getByLabelText('回复 HR1')).toBeEnabled())
  expect(screen.getByLabelText('回复 HR1')).toHaveValue('正在保存的回复')
})
