import { describe, expect, it } from 'vitest'
import { readWorkspaceQuery, workspaceHref } from './workspace-query'

describe('岗位工作区路由上下文', () => {
  it('允许直接访问历史结果并保留扫描、档案、查询及返回参数', () => {
    const params = new URLSearchParams('platform=boss&view=setup&scanRunId=run-1&profileId=3&query=采购&returnTo=%2Fopportunities')
    const href = workspaceHref(params, 'boss', 'results')
    expect(href).toContain('view=results')
    const next = new URLSearchParams(href.split('?')[1])
    expect(next.get('scanRunId')).toBe('run-1')
    expect(next.get('profileId')).toBe('3')
    expect(next.get('query')).toBe('采购')
    expect(next.get('returnTo')).toBe('/opportunities')
  })
  it('切换平台清除另一个平台的扫描范围', () => {
    expect(workspaceHref(new URLSearchParams('platform=boss&scanRunId=boss-run&profileId=3'), 'zhilian', 'results')).not.toContain('scanRunId')
  })
  it('无效平台和视图使用可访问的默认值', () => {
    expect(readWorkspaceQuery(new URLSearchParams('platform=invalid&view=invalid'))).toEqual({ platform: 'boss', view: 'setup', scanRunId: '' })
  })
})
