import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import StrategyReport from './StrategyReport'
import type { StrategySnapshot } from '@/lib/strategy'

afterEach(cleanup)
const metric = { mature: 3, observed: 2, positive: 1, positiveIds: [1], negativeIds: [2], unobservedIds: [3], confidence: 'INSUFFICIENT_DATA', ratePercent: null, coveragePercent: 67 }
const snapshot: StrategySnapshot = { id: 1, profile_id: 1, version: 0, cutoff: '2030-01-01T00:00:00Z', window_days: 90, through_event_id: 5, rule_version: 'feedback-cohort-v1', decisions: {}, result: { exclusions: { 历史未知: 4 }, interviewRecords: 0, minimumSample: 20, analysis: { applications: 3, reply: metric, interview: metric, groups: [], insights: [] } } }
it('does not display a small-sample rate and links positive negative and unobserved evidence', () => {
  render(<StrategyReport snapshot={snapshot} busy={false} onDecide={vi.fn()} />)
  expect(screen.getAllByText('样本不足')).toHaveLength(2)
  expect(screen.queryByText('50%')).not.toBeInTheDocument()
  expect(screen.getAllByText('未充分观察，不计为失败')).toHaveLength(2)
  expect(screen.getAllByRole('link', { name: '机会 #3' })[0]).toHaveAttribute('href', '/opportunities?id=3')
  expect(screen.getByText(/没有满足样本要求/)).toBeInTheDocument()
})
it('adoption requires a user click and only records the chosen insight', () => {
  const decide = vi.fn()
  const value = { ...snapshot, result: { ...snapshot.result, analysis: { ...snapshot.result.analysis, insights: [{ id: 'KEYWORD:A', dimension: 'KEYWORD', value: 'A', text: '合成统计差异，非个人概率', confidence: 'LOW_CONFIDENCE', samples: 20 }] } } }
  render(<StrategyReport snapshot={value} busy={false} onDecide={decide} />)
  expect(decide).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('记为采用方向'))
  expect(decide).toHaveBeenCalledExactlyOnceWith('KEYWORD:A', 'ADOPTED')
  expect(screen.getByText(/不会自动更改搜索/)).toBeInTheDocument()
})
