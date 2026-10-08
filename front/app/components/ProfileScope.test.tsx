import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProfileScopeProvider, useProfileScope } from './ProfileScope'
import ProfileSwitcher from './ProfileSwitcher'
import { useUnsavedChanges } from '@/lib/use-unsaved-changes'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('serializes concurrent activation attempts from global and management switchers until the first response finishes', async () => {
  const profiles = [{ id: 1, name: '求职者甲', isActive: 1 }, { id: 2, name: '求职者乙' }, { id: 3, name: '求职者丙' }]
  let active = profiles[0]
  let resolveActivation!: (response: Response) => void
  const pendingActivation = new Promise<Response>(resolve => { resolveActivation = resolve })
  const jsonResponse = (payload: unknown) => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } })
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/2/activate') && init?.method === 'POST') return pendingActivation
    if (url.endsWith('/3/activate') && init?.method === 'POST') {
      active = profiles[2]
      return jsonResponse({ success: true, data: active })
    }
    return jsonResponse({ success: true, data: profiles, current: active })
  })
  vi.stubGlobal('fetch', fetchMock)
  const onChange = vi.fn()
  render(<ProfileScopeProvider>
    <section aria-label="顶栏档案"><ProfileSwitcher presentation="global" /></section>
    <section aria-label="档案管理"><ProfileSwitcher management onProfileChange={onChange} /></section>
  </ProfileScopeProvider>)
  const global = within(screen.getByRole('region', { name: '顶栏档案' }))
  const management = within(screen.getByRole('region', { name: '档案管理' }))
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
  fireEvent.click(global.getByRole('button', { name: '求职者甲' }))
  fireEvent.click(management.getByRole('button', { name: '求职者甲' }))
  const menus = screen.getAllByRole('listbox')
  const firstSelection = within(menus[0]).getByRole('option', { name: '求职者乙' })
  const concurrentSelection = within(menus[1]).getByRole('option', { name: '求职者丙' })
  // Both callbacks run before the deferred backend response can unlock the shared scope.
  act(() => {
    fireEvent.click(firstSelection)
    fireEvent.click(concurrentSelection)
  })
  const activations = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
  expect(activations()).toHaveLength(1)
  expect(String(activations()[0][0])).toMatch(/\/2\/activate$/)
  expect(global.getByRole('button', { name: '求职者甲' })).toBeDisabled()
  expect(management.getByRole('button', { name: '求职者甲' })).toBeDisabled()
  expect(onChange).toHaveBeenCalledTimes(1)

  await act(async () => {
    active = profiles[1]
    resolveActivation(jsonResponse({ success: true, data: active }))
    await pendingActivation
  })
  await waitFor(() => expect(global.getByRole('button', { name: '求职者乙' })).toBeEnabled())
  expect(management.getByRole('button', { name: '求职者乙' })).toBeEnabled()
  expect(onChange).toHaveBeenLastCalledWith(profiles[1])
  fireEvent.click(management.getByRole('button', { name: '求职者乙' }))
  fireEvent.click(screen.getByRole('option', { name: '求职者丙' }))
  await waitFor(() => expect(global.getByRole('button', { name: '求职者丙' })).toBeEnabled())
  expect(activations()).toHaveLength(2)
  expect(onChange).toHaveBeenLastCalledWith(profiles[2])
})

function Consumer({ dirty = false }: { dirty?: boolean }) {
  const scope = useProfileScope()
  useUnsavedChanges('备注', dirty && Boolean(scope?.current))
  return <>
    <span data-testid="current">{scope?.current?.name}</span>
    <span data-testid="error">{scope?.error}</span>
    <button disabled={scope?.conflicted}>保存测试草稿</button>
    <ProfileSwitcher presentation="global" />
    <ProfileSwitcher onProfileChange={() => {}} />
  </>
}

it('shares a single current profile and cancels activation before posting when a draft is protected', async () => {
  const profiles = [{ id: 1, name: '求职者甲', isActive: 1 }, { id: 2, name: '求职者乙' }]
  let active = profiles[0]
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/2/activate')) active = profiles[1]
    return new Response(JSON.stringify({ success: true, data: profiles, current: active }), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<ProfileScopeProvider><Consumer dirty /></ProfileScopeProvider>)
  await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('求职者甲'))
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('新建档案')).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: '求职者甲' }))
  fireEvent.click(screen.getByText('求职者乙'))
  expect(confirmation).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('current')).toHaveTextContent('求职者甲')
  expect(screen.getByRole('button', { name: '保存测试草稿' })).toBeEnabled()
})

it('does not notify business forms again when the same profile is renamed', async () => {
  const onChange = vi.fn()
  let current = { id: 1, name: '求职者甲', isActive: 1 }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: [current], current }), { headers: { 'Content-Type': 'application/json' } })))
  render(<ProfileScopeProvider><ProfileSwitcher presentation="global" /><ProfileSwitcher onProfileChange={onChange} /></ProfileScopeProvider>)
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
  current = { ...current, name: '新档案名称' }
  fireEvent(window, new Event('focus'))
  await screen.findByRole('button', { name: '新档案名称' })
  expect(onChange).toHaveBeenCalledTimes(1)
})

it('keeps drafts in the original profile when another window changes the active profile', async () => {
  const first = { id: 1, name: '求职者甲', isActive: 1 }
  const second = { id: 2, name: '求职者乙', isActive: 0 }
  let active = first
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: [first, second], current: active }), { headers: { 'Content-Type': 'application/json' } })))
  const view = render(<ProfileScopeProvider><Consumer dirty /></ProfileScopeProvider>)
  await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('求职者甲'))
  active = second
  fireEvent(window, new Event('focus'))
  await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('当前草稿已保留'))
  expect(screen.getByTestId('current')).toHaveTextContent('求职者甲')
  expect(screen.getByRole('button', { name: '保存测试草稿' })).toBeDisabled()
  view.rerender(<ProfileScopeProvider><Consumer dirty={false} /></ProfileScopeProvider>)
  fireEvent(window, new Event('focus'))
  await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('求职者乙'))
  expect(screen.getByTestId('error')).toBeEmptyDOMElement()
  expect(screen.getByRole('button', { name: '保存测试草稿' })).toBeEnabled()
})

function RecoveredGlobalDraft() {
  const scope = useProfileScope()
  useUnsavedChanges('全局设置', Boolean(scope?.error))
  return <><span data-testid="recovery-profile">{scope?.current?.id ?? 'none'}</span><span data-testid="recovery-error">{scope?.error}</span><input aria-label="全局设置草稿" defaultValue="保留的全局输入" /></>
}

it('preserves global drafts after an initial profile failure when a later refresh discovers an active profile', async () => {
  let failed = true
  vi.stubGlobal('fetch', vi.fn(async () => failed
    ? new Response(JSON.stringify({ success: false, message: '档案暂不可用' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    : new Response(JSON.stringify({ success: true, data: [{ id: 1, name: '求职者甲', isActive: 1 }], current: { id: 1, name: '求职者甲' } }), { headers: { 'Content-Type': 'application/json' } })))
  render(<ProfileScopeProvider><RecoveredGlobalDraft /></ProfileScopeProvider>)
  await waitFor(() => expect(screen.getByTestId('recovery-error')).toHaveTextContent('档案暂不可用'))
  fireEvent.change(screen.getByRole('textbox', { name: '全局设置草稿' }), { target: { value: '失败后编辑的草稿' } })
  failed = false
  fireEvent(window, new Event('focus'))
  await waitFor(() => expect(screen.getByTestId('recovery-error')).toHaveTextContent('当前草稿已保留'))
  expect(screen.getByTestId('recovery-profile')).toHaveTextContent('none')
  expect(screen.getByRole('textbox', { name: '全局设置草稿' })).toHaveValue('失败后编辑的草稿')
})
