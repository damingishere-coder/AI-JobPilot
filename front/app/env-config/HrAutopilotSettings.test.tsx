import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import HrAutopilotSettings from './HrAutopilotSettings'

afterEach(() => vi.unstubAllGlobals())

it('authorizes text duty without an attachment and explicitly includes the recent backlog scope', async () => {
  const policy = { version: 2, enabled: false, paused: false, resumeName: '', resumeSha256: '', facts: '', rules: '按已确认事实回复', replyMode: 'REVIEW', historyMode: 'NEW_ONLY', historyDays: 30, sharePhone: false, shareResume: false, authorizationValid: false, communicationProfile: { expectedSalary: '20–25K' }, activity: { counts: {}, progress: { processed: 0, baseline_complete: 0 }, decisions: [] } }
  const requests: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    let data: unknown = policy
    if (url.endsWith('/action-token')) data = { token: 'synthetic' }
    else if (url.includes('/proposals')) data = []
    else if (url.endsWith('/deliveries')) data = {}
    else if (init?.method === 'PUT') { const body = JSON.parse(String(init.body)); requests.push(body); data = { ...policy, ...body, enabled: true, version: 3 } }
    return new Response(JSON.stringify({ success: true, data }), { headers: { 'Content-Type': 'application/json' } })
  }))
  render(<HrAutopilotSettings profileId={1} />)
  expect(await screen.findByText(/20–25K/)).toBeInTheDocument()
  expect(screen.getByLabelText('回复方式')).toHaveValue('AUTO')
  expect(screen.getByLabelText('已有消息处理')).toHaveValue('RECENT')
  expect(screen.getByRole('button', { name: '确认值班规则' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /我已核对当前档案资料/ }))
  fireEvent.click(screen.getByRole('button', { name: '确认值班规则' }))
  await waitFor(() => expect(requests).toHaveLength(1))
  expect(requests[0]).toMatchObject({ profileId: 1, replyMode: 'AUTO', enabled: true, rulesConfirmed: true, shareResume: false, resumeName: '', historyMode: 'RECENT', historyDays: 30 })
})
