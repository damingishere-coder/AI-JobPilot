import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import HrDutyActivity from './HrDutyActivity'
afterEach(() => vi.unstubAllGlobals())
it('keeps reply records collapsed while showing useful send and review counts', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ success: true, data: url.includes('proposals') ? [{ id: 1, profileId: 4, version: 1, status: 'SENT_CONFIRMED', companyName: '合成公司', hrName: '合成 HR', sourceMessage: '你好', draft: '您好' }] : { activity: { counts: { SENT_CONFIRMED: 1, REVIEW_REQUIRED: 2 }, progress: { processed: 1, baseline_complete: 0 }, decisions: [] } } }), { headers: { 'Content-Type': 'application/json' } })))
  const { container } = render(<HrDutyActivity profileId={4} />)
  await screen.findByText(/1 条 · 已发送 1 · 待你决定 2/)
  expect(container.querySelector('details')).not.toHaveAttribute('open')
  expect(screen.getByText(/合成公司/).closest('details')).not.toHaveAttribute('open')
})
