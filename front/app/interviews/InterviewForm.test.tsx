import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import InterviewForm from './InterviewForm'
import { opportunityApi } from '@/lib/opportunities'
import { hasUnsavedChanges } from '@/lib/use-unsaved-changes'

vi.mock('@/lib/opportunities', async original => ({ ...await original<typeof import('@/lib/opportunities')>(), opportunityApi: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('defaults to pending and refuses a scheduled interview without confirmed time', async () => {
  render(<InterviewForm opportunityId={8} opportunityVersion={3} onSaved={vi.fn()} onClose={vi.fn()} />)
  expect(screen.getByLabelText('面试状态')).toHaveValue('PENDING')
  fireEvent.change(screen.getByLabelText('面试状态'), { target: { value: 'SCHEDULED' } })
  fireEvent.click(screen.getByText('确认保存面试'))
  expect(await screen.findByRole('alert')).toHaveTextContent('确认时间')
  expect(opportunityApi).not.toHaveBeenCalled()
})
it('preserves uncertain save identity, UTC time, preparation and opportunity version', async () => {
  vi.mocked(opportunityApi).mockRejectedValueOnce(new Error('响应丢失')).mockResolvedValueOnce({ success: true })
  const saved = vi.fn()
  render(<InterviewForm opportunityId={8} opportunityVersion={3} onSaved={saved} onClose={vi.fn()} />)
  fireEvent.change(screen.getByLabelText(/时间（/), { target: { value: '2030-01-02T10:00' } })
  fireEvent.change(screen.getByLabelText('面试状态'), { target: { value: 'SCHEDULED' } })
  fireEvent.click(screen.getByLabelText('复习 JD 与投递简历'))
  fireEvent.click(screen.getByText('确认保存面试'))
  await screen.findByText('响应丢失')
  fireEvent.click(screen.getByText('确认保存面试'))
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  const calls = vi.mocked(opportunityApi).mock.calls
  expect(calls[0]).toEqual(calls[1])
  expect(calls[0][0]).toBe('/8/interviews')
  expect(calls[0][1]).toMatchObject({ opportunityVersion: 3, status: 'SCHEDULED', scheduledAt: new Date('2030-01-02T10:00').toISOString(), preparation: ['JOB_RESUME'] })
})
it('freezes interview fields and keeps navigation protected during an unchanged pending save', async () => {
  let finish!: (value: unknown) => void
  const pending = new Promise(resolve => { finish = resolve })
  vi.mocked(opportunityApi).mockReturnValue(pending)
  const saved = vi.fn()
  render(<InterviewForm opportunityId={8} opportunityVersion={3} onSaved={saved} onClose={vi.fn()} />)
  expect(hasUnsavedChanges()).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '确认保存面试' }))
  expect(screen.getByLabelText('面试备注')).toBeDisabled()
  expect(screen.getByLabelText('面试状态')).toBeDisabled()
  expect(screen.getByLabelText('复习 JD 与投递简历')).toBeDisabled()
  expect(hasUnsavedChanges()).toBe(true)
  await act(async () => { finish({ success: true }); await pending })
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  expect(screen.getByLabelText('面试备注')).toBeEnabled()
  expect(hasUnsavedChanges()).toBe(false)
})
