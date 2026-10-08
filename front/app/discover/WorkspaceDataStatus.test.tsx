import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceDataStatus, readWorkspaceResponse } from './WorkspaceDataStatus'

describe('岗位读取状态', () => {
  it('失败保留上次记录并提供明确重试', () => {
    const retry = vi.fn()
    render(<WorkspaceDataStatus loading={false} error="服务暂时不可用" updatedAt={1} hasData onRetry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('当前显示上次成功加载的记录')
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
  it('拒绝 HTTP 和业务失败，不返回可被误解为空列表的错误对象', async () => {
    await expect(readWorkspaceResponse({ ok: false, status: 500, json: async () => ({ message: '数据库不可用' }) } as Response, '岗位读取')).rejects.toThrow('数据库不可用')
    await expect(readWorkspaceResponse({ ok: true, status: 200, json: async () => ({ success: false, message: '档案已切换' }) } as Response, '岗位读取')).rejects.toThrow('档案已切换')
  })
})
