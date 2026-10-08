import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import InterviewsPage from './page'
import { opportunityApi, type OpportunityDetail } from '@/lib/opportunities'
import { loadInterviews } from '@/lib/interviews'

vi.mock('@/lib/opportunities', async original => ({ ...await original<typeof import('@/lib/opportunities')>(), opportunityApi: vi.fn() }))
vi.mock('@/lib/interviews', async original => ({ ...await original<typeof import('@/lib/interviews')>(), loadInterviews: vi.fn() }))
vi.mock('@/app/components/ProfileSwitcher', async () => {
  const { useEffect } = await import('react')
  return { default: function FixtureProfile({ onProfileChange }: { onProfileChange: (profile: { id: number }) => void }) { useEffect(() => onProfileChange({ id: 1 }), [onProfileChange]); return null } }
})
vi.mock('next/navigation', async () => {
  const { useEffect, useState } = await import('react')
  return { useSearchParams: function useFixtureSearchParams() {
    const [query, setQuery] = useState(window.location.search)
    useEffect(() => { const change = () => setQuery(window.location.search); window.addEventListener('popstate', change); return () => window.removeEventListener('popstate', change) }, [])
    return new URLSearchParams(query)
  } }
})
const detail: OpportunityDetail = { id: 8, platform: 'boss', job_name: '合成采购岗', company_name: '虚构公司', stage: 'DISCOVERED', interest: 'UNDECIDED', archived: 0, version: 7, follow_up_at: null, note: '', nextAction: '', job_snapshot: '{}', events: [], applications: [], analyses: [] }
beforeEach(() => {
  window.history.replaceState(null, '', '/interviews')
  const original = window.history.pushState.bind(window.history)
  vi.spyOn(window.history, 'pushState').mockImplementation((...args) => { original(...args); window.dispatchEvent(new PopStateEvent('popstate')) })
  vi.mocked(loadInterviews).mockResolvedValue({ items: [], total: 0, profileId: 1 })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks() })
it('separates interview views and reads the selected scope from the server', async () => {
  render(<InterviewsPage />)
  await screen.findByText('此视图暂无面试记录')
  expect(loadInterviews).toHaveBeenCalledWith(undefined, 1, 20, expect.any(AbortSignal), 'UPCOMING', '')
  fireEvent.click(screen.getByRole('button', { name: '过期待核实' }))
  await waitFor(() => expect(loadInterviews).toHaveBeenCalledWith(undefined, 1, 20, expect.any(AbortSignal), 'CHECK', ''))
  expect(window.location.search).toContain('view=CHECK')
})
it('creates a pending round directly from an existing opportunity without inventing confirmed interview time', async () => {
  vi.mocked(opportunityApi).mockImplementation(async (path, body) => body ? { success: true } : path?.startsWith('?') ? { items: [detail], total: 1 } : detail)
  render(<InterviewsPage />)
  fireEvent.click(screen.getByRole('button', { name: '新增面试轮次' }))
  expect(screen.getByText('数量读取中…')).toBeVisible()
  expect(screen.queryByText('0 个机会')).not.toBeInTheDocument()
  expect(screen.queryByText('没有符合搜索的机会，请调整关键词或先发现岗位。')).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: /合成采购岗/ }))
  expect(await screen.findByLabelText('面试状态')).toHaveValue('PENDING')
  fireEvent.click(screen.getByRole('button', { name: '确认保存面试' }))
  await waitFor(() => expect(opportunityApi).toHaveBeenCalledWith('/8/interviews', expect.objectContaining({ opportunityVersion: 7, round: 1, status: 'PENDING', scheduledAt: null })))
  expect(opportunityApi).not.toHaveBeenCalledWith(expect.stringContaining('confirm-delivery'), expect.anything())
})
it('does not close a new interview draft when a save from an abandoned editor finishes late', async () => {
  const second = { ...detail, id: 9, job_name: '另一个合成岗位' }
  let finishSave!: (value: unknown) => void
  const pendingSave = new Promise(resolve => { finishSave = resolve })
  vi.mocked(opportunityApi).mockImplementation(async (path, body) => body ? pendingSave : path?.startsWith('?') ? { items: [detail, second], total: 2 } : path === '/9' ? second : detail)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<InterviewsPage />)
  fireEvent.click(screen.getByRole('button', { name: '新增面试轮次' }))
  fireEvent.click(await screen.findByRole('button', { name: /合成采购岗/ }))
  await screen.findByLabelText('面试备注')
  fireEvent.click(screen.getByRole('button', { name: '确认保存面试' }))
  expect(screen.getByLabelText('面试备注')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(confirm).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: '新增面试轮次' }))
  fireEvent.click(await screen.findByRole('button', { name: /另一个合成岗位/ }))
  fireEvent.change(await screen.findByLabelText('面试备注'), { target: { value: '新轮次的草稿' } })
  await act(async () => { finishSave({ success: true }); await pendingSave })
  expect(screen.getByLabelText('面试备注')).toHaveValue('新轮次的草稿')
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(screen.getByText('另一个合成岗位 · 虚构公司')).toBeVisible()
})
it('marks the previous results as stale and leaves a failed new view count unknown', async () => {
  vi.mocked(loadInterviews).mockResolvedValueOnce({ items: [], total: 0, profileId: 1 }).mockRejectedValueOnce(new Error('新视图读取失败'))
  render(<InterviewsPage />)
  await screen.findByText('此视图暂无面试记录')
  fireEvent.click(screen.getByRole('button', { name: '过期待核实' }))
  expect(screen.getAllByText('数量读取中…').length).toBeGreaterThan(0)
  await screen.findByText('新视图读取失败')
  expect(screen.getByText('数量未知')).toBeVisible()
  expect(screen.queryByText(/0 轮面试/)).not.toBeInTheDocument()
  expect(screen.getByText(/上次成功读取：.*旧结果，可能不符合当前筛选/)).toBeVisible()
  expect(screen.queryByText('此视图暂无面试记录')).not.toBeInTheDocument()
})
