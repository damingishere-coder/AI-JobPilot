import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import CrmWorkbench from './CrmWorkbench'

vi.mock('./ProfileSwitcher', async () => {
  const { useEffect } = await import('react')
  return { default: function FixtureProfile({ onProfileChange }: { onProfileChange: (profile: { id: number }) => void }) {
    useEffect(() => onProfileChange({ id: 1 }), [onProfileChange]); return <span>虚构档案</span>
  } }
})
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('makes an unknown count link to the identical bucket and labels current stock separately from today', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ profileId: 1, day: '2026-09-14', generatedAt: '2026-09-14T01:00:00Z', timezone: 'Asia/Shanghai', counts: [{ bucket: 'UNKNOWN', label: '结果未知待对账', count: 2, actionRequired: true }, { bucket: 'DISCOVERED_TODAY', label: '今日新发现', count: 0, actionRequired: false }] }) }))
  render(<CrmWorkbench />)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  const link = screen.getByRole('link', { name: /结果未知待对账 2/ })
  expect(link).toHaveAttribute('href', '/opportunities?bucket=UNKNOWN')
  expect(screen.getByText(/其他分组为当前存量/)).toBeInTheDocument()
})
it('does not turn an API failure into a zero count', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
  render(<CrmWorkbench />)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.queryByText('目前没有到期待处理事项')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /结果未知待对账/ })).not.toBeInTheDocument()
})
it('finishes a timed-out request with a visible retry path', async () => {
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })))
  render(<CrmWorkbench />)
  await act(async () => { await vi.advanceTimersByTimeAsync(8001) })
  expect(screen.getByRole('alert')).toHaveTextContent('读取超时')
  expect(screen.getByText('刷新工作台')).toBeEnabled()
})
it('loads once in a hidden tab but skips background polling', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ profileId: 1, day: '2026-09-14', generatedAt: '2026-09-14T01:00:00Z', counts: [] }) })
  vi.stubGlobal('fetch', fetch)
  render(<CrmWorkbench />)
  await act(async () => { await vi.advanceTimersByTimeAsync(30001) })
  expect(fetch).toHaveBeenCalledTimes(1)
})
