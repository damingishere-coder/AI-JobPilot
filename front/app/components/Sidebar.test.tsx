import { expect, it } from 'vitest'
import { activeWorkspace } from './Sidebar'

it('旧平台详情和推荐入口只属于一个主导航', () => {
  expect(activeWorkspace('/boss/analysis')).toBe('/discover')
  expect(activeWorkspace('/zhilian/analysis')).toBe('/discover')
  expect(activeWorkspace('/strategy/ranking')).toBe('/opportunities')
  expect(activeWorkspace('/ai-config')).toBe('/profiles')
  expect(activeWorkspace('/env-config')).toBe('/settings')
  expect(activeWorkspace('/hr')).toBe('/hr')
})
