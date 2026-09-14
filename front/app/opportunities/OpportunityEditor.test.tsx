import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import OpportunityEditor from './OpportunityEditor'
import { opportunityApi, type OpportunityDetail } from '@/lib/opportunities'

vi.mock('@/lib/opportunities', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/opportunities')>(), opportunityApi: vi.fn() }))
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
  expect(screen.getByText(/结果未知，需对账/)).toBeInTheDocument()
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
