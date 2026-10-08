import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

type OptionItem = { value: string; label: React.ReactNode; disabled?: boolean }

export interface SelectProps {
  value?: string
  onChange?: (e: { target: { value: string } }) => void
  placeholder?: string
  className?: string
  id?: string
  disabled?: boolean
  children?: React.ReactNode
  'aria-label'?: string
}

const Select = React.forwardRef<HTMLDivElement, SelectProps>(
  ({ className, children, value, onChange, placeholder, disabled, id, 'aria-label': ariaLabel, ...props }, ref) => {
    const [open, setOpen] = React.useState(false)
    const [mounted, setMounted] = React.useState(false)
    const listId = React.useId()
    const [focusedIndex, setFocusedIndex] = React.useState(0)
    const wrapperRef = React.useRef<HTMLDivElement>(null)
    const buttonRef = React.useRef<HTMLButtonElement>(null)
    const dropdownRef = React.useRef<HTMLDivElement>(null)
    const [dropdownPosition, setDropdownPosition] = React.useState({ top: 0, left: 0, width: 0, maxHeight: 224 })

    // 确保组件已挂载（解决 SSR 问题）
    React.useEffect(() => {
      setMounted(true)
    }, [])

    const options = React.useMemo<OptionItem[]>(() => {
      return React.Children.toArray(children)
        .filter((child): child is React.ReactElement<React.OptionHTMLAttributes<HTMLOptionElement>> => React.isValidElement(child) && child.type === 'option')
        .map(child => ({ value: String(child.props.value ?? child.props.children), label: child.props.children, disabled: child.props.disabled }))
    }, [children])

    const selected = options.find((o) => String(value ?? '') === String(o.value))
    React.useEffect(() => {
      // A parent may disable a selector while its portal is already open.
      if (disabled) setOpen(false)
    }, [disabled])

    const emitChange = (val: string) => onChange?.({ target: { value: val } })
    const openMenu = () => {
      if (disabled) return
      setFocusedIndex(Math.max(0, options.findIndex(option => option.value === String(value ?? ''))))
      setOpen(true)
    }
    const choose = (index: number) => {
      const option = options[index]
      if (disabled || !option || option.disabled) return
      emitChange(option.value); setOpen(false); buttonRef.current?.focus()
    }
    const keyboard = (event: React.KeyboardEvent<HTMLElement>) => {
      if (disabled) return
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); buttonRef.current?.focus(); return }
      if (event.key === 'Tab') { setOpen(false); buttonRef.current?.focus(); return }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        if (!options.length) return
        if (!open) { openMenu(); return }
        const step = event.key === 'ArrowUp' ? -1 : 1
        let next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (focusedIndex + step + options.length) % options.length
        for (let tries = 0; tries < options.length && options[next]?.disabled; tries++) next = (next + step + options.length) % options.length
        setFocusedIndex(next)
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); if (open) choose(focusedIndex); else openMenu()
      }
    }
    React.useEffect(() => {
      if (open) document.getElementById(`${listId}-${focusedIndex}`)?.scrollIntoView?.({ block: 'nearest' })
    }, [open, listId, focusedIndex])
    React.useEffect(() => { if (open && mounted) document.getElementById(listId)?.focus() }, [open, mounted, listId])

    // 计算下拉框位置
    const updatePosition = React.useCallback(() => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect()
        const margin = 8
        const viewport = window.visualViewport
        const viewportTop = viewport?.offsetTop ?? 0
        const viewportLeft = viewport?.offsetLeft ?? 0
        const viewportHeight = viewport?.height ?? window.innerHeight
        const viewportWidth = viewport?.width ?? window.innerWidth
        const below = Math.max(0, viewportTop + viewportHeight - rect.bottom - margin * 2)
        const above = Math.max(0, rect.top - viewportTop - margin * 2)
        const preferredHeight = Math.min(224, dropdownRef.current?.scrollHeight || 224)
        const openAbove = below < preferredHeight && above > below
        const maxHeight = Math.min(224, openAbove ? above : below)
        const height = Math.min(preferredHeight, maxHeight)
        const width = Math.min(rect.width, Math.max(0, viewportWidth - margin * 2))
        setDropdownPosition({
          top: Math.max(viewportTop + margin, Math.min(openAbove ? rect.top - margin - height : rect.bottom + margin, viewportTop + viewportHeight - margin - height)),
          left: Math.max(viewportLeft + margin, Math.min(rect.left, viewportLeft + viewportWidth - width - margin)),
          width,
          maxHeight,
        })
      }
    }, [])

    // 打开时计算位置
    React.useLayoutEffect(() => {
      if (open) {
        updatePosition()
        // 监听滚动和窗口大小变化，更新位置
        const handleUpdate = () => updatePosition()
        window.addEventListener('scroll', handleUpdate, true)
        window.addEventListener('resize', handleUpdate)
        window.visualViewport?.addEventListener('resize', handleUpdate)
        window.visualViewport?.addEventListener('scroll', handleUpdate)
        return () => {
          window.removeEventListener('scroll', handleUpdate, true)
          window.removeEventListener('resize', handleUpdate)
          window.visualViewport?.removeEventListener('resize', handleUpdate)
          window.visualViewport?.removeEventListener('scroll', handleUpdate)
        }
      }
    }, [open, updatePosition])

    // 点击外部关闭下拉框
    React.useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node
        // 检查点击是否在按钮或下拉框内
        const clickedButton = wrapperRef.current?.contains(target)
        const clickedDropdown = dropdownRef.current?.contains(target)

        if (!clickedButton && !clickedDropdown) {
          setOpen(false)
        }
      }

      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          setOpen(false)
          buttonRef.current?.focus()
        }
      }

      if (open) {
        document.addEventListener('mousedown', handleClickOutside)
        document.addEventListener('keydown', handleEscape)
      }

      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        document.removeEventListener('keydown', handleEscape)
      }
    }, [open])

    return (
      <div ref={ref} {...props}>
        <div ref={wrapperRef} className="relative">
          <button
            ref={buttonRef}
            id={id as string}
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={ariaLabel}
            aria-controls={open ? listId : undefined}
            onKeyDown={keyboard}
            onClick={() => { if (open) setOpen(false); else openMenu() }}
            className={cn(
              "flex h-10 min-w-0 w-full rounded-lg border border-input bg-card px-3 py-2 pr-8 text-sm text-foreground transition-colors hover:border-primary/40",
              disabled ? "cursor-not-allowed opacity-50" : "focus:outline-none focus:ring-2 focus:ring-ring/25 focus:border-primary",
              // 自定义箭头（浅灰）
              "bg-[url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"%2364748b\" stroke-width=\"2\"><path d=\"M6 9l6 6 6-6\"/></svg>')] bg-no-repeat bg-[length:16px_16px] bg-[position:right_12px_center]",
              className
            )}
          >
            <span className="truncate text-sm">{selected ? selected.label : (placeholder ?? '')}</span>
          </button>

          {open && mounted && createPortal(
            <div
              ref={dropdownRef}
              className="dropdown-panel"
              style={{
                top: `${dropdownPosition.top}px`,
                left: `${dropdownPosition.left}px`,
                width: `${dropdownPosition.width}px`,
                maxHeight: `${dropdownPosition.maxHeight}px`,
              }}
            >
              <ul className="py-1" role="listbox" id={listId} aria-label={ariaLabel} tabIndex={-1} onKeyDown={keyboard} aria-activedescendant={`${listId}-${focusedIndex}`}>
                {options.map((o, index) => {
                  const active = String(value ?? '') === String(o.value)
                  return (
                    <li
                      key={String(o.value)}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={active}
                      aria-disabled={o.disabled || undefined}
                      className={cn(
                        "group flex cursor-pointer items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 transition-all last:border-b-0 dark:border-white/10",
                        active || focusedIndex === index ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200" : "hover:bg-slate-50 dark:hover:bg-white/5",
                        o.disabled && 'cursor-not-allowed opacity-50'
                      )}
                      onClick={() => {
                        choose(index)
                      }}
                    >
                      <span className="flex items-center gap-3">
                        <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 bg-white shadow-inner transition-all dark:border-white/20 dark:bg-white/10", active && "border-blue-400 bg-blue-500")}></span>
                        <span className="text-sm truncate">{o.label}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>,
            document.body
          )}
        </div>
      </div>
    )
  }
)
Select.displayName = "Select"

export { Select }
