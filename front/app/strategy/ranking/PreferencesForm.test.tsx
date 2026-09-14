import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import PreferencesForm from './PreferencesForm'
import type { RankingSettings } from '@/lib/ranking'

afterEach(cleanup)
const settings: RankingSettings = { profileId: 1, version: 0, enabled: false, preferences: { roles: [], cities: [], scales: [], industries: [], workModes: [], minSalaryK: null, maxSalaryK: null, hard: [] } }
it('keeps preview separate from saving and never assumes blank preferences', () => {
  const preview = vi.fn(), save = vi.fn()
  render(<PreferencesForm settings={settings} busy={false} onPreview={preview} onSave={save} onDisable={vi.fn()} />)
  expect(save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('岗位方向关键词'), { target: { value: 'AI应用运营，产品运营' } })
  fireEvent.click(screen.getByText('预览草稿排序'))
  expect(preview).toHaveBeenCalledWith(expect.objectContaining({ roles: ['AI应用运营', '产品运营'], cities: [], minSalaryK: null }))
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('保存偏好并启用推荐排序'))
  expect(save).toHaveBeenCalledOnce()
  expect(screen.getByText(/既有搜索配置、已确认批次/)).toBeInTheDocument()
})
it('offers explicit restoration without overwriting the draft as a side effect', () => {
  const disable = vi.fn(), save = vi.fn()
  render(<PreferencesForm settings={{ ...settings, enabled: true }} busy={false} onPreview={vi.fn()} onSave={save} onDisable={disable} />)
  fireEvent.click(screen.getByText('关闭策略排序，恢复历史分排序'))
  expect(disable).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled()
})
