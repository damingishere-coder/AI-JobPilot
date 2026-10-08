import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import RankingWorkspace from './RankingWorkspace'
import { strategyApi } from '@/lib/strategy'
import { hasUnsavedChanges } from '@/lib/use-unsaved-changes'
import type { RankingResult, RankingSettings } from '@/lib/ranking'

vi.mock('@/lib/strategy', async original => ({ ...await original<typeof import('@/lib/strategy')>(), strategyApi: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks() })
const settings: RankingSettings = { profileId: 1, version: 0, enabled: false, preferences: { roles: [], cities: [], scales: [], industries: [], workModes: [], minSalaryK: null, maxSalaryK: null, hard: [] } }
const result: RankingResult = { profileId: 1, preferenceVersion: 0, enabled: false, strategyOrder: false, snapshotId: null, feedbackState: 'INSUFFICIENT_DATA', ruleVersion: 'fixture', items: [] }
it('retains a side-panel draft when inspecting preview and saves only after explicit confirmation', async () => {
  vi.mocked(strategyApi).mockImplementation(async (path, body) => {
    if (path === '/ranking/settings') return body ? { ...settings, version: 1, enabled: true } : settings
    if (path === '/ranking/preview') return { ...result, strategyOrder: true }
    return result
  })
  render(<RankingWorkspace profileId={1} />)
  const edit = await screen.findByRole('button', { name: '编辑求职偏好' })
  await waitFor(() => expect(edit).toBeEnabled())
  fireEvent.click(edit)
  fireEvent.change(screen.getByLabelText('岗位方向关键词'), { target: { value: '采购经理' } })
  fireEvent.click(screen.getByRole('button', { name: '预览草稿排序' }))
  await screen.findByText(/正在预览偏好草稿/)
  expect(strategyApi).not.toHaveBeenCalledWith('/ranking/settings', expect.anything())
  fireEvent.click(screen.getByRole('button', { name: '收起偏好' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(hasUnsavedChanges()).toBe(true)
  fireEvent.click(edit)
  expect(screen.getByLabelText('岗位方向关键词')).toHaveValue('采购经理')
  fireEvent.click(screen.getByRole('button', { name: '保存偏好并启用推荐排序' }))
  await waitFor(() => expect(strategyApi).toHaveBeenCalledWith('/ranking/settings', expect.objectContaining({ profileId: 1, version: 0, enabled: true, preferences: expect.objectContaining({ roles: ['采购经理'] }) })))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(hasUnsavedChanges()).toBe(false)
})
it('does not show an empty recommendation while the initial query is unresolved', () => {
  vi.mocked(strategyApi).mockImplementation(() => new Promise(() => {}))
  render(<RankingWorkspace profileId={1} />)
  expect(screen.getByRole('status')).toHaveTextContent('正在读取推荐机会')
  expect(screen.queryByText(/目前没有符合此范围的候选/)).not.toBeInTheDocument()
})
it('freezes the submitted preference snapshot until its deferred save finishes', async () => {
  let finish!: (value: RankingSettings) => void
  const pending = new Promise<RankingSettings>(resolve => { finish = resolve })
  vi.mocked(strategyApi).mockImplementation(async (path, body) => path === '/ranking/settings' ? body ? pending : settings : result)
  render(<RankingWorkspace profileId={1} />)
  const edit = await screen.findByRole('button', { name: '编辑求职偏好' })
  await waitFor(() => expect(edit).toBeEnabled())
  fireEvent.click(edit)
  fireEvent.change(screen.getByLabelText('岗位方向关键词'), { target: { value: '采购经理' } })
  fireEvent.click(screen.getByRole('button', { name: '保存偏好并启用推荐排序' }))
  expect(screen.getByLabelText('岗位方向关键词')).toBeDisabled()
  expect(screen.getByLabelText('最低月薪（K）')).toBeDisabled()
  expect(screen.getByLabelText('远程')).toBeDisabled()
  expect(hasUnsavedChanges()).toBe(true)
  await act(async () => { finish({ ...settings, version: 1, enabled: true, preferences: { ...settings.preferences, roles: ['采购经理'] } }); await pending })
  await waitFor(() => expect(hasUnsavedChanges()).toBe(false))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(strategyApi).toHaveBeenCalledWith('/ranking/settings', expect.objectContaining({ preferences: expect.objectContaining({ roles: ['采购经理'] }) }))
})
it('keeps the preference draft when error retry navigation is cancelled', async () => {
  vi.mocked(strategyApi).mockImplementation(async path => {
    if (path === '/ranking/preview') throw new Error('预览读取失败')
    return path === '/ranking/settings' ? settings : result
  })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<RankingWorkspace profileId={1} />)
  const edit = await screen.findByRole('button', { name: '编辑求职偏好' })
  await waitFor(() => expect(edit).toBeEnabled())
  fireEvent.click(edit)
  fireEvent.change(screen.getByLabelText('岗位方向关键词'), { target: { value: '保留偏好草稿' } })
  fireEvent.click(screen.getByRole('button', { name: '预览草稿排序' }))
  await screen.findByText('预览读取失败')
  fireEvent.click(screen.getByRole('button', { name: '收起偏好' }))
  const requests = vi.mocked(strategyApi).mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }))
  expect(confirm).toHaveBeenCalledOnce()
  expect(vi.mocked(strategyApi).mock.calls).toHaveLength(requests)
  fireEvent.click(edit)
  expect(screen.getByLabelText('岗位方向关键词')).toHaveValue('保留偏好草稿')
})
