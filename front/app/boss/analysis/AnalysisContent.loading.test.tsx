import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AnalysisContent from './AnalysisContent'

vi.mock('@/components/communication/DeliveryRecovery', () => ({ DeliveryRecovery: () => null }))
vi.mock('./components/BossThresholdSettings', () => ({ BossThresholdSettings: () => null }))
vi.mock('./components/BossDeliveryHistory', () => ({ BossDeliveryHistory: () => null }))

afterEach(() => vi.unstubAllGlobals())

describe('BOSS 首次读取状态', () => {
  it('接口成功前不显示零条、空岗位或空 AI 队列，成功空响应后才显示空范围', async () => {
    const pending: Array<() => void> = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => new Promise<Response>(resolve => {
      const url = String(input)
      const value = url.includes('job-analysis/tasks') ? { success: true, data: [], queueSize: 0, pendingCount: 0, processingCount: 0 } : url.includes('/stats?') ? { kpi: {}, charts: { byStatus: [], byCity: [], byIndustry: [], byCompany: [], byExperience: [], byDegree: [], salaryBuckets: [], dailyTrend: [], hrActivity: [] } } : { items: [], total: 0, page: 1, size: 20 }
      pending.push(() => resolve(new Response(JSON.stringify(value))))
    })))
    render(<AnalysisContent />)
    expect(screen.getByText('队列读取中…')).toBeInTheDocument()
    expect(screen.getByText('正在读取岗位…')).toBeInTheDocument()
    expect(screen.queryByText(/共 0 条/)).not.toBeInTheDocument()
    expect(screen.queryByText('排队中 0')).not.toBeInTheDocument()
    expect(screen.queryByText(/当前范围没有岗位/)).not.toBeInTheDocument()
    await act(async () => { pending.forEach(resolve => resolve()) })
    expect(screen.getByText('排队中 0')).toBeInTheDocument()
    expect(screen.getByText(/当前范围没有岗位/)).toBeInTheDocument()
  })

  it('首次接口失败不显示零条或无岗位，队列失败也不假定为零', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, message: '测试接口不可用' }), { status: 503 })))
    render(<AnalysisContent />)
    expect(await screen.findByText('岗位读取失败，请重新加载。')).toBeInTheDocument()
    expect(screen.getByText('队列读取失败')).toBeInTheDocument()
    expect(screen.queryByText(/共 0 条/)).not.toBeInTheDocument()
    expect(screen.queryByText('排队中 0')).not.toBeInTheDocument()
    expect(screen.queryByText(/当前范围没有岗位/)).not.toBeInTheDocument()
  })
})
