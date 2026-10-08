import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LiepinResults from '../liepin/analysis/AnalysisContent'
import Job51Results from '../51job/analysis/AnalysisContent'

vi.mock('./useExperimentalAnalysisSync', () => ({ useExperimentalAnalysisSync: () => false }))
beforeEach(() => vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe.each([['猎聘', LiepinResults], ['51job', Job51Results]] as const)('%s 首次岗位读取', (_name, Results) => {
  it('未完成读取时不出现零条或空结果', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    render(<Results />)
    expect(screen.getByText('正在读取岗位…')).toBeInTheDocument()
    expect(screen.queryByText(/共 0 条/)).not.toBeInTheDocument()
    expect(screen.queryByText(/当前范围暂无岗位/)).not.toBeInTheDocument()
  })
  it('读取失败时保留明确错误，不显示空结果', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, message: '测试服务不可用' }), { status: 503 })))
    render(<Results />)
    expect(await screen.findByText('岗位读取失败，请重新加载。')).toBeInTheDocument()
    expect(screen.queryByText(/共 0 条/)).not.toBeInTheDocument()
    expect(screen.queryByText(/当前范围暂无岗位/)).not.toBeInTheDocument()
  })
})
