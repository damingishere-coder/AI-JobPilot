import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import OpportunityEditor from './OpportunityEditor'
import { opportunityApi, type OpportunityDetail } from '@/lib/opportunities'
import { hasUnsavedChanges } from '@/lib/use-unsaved-changes'
import { loadInterviews } from '@/lib/interviews'

vi.mock('@/lib/opportunities', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/opportunities')>(), opportunityApi: vi.fn() }))
vi.mock('@/lib/interviews', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/interviews')>(), loadInterviews: vi.fn().mockResolvedValue({ items: [], total: 0, profileId: 1 }) }))
beforeEach(() => { vi.mocked(loadInterviews).mockResolvedValue({ items: [], total: 0, profileId: 1 }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
const detail: OpportunityDetail = {
  id: 8, platform: 'zhilian', job_name: '合成岗位', company_name: '虚构公司', stage: 'DISCOVERED', interest: 'UNDECIDED',
  archived: 1, version: 4, follow_up_at: null, note: '', nextAction: '', job_snapshot: '{}', events: [], analyses: [],
  applications: [{ id: 2, state: 'UNKNOWN', evidence: 'NO_CONFIRMATION', requested_at: '' }],
}
it('restores the opportunity without dispatching an application and preserves UNKNOWN visibility', async () => {
  vi.mocked(opportunityApi).mockResolvedValue({ success: true })
  const saved = vi.fn()
  render(<OpportunityEditor detail={detail} onSaved={saved} onClose={vi.fn()} />)
  expect(screen.getByText('投递：结果未知，需对账')).toBeVisible()
  fireEvent.click(screen.getByText('恢复到当前列表'))
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  expect(opportunityApi).toHaveBeenCalledWith('/8', expect.objectContaining({ archived: false, version: 4, stage: 'DISCOVERED' }))
  expect(opportunityApi).toHaveBeenCalledTimes(1)
})
it('keeps the idempotency key after a lost response and reports version conflicts', async () => {
  vi.mocked(opportunityApi).mockRejectedValueOnce(new Error('响应丢失')).mockRejectedValueOnce(new Error('记录已更新，请刷新后再保存'))
  render(<OpportunityEditor detail={detail} onSaved={vi.fn()} onClose={vi.fn()} />)
  fireEvent.click(screen.getByText('保存记录'))
  await screen.findByText('响应丢失')
  fireEvent.click(screen.getByText('保存记录'))
  await screen.findByText('记录已更新，请刷新后再保存')
  const calls = vi.mocked(opportunityApi).mock.calls
  expect(calls[0][1]).toEqual(calls[1][1])
})
it('preserves the note draft while saving feedback, adopts the fresh stage and saves against its latest version', async () => {
  vi.mocked(opportunityApi).mockResolvedValue({ success: true })
  let current = { ...detail, archived: 0 }
  const saved = vi.fn(async () => {
    current = { ...current, version: current.version + 1, stage: 'RECRUITER_REPLIED' }
    view.rerender(<OpportunityEditor detail={current} onSaved={saved} onClose={vi.fn()} />)
  })
  const view = render(<OpportunityEditor detail={current} onSaved={saved} onClose={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '下次沟通的草稿不能丢失' } })
  expect(hasUnsavedChanges()).toBe(true)
  fireEvent.click(screen.getByRole('tab', { name: '沟通与反馈' }))
  fireEvent.change(screen.getByLabelText('反馈备注'), { target: { value: '已核实收到 HR 回复' } })
  fireEvent.click(screen.getByText('确认记录反馈'))
  await screen.findByText('真实反馈已记录')
  fireEvent.click(screen.getByRole('tab', { name: '概览' }))
  expect(screen.getByLabelText('备注')).toHaveValue('下次沟通的草稿不能丢失')
  expect(screen.getByLabelText('求职阶段')).toHaveValue('RECRUITER_REPLIED')
  fireEvent.click(screen.getByText('保存记录'))
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(2))
  expect(opportunityApi).toHaveBeenLastCalledWith('/8', expect.objectContaining({ version: 5, stage: 'RECRUITER_REPLIED', note: '下次沟通的草稿不能丢失' }))
  await waitFor(() => expect(hasUnsavedChanges()).toBe(false))
})
it('keeps overview drafts when recording a pending interview and does not invent a scheduled time', async () => {
  vi.mocked(opportunityApi).mockResolvedValue({ success: true })
  let current = { ...detail, archived: 0 }
  const saved = vi.fn(async () => { current = { ...current, version: 5 }; view.rerender(<OpportunityEditor detail={current} onSaved={saved} onClose={vi.fn()} />) })
  const view = render(<OpportunityEditor detail={current} onSaved={saved} onClose={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('下一步事项'), { target: { value: '等待双方确认时间' } })
  fireEvent.click(screen.getByRole('tab', { name: '面试' }))
  fireEvent.click(await screen.findByText('新增面试轮次'))
  fireEvent.click(screen.getByText('确认保存面试'))
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  expect(opportunityApi).toHaveBeenCalledWith('/8/interviews', expect.objectContaining({ opportunityVersion: 4, status: 'PENDING', scheduledAt: null }))
  fireEvent.click(screen.getByRole('tab', { name: '概览' }))
  expect(screen.getByLabelText('下一步事项')).toHaveValue('等待双方确认时间')
  expect(hasUnsavedChanges()).toBe(true)
})
it('freezes the submitted overview until the save and detail refresh finish', async () => {
  let finish!: (value: unknown) => void
  const pending = new Promise(resolve => { finish = resolve })
  vi.mocked(opportunityApi).mockReturnValue(pending)
  const saved = vi.fn(() => view.rerender(<OpportunityEditor detail={{ ...detail, version: 5, note: '提交的备注' }} onSaved={saved} onClose={vi.fn()} />))
  const view = render(<OpportunityEditor detail={detail} onSaved={saved} onClose={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '提交的备注' } })
  fireEvent.click(screen.getByRole('button', { name: '保存记录' }))
  expect(screen.getByLabelText('备注')).toBeDisabled()
  expect(screen.getByLabelText('求职阶段')).toBeDisabled()
  expect(screen.getByLabelText('更正原因')).toBeDisabled()
  expect(hasUnsavedChanges()).toBe(true)
  await act(async () => { finish({ success: true }); await pending })
  await screen.findByText('记录已保存')
  expect(screen.getByLabelText('备注')).toBeEnabled()
  expect(screen.getByLabelText('备注')).toHaveValue('提交的备注')
  expect(opportunityApi).toHaveBeenCalledWith('/8', expect.objectContaining({ note: '提交的备注', version: 4 }))
  expect(hasUnsavedChanges()).toBe(false)
})
it('retries a failed interview list without changing opportunity version and clears the old error on success', async () => {
  vi.mocked(loadInterviews).mockRejectedValueOnce(new Error('面试读取暂时失败')).mockResolvedValueOnce({ items: [], total: 0, profileId: 1 })
  render(<OpportunityEditor detail={detail} onSaved={vi.fn()} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('tab', { name: '面试' }))
  await screen.findByText('面试读取暂时失败')
  expect(screen.queryByRole('button', { name: '新增面试轮次' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重试读取面试' }))
  expect(await screen.findByRole('button', { name: '新增面试轮次' })).toBeEnabled()
  expect(screen.queryByText('面试读取暂时失败')).not.toBeInTheDocument()
  expect(loadInterviews).toHaveBeenCalledTimes(2)
  expect(loadInterviews).toHaveBeenLastCalledWith(8, 1, 100, expect.any(AbortSignal))
})
