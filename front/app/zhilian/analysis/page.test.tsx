import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Page from './page'

vi.mock('./AnalysisBasis', () => ({ default: () => null }))
vi.mock('./AnalysisContent', () => ({ default: ({ profileId, activeScanRunId }: { profileId: number; activeScanRunId: string }) => <div data-testid="analysis">{profileId}:{activeScanRunId || 'all'}</div> }))

let profile = { id: 4, name: '测试档案' }
beforeEach(() => {
  profile = { id: 4, name: '测试档案' }
  sessionStorage.clear()
  window.history.replaceState({}, '', '/zhilian/analysis')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: profile }) })))
})
afterEach(() => vi.unstubAllGlobals())

it('直接打开显示全部；扫描链接保留范围，切换档案后清除旧批次', async () => {
  window.history.replaceState({}, '', '/zhilian/analysis?profileId=4&scanRunId=run-4')
  render(<Page />)
  await waitFor(() => expect(screen.getByTestId('analysis')).toHaveTextContent('4:run-4'))
  fireEvent.click(screen.getByRole('button', { name: '全部岗位' }))
  expect(screen.getByTestId('analysis')).toHaveTextContent('4:all')
  expect(window.location.search).toBe('')
  fireEvent.click(screen.getByRole('button', { name: '本次扫描' }))
  expect(window.location.search).toContain('scanRunId=run-4')
  profile = { id: 7, name: '新档案' }
  fireEvent.focus(window)
  await waitFor(() => expect(screen.getByTestId('analysis')).toHaveTextContent('7:all'))
  expect(window.location.search).toBe('')
  expect(screen.getByRole('button', { name: '本次扫描' })).toBeDisabled()
})

it('直接访问独立入口不需要配置页传入刷新信号', async () => {
  render(<Page />)
  await waitFor(() => expect(screen.getByTestId('analysis')).toHaveTextContent('4:all'))
  expect(screen.getByRole('link', { name: '返回智联配置' })).toHaveAttribute('href', '/zhilian')
})
