import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBossFilters } from './useBossFilters'
import { useBossJobs } from './useBossJobs'
import { useCsvExport } from './useCsvExport'
import { useBossDeliveryActions } from './useBossDeliveryActions'

const bridge = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/lib/chromeBridge', () => ({ sendChromeBridgeMessage: bridge.send }))

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); bridge.send.mockReset() })

function useWorkspace() {
  const filters = useBossFilters()
  const jobs = useBossJobs({ filters: filters.filters, buildFilterParams: filters.buildFilterParams, requestedScanRunId: 'history-run' })
  const csv = useCsvExport({ filters: filters.filters, activeScanRunId: 'history-run', buildFilterParams: filters.buildFilterParams })
  const actions = useBossDeliveryActions({ filters: filters.filters, activeScanRunId: 'history-run', page: jobs.page, size: jobs.size, loadList: jobs.loadList, refreshStats: async () => {}, clearLocalJobs: jobs.clearLocalJobs, clearStats: () => {}, openTextDialog: () => {} })
  return { filters, jobs, csv, actions }
}

describe('BOSS 岗位范围契约', () => {
  it('分页、导出和当前筛选预览都使用已应用条件，未提交草稿不扩大范围', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST' ? { success: true, nativeGreetingDisabledConfirmed: true, items: [] } : { items: [], total: 0, page: 2, size: 20 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:export'), revokeObjectURL: vi.fn() }))
    const { result } = renderHook(useWorkspace)
    act(() => result.current.filters.setDraftFilters(previous => ({ ...previous, keyword: '采购', location: '深圳' })))
    act(() => result.current.filters.applyFilters())
    act(() => result.current.filters.setDraftFilters(previous => ({ ...previous, keyword: '未应用新草稿', location: '北京' })))
    await act(async () => { await result.current.jobs.loadList(2, 20); await result.current.csv.exportCSV(); await result.current.actions.handleConfirmBatch() })
    const reads = fetchMock.mock.calls.filter(([, init]) => !init?.method)
    expect(reads).toHaveLength(2)
    for (const [input] of reads) {
      const query = new URL(String(input), 'http://localhost').searchParams
      expect(query.get('keyword')).toBe('采购')
      expect(query.get('location')).toBe('深圳')
      expect(query.get('scanRunId')).toBe('history-run')
    }
    expect(new URL(String(reads[0][0]), 'http://localhost').searchParams.get('page')).toBe('2')
    const [, preview] = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(preview?.body))).toMatchObject({ keyword: '采购', location: '深圳', scanRunId: 'history-run' })
    expect(bridge.send).not.toHaveBeenCalled()
  })

  it('全部 AI 推荐预览忽略列表筛选但保留扫描范围，空预览不创建或发送任务', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, nativeGreetingDisabledConfirmed: true, items: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(useWorkspace)
    act(() => result.current.filters.setDraftFilters(previous => ({ ...previous, keyword: '采购' })))
    act(() => result.current.filters.applyFilters())
    await act(async () => { await result.current.actions.handleConfirmAiRecommendedBatch() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/confirm-batch/preview')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ aiRecommendedOnly: true, scanRunId: 'history-run' })
    expect(bridge.send).not.toHaveBeenCalled()
  })

  it('刷新失败显示错误并保留上次成功岗位', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 9, jobName: '采购主管' }], total: 1, page: 1, size: 20 }))).mockResolvedValueOnce(new Response(JSON.stringify({ success: false, message: '服务暂时不可用' }), { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(useWorkspace)
    await act(async () => { await result.current.jobs.loadList() })
    await act(async () => { await result.current.jobs.loadList() })
    expect(result.current.jobs.loadError).toBe('服务暂时不可用')
    expect(result.current.jobs.items[0].jobName).toBe('采购主管')
    expect(result.current.jobs.lastUpdatedAt).not.toBeNull()
  })
})
