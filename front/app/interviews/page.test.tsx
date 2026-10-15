import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import InterviewsPage from './page'
import { loadInterviews } from '@/lib/interviews'

vi.mock('@/lib/interviews', async original => ({ ...await original<typeof import('@/lib/interviews')>(), loadInterviews: vi.fn() }))
vi.mock('@/app/components/ProfileSwitcher', async () => {
  const { useEffect } = await import('react')
  return { default: function FixtureProfile({ onProfileChange }: { onProfileChange: (profile: { id: number }) => void }) { useEffect(() => onProfileChange({ id: 1 }), [onProfileChange]); return null } }
})
afterEach(() => vi.clearAllMocks())

it('恢复从机会页选择岗位新增轮次的入口，并显示真实空记录状态', async () => {
  vi.mocked(loadInterviews).mockResolvedValue({ profileId: 1, items: [], total: 0 })
  render(<InterviewsPage />)
  expect(screen.getByRole('link', { name: '选择求职机会' })).toHaveAttribute('href', '/opportunities')
  expect(await screen.findByText('当前档案尚无面试记录。')).toBeInTheDocument()
})
it('读取失败显示错误，不显示为空记录', async () => {
  vi.mocked(loadInterviews).mockRejectedValue(new Error('离线读取失败'))
  render(<InterviewsPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('离线读取失败')
  expect(screen.queryByText('当前档案尚无面试记录。')).not.toBeInTheDocument()
})
it('拒绝显示其他档案的面试结果', async () => {
  vi.mocked(loadInterviews).mockResolvedValue({ profileId: 2, items: [], total: 0 })
  render(<InterviewsPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('档案已在其他窗口改变')
  expect(screen.queryByText('当前档案尚无面试记录。')).not.toBeInTheDocument()
})
