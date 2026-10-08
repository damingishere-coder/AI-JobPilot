import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AppShell from './AppShell'
import { useUnsavedChanges } from '@/lib/use-unsaved-changes'

const state = vi.hoisted(() => ({ refresh: vi.fn().mockResolvedValue({}), conflicted: true, loading: false, current: { id: 1 } as { id: number } | null }))
vi.mock('next/navigation', () => ({ usePathname: () => '/profiles' }))
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }))
vi.mock('./ProfileScope', () => ({ useProfileScope: () => ({ current: state.current, loading: state.loading, error: state.conflicted ? '档案已在其他窗口改变' : '', conflicted: state.conflicted, refresh: state.refresh }) }))
vi.mock('./ProfileSwitcher', () => ({ default: () => <span>全局档案</span> }))
vi.mock('./Sidebar', () => ({ default: () => <span>导航</span> }))
vi.mock('@/lib/chromeBridge', () => ({ getChromeBridgeStatus: async () => ({ success: false }) }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); state.conflicted = true; state.loading = false; state.current = { id: 1 }; state.refresh.mockClear() })

function Draft() { useUnsavedChanges('简历', true); return <textarea aria-label="简历草稿" defaultValue="保留的输入" /> }

it('blocks the stale business area and requires explicit draft abandonment before loading another profile', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ready: true }), { headers: { 'Content-Type': 'application/json' } })))
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<AppShell><Draft /></AppShell>)
  expect(document.querySelector('#workspace-content')?.parentElement).toHaveAttribute('inert')
  expect(document.querySelector('textarea')).toHaveValue('保留的输入')
  fireEvent.click(screen.getByRole('button', { name: '放弃草稿并读取当前档案' }))
  expect(state.refresh).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: '放弃草稿并读取当前档案' }))
  await waitFor(() => expect(state.refresh).toHaveBeenCalledWith(true))
})

it('waits for the initial profile before mounting editable content and keeps drafts mounted during later refreshes', async () => {
  state.conflicted = false; state.loading = true; state.current = null
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ready: true }), { headers: { 'Content-Type': 'application/json' } })))
  const view = render(<AppShell><Draft /></AppShell>)
  expect(screen.queryByRole('textbox', { name: '简历草稿' })).not.toBeInTheDocument()
  expect(screen.getByText('正在读取当前档案，稍后即可编辑…')).toBeInTheDocument()
  state.loading = false; state.current = { id: 1 }
  view.rerender(<AppShell><Draft /></AppShell>)
  const input = await screen.findByRole('textbox', { name: '简历草稿' })
  fireEvent.change(input, { target: { value: '刷新时仍保留的新草稿' } })
  state.loading = true
  view.rerender(<AppShell><Draft /></AppShell>)
  expect(screen.getByRole('textbox', { name: '简历草稿' })).toHaveValue('刷新时仍保留的新草稿')
})
