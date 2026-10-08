import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import OpportunitiesPage from './page'
import { opportunityApi } from '@/lib/opportunities'

vi.mock('@/lib/opportunities', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/opportunities')>(), opportunityApi: vi.fn() }))
vi.mock('@/lib/interviews', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/interviews')>(), loadInterviews: vi.fn(async () => ({ items: [], total: 0, profileId: 1 })) }))
vi.mock('@/app/components/ProfileSwitcher', async () => {
  const { useEffect } = await import('react')
  return { default: function FixtureProfile({ onProfileChange }: { onProfileChange: (p: { id: number }) => void }) {
    useEffect(() => onProfileChange({ id: 1 }), [onProfileChange]); return null
  } }
})
vi.mock('next/navigation', async () => {
  const { useEffect, useState } = await import('react')
  return { useSearchParams: function useFixtureSearchParams() {
    const [query, setQuery] = useState(window.location.search)
    useEffect(() => { const change = () => setQuery(window.location.search); window.addEventListener('popstate', change); return () => window.removeEventListener('popstate', change) }, [])
    return new URLSearchParams(query)
  } }
})
beforeEach(() => {
  window.history.replaceState(null, '', '/opportunities?bucket=UNKNOWN&page=2')
  const original = window.history.pushState.bind(window.history)
  vi.spyOn(window.history, 'pushState').mockImplementation((...args) => { original(...args); window.dispatchEvent(new PopStateEvent('popstate')) })
  vi.mocked(opportunityApi).mockResolvedValue({ items: [], total: 35, scopeLabel: '结果未知待对账' })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks() })
it('loads the linked bucket and preserves its scope while paging and reloading', async () => {
  const first = render(<OpportunitiesPage />)
  await screen.findByText(/结果未知待对账 · 35/)
  expect(opportunityApi).toHaveBeenCalledWith(expect.stringContaining('page=2&bucket=UNKNOWN'), undefined, expect.any(AbortSignal))
  fireEvent.click(screen.getByText('上一页'))
  await waitFor(() => expect(opportunityApi).toHaveBeenCalledWith(expect.stringContaining('page=1&bucket=UNKNOWN'), undefined, expect.any(AbortSignal)))
  first.unmount(); render(<OpportunitiesPage />)
  await screen.findByText('第 1 页')
  expect(window.location.search).toContain('bucket=UNKNOWN')
})
it('clears the workbench bucket when switching to the archive view', async () => {
  render(<OpportunitiesPage />)
  await screen.findByText(/结果未知待对账 · 35/)
  fireEvent.click(screen.getByText('已归档'))
  await waitFor(() => expect(window.location.search).toContain('archived=true'))
  expect(window.location.search).not.toContain('bucket=')
  expect(window.location.search).not.toContain('page=2')
})
it('protects a draft when another opportunity is selected and preserves it across a detail refresh', async () => {
  window.history.replaceState(null, '', '/opportunities?id=8')
  const item = { id: 8, platform: 'boss', job_name: '合成采购岗', company_name: '虚构公司', stage: 'DISCOVERED', interest: 'UNDECIDED', archived: 0, version: 4, follow_up_at: null }
  const selected = { ...item, note: '', nextAction: '', job_snapshot: '{}', events: [], applications: [], analyses: [] }
  vi.mocked(opportunityApi).mockImplementation(async path => path?.startsWith('?') ? { items: [item, { ...item, id: 9, job_name: '另一个合成岗位' }], total: 2 } : selected)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<OpportunitiesPage />)
  fireEvent.change(await screen.findByLabelText('备注'), { target: { value: '尚未保存的跟进草稿' } })
  expect(screen.getAllByText('投递：状态未知，待核实')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: /另一个合成岗位/ }))
  expect(confirm).toHaveBeenCalledOnce()
  expect(window.location.search).toContain('id=8')
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await waitFor(() => expect(opportunityApi).toHaveBeenCalledWith('/8'))
  expect(screen.getByLabelText('备注')).toHaveValue('尚未保存的跟进草稿')
})
it('sends platform, delivery state and keyword filters to the server without losing the workbench scope', async () => {
  render(<OpportunitiesPage />)
  await screen.findByText(/结果未知待对账 · 35/)
  const requestsBeforeEditing = vi.mocked(opportunityApi).mock.calls.length
  fireEvent.change(screen.getByLabelText('平台'), { target: { value: 'zhilian' } })
  fireEvent.change(screen.getByLabelText('投递状态'), { target: { value: 'UNKNOWN' } })
  fireEvent.change(screen.getByLabelText('搜索岗位或公司'), { target: { value: '采购公司' } })
  expect(vi.mocked(opportunityApi).mock.calls).toHaveLength(requestsBeforeEditing)
  expect(window.location.search).not.toContain('platform=')
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
  await waitFor(() => expect(opportunityApi).toHaveBeenCalledWith(expect.stringContaining('platform=zhilian&q=%E9%87%87%E8%B4%AD%E5%85%AC%E5%8F%B8&applicationStatus=UNKNOWN'), undefined, expect.any(AbortSignal)))
  expect(window.location.search).toContain('bucket=UNKNOWN')
  expect(window.location.search).not.toContain('page=2')
  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }))
  await waitFor(() => expect(screen.getByLabelText('平台')).toHaveValue(''))
  expect(screen.getByLabelText('投递状态')).toHaveValue('')
  expect(screen.getByLabelText('搜索岗位或公司')).toHaveValue('')
  expect(window.location.search).not.toContain('bucket=')
  expect(window.location.search).not.toContain('q=')
})
it('ignores a late refresh of the previous opportunity without unmounting the newly selected draft', async () => {
  window.history.replaceState(null, '', '/opportunities?id=8')
  const first = { id: 8, platform: 'boss', job_name: '合成采购岗', company_name: '虚构公司', stage: 'DISCOVERED', interest: 'UNDECIDED', archived: 0, version: 4, follow_up_at: null, note: '', nextAction: '', job_snapshot: '{}', events: [], applications: [], analyses: [] }
  const second = { ...first, id: 9, job_name: '另一个合成岗位' }
  let finishRefresh!: (value: typeof first) => void
  const lateRefresh = new Promise<typeof first>(resolve => { finishRefresh = resolve })
  vi.mocked(opportunityApi).mockImplementation(async (path, _body, signal) => path?.startsWith('?') ? { items: [first, second], total: 2 } : path === '/9' ? second : signal ? first : lateRefresh)
  render(<OpportunitiesPage />)
  await screen.findByLabelText('备注')
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await waitFor(() => expect(opportunityApi).toHaveBeenCalledWith('/8'))
  fireEvent.click(screen.getByRole('button', { name: /另一个合成岗位/ }))
  await screen.findByRole('heading', { name: '另一个合成岗位 · 虚构公司' })
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '新机会的草稿' } })
  await act(async () => { finishRefresh(first); await lateRefresh })
  expect(screen.getByRole('heading', { name: '另一个合成岗位 · 虚构公司' })).toBeVisible()
  expect(screen.getByLabelText('备注')).toHaveValue('新机会的草稿')
  expect(window.location.search).toContain('id=9')
})
it('does not present an old zero as the count of a new filter after its query fails', async () => {
  window.history.replaceState(null, '', '/opportunities')
  vi.mocked(opportunityApi).mockImplementation(async path => {
    if (path?.includes('stage=INTERVIEW')) throw new Error('新范围读取失败')
    return { items: [], total: 0, profileId: 1 }
  })
  render(<OpportunitiesPage />)
  await screen.findByText(/0 个机会/)
  fireEvent.change(screen.getByLabelText('求职阶段筛选'), { target: { value: 'INTERVIEW' } })
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
  expect(screen.getAllByText(/数量读取中/).length).toBeGreaterThan(0)
  await screen.findByText('新范围读取失败')
  expect(screen.getByText(/数量未知/)).toBeVisible()
  expect(screen.queryByText(/0 个机会/)).not.toBeInTheDocument()
  expect(screen.getByText(/上次成功读取：.*旧结果，可能不符合当前筛选/)).toBeVisible()
  expect(screen.queryByText(/此范围暂无机会/)).not.toBeInTheDocument()
})
