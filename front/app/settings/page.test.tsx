import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import SettingsPage from './page'

vi.mock('../env-config/HrAssistantSettingsCard', () => ({ default: ({ mode }: { mode: string }) => <p>通知设置视图：{mode}</p> }))
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('keeps system saves separate from HR actions and omits an unchanged configured secret', async () => {
  const writes: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') { writes.push(JSON.parse(String(init.body))); return response({ success: true }) }
    return response({ success: true, data: { AI_PROVIDER: 'codex', CODEX_MODEL: 'saved-model' }, sensitive: { API_KEY: true, HOOK_URL: false } })
  }))
  render(<SettingsPage />)
  fireEvent.change(await screen.findByDisplayValue('saved-model'), { target: { value: 'chosen-model' } })
  fireEvent.click(screen.getByRole('button', { name: '保存 AI 与企业微信配置' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toMatchObject({ AI_PROVIDER: 'codex', CODEX_MODEL: 'chosen-model' })
  expect(writes[0]).not.toHaveProperty('API_KEY')
  expect(screen.getByText('通知设置视图：connection')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '一键开启后台托管' })).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('keeps save disabled after a configuration read fails and shows a retry', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async () => response({ success: false }, 503)))
  render(<SettingsPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('获取配置失败')
  expect(screen.getByRole('button', { name: '保存 AI 与企业微信配置' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '重新加载' })).toBeEnabled()
})
