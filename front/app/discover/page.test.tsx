import { render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Page from './page'

const route = vi.hoisted(() => ({ search: '', router: { replace: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => route.router, useSearchParams: () => new URLSearchParams(route.search) }))
afterEach(() => vi.clearAllMocks())

it('历史 BOSS 结果链接返回原分析页并保留档案、扫描和返回范围', () => {
  route.search = 'platform=boss&view=results&profileId=4&scanRunId=old-run&query=采购&returnTo=%2Fopportunities'
  render(<Page />)
  const target = new URL(route.router.replace.mock.calls[0][0], 'http://localhost')
  expect(target.pathname).toBe('/boss/analysis')
  expect(target.searchParams.get('profileId')).toBe('4')
  expect(target.searchParams.get('scanRunId')).toBe('old-run')
  expect(target.searchParams.get('query')).toBe('采购')
  expect(target.searchParams.get('returnTo')).toBe('/opportunities')
  expect(target.searchParams.has('view')).toBe(false)
})
it('智联搜索入口返回原配置页', () => {
  route.search = 'platform=zhilian&view=setup'
  render(<Page />)
  expect(route.router.replace).toHaveBeenCalledWith('/zhilian')
})
it('智联结果入口返回原分析页', () => {
  route.search = 'platform=zhilian&view=results&scanRunId=history'
  render(<Page />)
  expect(route.router.replace).toHaveBeenCalledWith('/zhilian/analysis?scanRunId=history')
})
it('没有平台参数时返回 BOSS 配置页', () => {
  route.search = ''
  render(<Page />)
  expect(route.router.replace).toHaveBeenCalledWith('/boss')
})
