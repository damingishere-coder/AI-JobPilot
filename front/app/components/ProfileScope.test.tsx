import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProfileScopeProvider, useProfileScope } from './ProfileScope'
import ProfileSwitcher from './ProfileSwitcher'
import { useUnsavedChanges } from '@/lib/use-unsaved-changes'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function Consumer({ dirty = false }: { dirty?: boolean }) {
  const scope = useProfileScope()
  useUnsavedChanges('备注', dirty)
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
