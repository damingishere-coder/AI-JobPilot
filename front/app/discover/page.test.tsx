import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Page from './page'

const route = vi.hoisted(() => ({ search: 'platform=boss&view=results&profileId=4&scanRunId=old-run&query=采购&returnTo=%2Fopportunities', push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: route.push, replace: route.replace }), useSearchParams: () => new URLSearchParams(route.search) }))
vi.mock('@/lib/use-unsaved-changes', () => ({ confirmNavigation: () => true }))
vi.mock('@/app/boss/BossWorkspace', () => ({ default: ({ workspaceView, requestedScanRunId, onWorkspaceScopeChange }: { workspaceView: string; requestedScanRunId: string; onWorkspaceScopeChange: (runId: string, profileId: number, view: string) => void }) => <><p>已打开 {workspaceView} · {requestedScanRunId}</p><button onClick={() => onWorkspaceScopeChange('new-run', 4, 'task')}>模拟新采集已启动</button></> }))
vi.mock('@/app/zhilian/ZhilianWorkspace', () => ({ default: () => <p>智联工作区</p> }))
vi.mock('@/app/zhilian/analysis/ZhilianResults', () => ({ default: () => <p>智联岗位结果</p> }))

afterEach(() => vi.clearAllMocks())
describe('发现岗位工作区', () => {
  it('直接刷新历史结果入口无需启动新扫描', () => {
    render(<Page />)
    expect(screen.getByText('已打开 results · old-run')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /岗位结果/ })).toHaveAttribute('aria-current', 'page')
    expect(route.push).not.toHaveBeenCalled()
    expect(route.replace).not.toHaveBeenCalled()
  })
  it('切换视图保留档案、扫描、查询与返回上下文', () => {
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: /搜索条件/ }))
    const params = new URLSearchParams(route.push.mock.calls[0][0].split('?')[1])
    expect(params.get('view')).toBe('setup')
    expect(params.get('profileId')).toBe('4')
    expect(params.get('scanRunId')).toBe('old-run')
    expect(params.get('query')).toBe('采购')
    expect(params.get('returnTo')).toBe('/opportunities')
  })
  it('切换招聘平台不会沿用另一个平台的扫描范围', () => {
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: '智联招聘' }))
    expect(route.push.mock.calls[0][0]).toContain('platform=zhilian')
    expect(route.push.mock.calls[0][0]).not.toContain('scanRunId')
  })
  it('新的采集任务替换历史扫描范围并保留任务视图与返回上下文', () => {
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: '模拟新采集已启动' }))
    const params = new URLSearchParams(route.replace.mock.calls[0][0].split('?')[1])
    expect(params.get('view')).toBe('task')
    expect(params.get('scanRunId')).toBe('new-run')
    expect(params.get('profileId')).toBe('4')
    expect(params.get('returnTo')).toBe('/opportunities')
    expect(params.get('query')).toBe('采购')
  })
})
