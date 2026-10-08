import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FeedbackSection from './FeedbackSection'
import { opportunityApi, type OpportunityDetail } from '@/lib/opportunities'
import { hasUnsavedChanges } from '@/lib/use-unsaved-changes'

vi.mock('@/lib/opportunities', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/opportunities')>(), opportunityApi: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const detail: OpportunityDetail = { id: 8, platform: 'boss', job_name: '虚构岗位', company_name: '虚构公司', stage: 'DISCOVERED', interest: 'UNDECIDED', archived: 0, version: 1, follow_up_at: null, note: '', nextAction: '', job_snapshot: '{}', events: [], applications: [], analyses: [] }
it('does not load messages or infer an outcome until the user acts', async () => {
  vi.mocked(opportunityApi).mockResolvedValueOnce([{ id: 4, hrName: '虚构HR', companyName: '虚构公司', jobName: '虚构岗位', candidate: true, linked: 0, linked_count: 0 }])
  const saved = vi.fn()
  render(<FeedbackSection detail={detail} onSaved={saved} />)
  expect(opportunityApi).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('加载已采集会话'))
  await screen.findByText(/候选，尚未确认/)
  expect(screen.queryByText('查看保留期内消息')).not.toBeInTheDocument()
  expect(saved).not.toHaveBeenCalled()
  expect(opportunityApi).toHaveBeenCalledTimes(1)
})
it('keeps no-reply reporting disabled without an observation cutoff and a confirmed application', () => {
  render(<FeedbackSection detail={detail} onSaved={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('反馈类型'), { target: { value: 'NO_REPLY_OBSERVED' } })
  expect(screen.getByText('确认记录反馈')).toBeDisabled()
  expect(opportunityApi).not.toHaveBeenCalled()
})
it('requires a checked cutoff and confirmed application before recording no interview', () => {
  render(<FeedbackSection detail={detail} onSaved={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('反馈类型'), { target: { value: 'NO_INTERVIEW_OBSERVED' } })
  expect(screen.getByText('确认记录反馈')).toBeDisabled()
  expect(screen.getByLabelText('已核对结果的截止时间')).toBeInTheDocument()
  expect(opportunityApi).not.toHaveBeenCalled()
})
it('records only an explicitly selected outcome and leaves sent resume version unknown by default', async () => {
  vi.mocked(opportunityApi).mockResolvedValue({ success: true })
  const saved = vi.fn()
  render(<FeedbackSection detail={detail} onSaved={saved} />)
  fireEvent.change(screen.getByLabelText('反馈类型'), { target: { value: 'INTERVIEW_INVITED' } })
  fireEvent.click(screen.getByText('确认记录反馈'))
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  expect(opportunityApi).toHaveBeenCalledWith('/8/feedback', expect.objectContaining({ type: 'INTERVIEW_INVITED', actualSentResumeVersionId: null, occurredAt: null, attemptId: null }))
})
it('protects an in-flight feedback save and freezes fields until its submitted snapshot is recorded', async () => {
  let finish!: (value: unknown) => void
  const pending = new Promise(resolve => { finish = resolve })
  vi.mocked(opportunityApi).mockReturnValue(pending)
  render(<FeedbackSection detail={detail} onSaved={vi.fn()} />)
  expect(hasUnsavedChanges()).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '确认记录反馈' }))
  expect(screen.getByLabelText('反馈备注')).toBeDisabled()
  expect(screen.getByLabelText('反馈类型')).toBeDisabled()
  expect(hasUnsavedChanges()).toBe(true)
  await act(async () => { finish({ success: true }); await pending })
  await screen.findByText('真实反馈已记录')
  expect(screen.getByLabelText('反馈备注')).toBeEnabled()
  expect(hasUnsavedChanges()).toBe(false)
})
