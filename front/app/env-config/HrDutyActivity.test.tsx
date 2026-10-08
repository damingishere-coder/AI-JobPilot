import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import HrDutyActivity from './HrDutyActivity'
afterEach(() => vi.unstubAllGlobals())
it('keeps reply records collapsed while showing useful send and review counts', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ success: true, data: url.includes('proposals') ? [{ id: 1, profileId: 4, version: 1, status: 'SENT_CONFIRMED', companyName: '合成公司', hrName: '合成 HR', sourceMessage: '你好', draft: '您好' }] : { activity: { counts: { SENT_CONFIRMED: 1, REVIEW_REQUIRED: 2 }, progress: { processed: 1, baseline_complete: 0 }, decisions: [] } } }), { headers: { 'Content-Type': 'application/json' } })))
  const { container } = render(<HrDutyActivity profileId={4} />)
  await screen.findByText(/1 条 · 已发送 1 · 待你决定 2/)
  expect(container.querySelector('details')).not.toHaveAttribute('open')
  expect(screen.getByText(/合成公司/).closest('details')).not.toHaveAttribute('open')
})

it('defaults the work queue to human decisions and unknown outcomes and preserves edits across searching', async () => {
  const rows = [
    { id: 1, profileId: 4, version: 1, status: 'REVIEW_REQUIRED', companyName: '待审公司', hrName: '小王', sourceMessage: '什么时候到岗', draft: '两周后' },
    { id: 2, profileId: 4, version: 1, status: 'SEND_UNKNOWN', companyName: '未知公司', hrName: '小李', sourceMessage: '请联系', draft: '好的' },
    { id: 3, profileId: 4, version: 1, status: 'SENT_CONFIRMED', companyName: '已发公司', hrName: '小陈', sourceMessage: '你好', draft: '您好' },
  ]
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ success: true, data: url.includes('proposals') ? rows : {} }), { headers: { 'Content-Type': 'application/json' } })))
  render(<HrDutyActivity profileId={4} view="pending" />)
  await screen.findByText(/待审公司/)
  expect(screen.queryByText(/已发公司/)).not.toBeInTheDocument()
  expect(screen.getByText(/发送结果未知，请先核对/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('回复 小王'), { target: { value: '核对后答复' } })
  fireEvent.change(screen.getByLabelText('搜索会话'), { target: { value: '未知' } })
  expect(screen.queryByLabelText('回复 小王')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('搜索会话'), { target: { value: '' } })
  expect(screen.getByLabelText('回复 小王')).toHaveValue('核对后答复')
  expect(screen.getByRole('button', { name: '确认发送' })).toBeDisabled()
})

it('distinguishes a failed read from a successfully empty queue', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('合成连接中断') }))
  render(<HrDutyActivity profileId={4} view="pending" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('合成连接中断')
  expect(screen.queryByText('当前没有需要你处理的会话。')).not.toBeInTheDocument()
})

it('keeps retained records read-only after a polling failure', async () => {
  const timers = vi.spyOn(globalThis, 'setInterval')
  let failed = false
  const row = { id: 1, profileId: 4, version: 1, status: 'REVIEW_REQUIRED', companyName: '合成公司', hrName: '小王', sourceMessage: '你好', draft: '您好' }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (failed) throw new Error('合成轮询失败')
    return new Response(JSON.stringify({ success: true, data: url.includes('proposals') ? [row] : {} }), { headers: { 'Content-Type': 'application/json' } })
  }))
  render(<HrDutyActivity profileId={4} view="pending" />)
  await screen.findByText(/合成公司/)
  expect(screen.getByRole('button', { name: '确认发送' })).toBeEnabled()
  failed = true
  const poll = timers.mock.calls.find(([, interval]) => interval === 15000)?.[0]
  await act(async () => { if (typeof poll === 'function') poll() })
  expect(await screen.findByRole('alert')).toHaveTextContent('下方保留上次读取的记录')
  expect(screen.getByRole('button', { name: '确认发送' })).toBeDisabled()
  timers.mockRestore()
})
