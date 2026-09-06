import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ProfileSwitcher from './ProfileSwitcher'

afterEach(() => vi.unstubAllGlobals())

it('keeps the original profile when the backend rejects switching during watch', async () => {
  const original = { id: 1, name: '求职者甲', isActive: 1 }
  const onChange = vi.fn()
  const alert = vi.fn()
  vi.stubGlobal('alert', alert)
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(
    url.endsWith('/activate')
      ? { success: false, errorCode: 'HR_WATCH_ACTIVE', message: '请先停止值守再切换人物档案' }
      : { success: true, data: [original, { id: 2, name: '求职者乙' }], current: original },
  ), { status: url.endsWith('/activate') ? 409 : 200, headers: { 'Content-Type': 'application/json' } }))))
  render(<ProfileSwitcher onProfileChange={onChange} />)
  fireEvent.click(await screen.findByRole('button', { name: '求职者甲' }))
  fireEvent.click(screen.getByText('求职者乙'))
  await waitFor(() => expect(alert).toHaveBeenCalledWith('请先停止值守再切换人物档案'))
  expect(screen.getByRole('button', { name: '求职者甲' })).toBeInTheDocument()
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledWith(original)
})
