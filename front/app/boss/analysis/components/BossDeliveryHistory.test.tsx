import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BossDeliveryHistory } from './BossDeliveryHistory'

afterEach(() => vi.unstubAllGlobals())

describe('Boss delivery history', () => {
  it('展示真实话术来源、快照和精确验证结果', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{
      requestKey: 'request-1',
      jobRowId: 9,
      state: 'CONFIRMED',
      evidence: 'GREETING_RENDERED_EXACT',
      greetingSnapshot: '岗位强调数据分析，我有增长分析项目经验，希望进一步沟通。',
      greetingSource: 'AI_GREETING',
      greetingOutcome: 'CONFIRMED',
      greetingEvidence: 'GREETING_RENDERED_EXACT',
      updatedAt: '2026-09-04 11:00:00',
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    render(<BossDeliveryHistory />)

    expect(await screen.findByText('岗位 JD 定制')).toBeInTheDocument()
    expect(screen.getByText('精确话术已确认')).toBeInTheDocument()
    expect(screen.getByText(/岗位强调数据分析/)).toBeInTheDocument()
    expect(screen.getAllByText(/GREETING_RENDERED_EXACT/)).toHaveLength(2)
  })
})
