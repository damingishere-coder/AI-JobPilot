import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AnalysisBasis from './AnalysisBasis'

afterEach(() => vi.unstubAllGlobals())
const response = (data: unknown) => ({ ok: true, json: async () => data })
it('显示当前档案已保存简历及扫描关键词，明确历史分数不会自动重算', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ profileId: 4, sourceFilename: '最新简历.pdf', resumeUpdatedAt: '2026-09-09T10:00:00', resumeText: '求职意向：内容运营，不考虑保险销售', keywords: '内容运营,用户运营', introduce: '最新的技能介绍', applyThreshold: 60 })))
  render(<AnalysisBasis profileId={4} />)
  expect(await screen.findByText('最新简历.pdf')).toBeInTheDocument()
  expect(screen.getByText('内容运营,用户运营')).toBeInTheDocument()
  expect(screen.getByText(/不会自动重算历史岗位分数/)).toBeInTheDocument()
  fireEvent.click(screen.getByText('查看当前保存的简历文本'))
  expect(screen.getByText('求职意向：内容运营，不考虑保险销售')).toBeInTheDocument()
})
it('接口返回其他档案时不显示其简历或关键词', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ profileId: 7, sourceFilename: '其他人的简历.pdf', resumeText: '其他人的内容' })))
  render(<AnalysisBasis profileId={4} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('档案已变化')
  expect(screen.queryByText('其他人的内容')).not.toBeInTheDocument()
  expect(screen.queryByText('其他人的简历.pdf')).not.toBeInTheDocument()
})
