import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Select } from './select'

afterEach(() => vi.unstubAllGlobals())

it('底部菜单向上展开，并随窗口变化重新定位；选择选项后关闭', () => {
  vi.stubGlobal('innerHeight', 600)
  vi.stubGlobal('innerWidth', 800)
  const onChange = vi.fn()
  render(<Select value="20" onChange={onChange}><option value="20">20</option><option value="25">25</option></Select>)
  const trigger = screen.getByRole('button')
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ top: 540, bottom: 580, left: 20, width: 500 } as DOMRect)
  fireEvent.click(trigger)
  const panel = screen.getByRole('listbox').parentElement!
  expect(Number.parseFloat(panel.style.top) + Number.parseFloat(panel.style.maxHeight)).toBeLessThanOrEqual(540)
  vi.stubGlobal('innerHeight', 900)
  fireEvent.resize(window)
  expect(panel.style.top).toBe('588px')
  fireEvent.click(screen.getByRole('option', { name: '25' }))
  expect(onChange).toHaveBeenCalledWith({ target: { value: '25' } })
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

it('小窗口菜单限制高度和宽度，并支持 Escape 关闭', () => {
  vi.stubGlobal('innerHeight', 180)
  vi.stubGlobal('innerWidth', 300)
  render(<Select value="20"><option value="20">20</option></Select>)
  const trigger = screen.getByRole('button')
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ top: 50, bottom: 90, left: 260, width: 500 } as DOMRect)
  fireEvent.click(trigger)
  const panel = screen.getByRole('listbox').parentElement!
  expect(panel.style.maxHeight).toBe('74px')
  expect(panel.style.width).toBe('284px')
  expect(panel.style.left).toBe('8px')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})
