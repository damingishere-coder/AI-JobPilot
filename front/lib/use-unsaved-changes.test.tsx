import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { confirmNavigation, hasUnsavedChanges, useUnsavedChanges } from './use-unsaved-changes'

afterEach(() => vi.restoreAllMocks())
function Draft({ dirty }: { dirty: boolean }) {
  useUnsavedChanges('机会备注', dirty)
  return <a href="/hr">查看 HR</a>
}
it('保护内部导航、刷新和浏览器返回；保存或卸载后释放保护', () => {
  window.history.replaceState(null, '', '/opportunities?id=1')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const view = render(<Draft dirty />)
  expect(hasUnsavedChanges()).toBe(true)
  const click = new MouseEvent('click', { bubbles: true, cancelable: true })
  screen.getByRole('link').dispatchEvent(click)
  expect(click.defaultPrevented).toBe(true)
  expect(confirm).toHaveBeenCalledTimes(1)
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
  window.history.replaceState(null, '', '/hr')
  fireEvent.popState(window)
  expect(window.location.pathname).toBe('/opportunities')
  view.rerender(<Draft dirty={false} />)
  expect(confirmNavigation()).toBe(true)
  view.unmount()
  expect(hasUnsavedChanges()).toBe(false)
})
it('多个区域分别注册，保存一个区域仍保护其他草稿', () => {
  const one = render(<Draft dirty />)
  const two = render(<Draft dirty />)
  one.rerender(<Draft dirty={false} />)
  expect(hasUnsavedChanges()).toBe(true)
  two.unmount()
  expect(hasUnsavedChanges()).toBe(false)
})
