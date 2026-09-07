import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sendChromeBridgeMessage, subscribeChromeBridgeEvents } from '@/lib/chromeBridge'
import { useZhilianAnalysisSync } from './useZhilianAnalysisSync'

vi.mock('@/lib/chromeBridge', () => ({ sendChromeBridgeMessage: vi.fn(), subscribeChromeBridgeEvents: vi.fn(() => vi.fn()) }))
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true, queueSize: 0 }) }))) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('扫描结束后 AI 仍在处理时继续刷新；隐藏或卸载后停止', async () => {
  vi.useFakeTimers()
  vi.mocked(sendChromeBridgeMessage).mockResolvedValue({ success: true, isRunning: false })
  const refresh = vi.fn(async () => {})
  const view = renderHook(() => useZhilianAnalysisSync(4, refresh, true))
  await act(async () => {})
  refresh.mockClear()
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(refresh).toHaveBeenCalledTimes(1)
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(refresh).toHaveBeenCalledTimes(1)
  visibility.mockRestore()
  view.unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('只响应当前档案的智联事件', async () => {
  vi.useFakeTimers()
  vi.mocked(sendChromeBridgeMessage).mockResolvedValue({ success: true })
  const refresh = vi.fn(async () => {})
  renderHook(() => useZhilianAnalysisSync(4, refresh, false))
  const event = vi.mocked(subscribeChromeBridgeEvents).mock.calls.at(-1)![0]
  await act(async () => { event({ payload: { platform: 'zhilian', profileId: 7 } }); await vi.advanceTimersByTimeAsync(250) })
  expect(refresh).not.toHaveBeenCalled()
  await act(async () => { event({ payload: { platform: 'zhilian', profileId: 4 } }); await vi.advanceTimersByTimeAsync(250) })
  expect(refresh).toHaveBeenCalledTimes(1)
})
