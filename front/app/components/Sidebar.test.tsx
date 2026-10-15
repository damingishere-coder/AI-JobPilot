import { expect, it } from 'vitest'
import { activeWorkspace } from './Sidebar'

it('恢复平台独立导航，分析页只选中对应分析入口，兼容入口仍归入原配置页', () => {
  expect(activeWorkspace('/boss')).toBe('/boss')
  expect(activeWorkspace('/boss/analysis')).toBe('/boss/analysis')
  expect(activeWorkspace('/zhilian/analysis')).toBe('/zhilian/analysis')
  expect(activeWorkspace('/strategy/ranking')).toBe('/strategy')
  expect(activeWorkspace('/ai-config')).toBe('/ai-config')
  expect(activeWorkspace('/profiles')).toBe('/ai-config')
  expect(activeWorkspace('/env-config')).toBe('/env-config')
  expect(activeWorkspace('/hr')).toBe('/env-config')
})
