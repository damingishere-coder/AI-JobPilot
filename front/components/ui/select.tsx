import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

type OptionItem = { value: string; label: React.ReactNode }

export interface SelectProps {
  value?: string
  onChange?: (e: { target: { value: string } }) => void
  placeholder?: string
  className?: string
  id?: string
  disabled?: boolean
  children?: React.ReactNode
}

const Select = React.forwardRef<HTMLDivElement, SelectProps>(
  ({ className, children, value, onChange, placeholder, disabled, id, ...props }, ref) => {
    const [open, setOpen] = React.useState(false)
    const [mounted, setMounted] = React.useState(false)
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
        .filter((c) => React.isValidElement(c) && (c as any).type === 'option')
        .map((c: any) => ({ value: String(c.props.value ?? c.props.children), label: c.props.children }))
    }, [children])

    const selected = options.find((o) => String(value ?? '') === String(o.value))

    const emitChange = (val: string) => onChange?.({ target: { value: val } } as any)

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
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "flex h-10 w-full rounded-lg border border-slate-200 bg-white/90 px-4 py-2 pr-8 text-sm text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all duration-200 hover:border-blue-200 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-100",
              disabled ? "cursor-not-allowed opacity-50" : "focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-400 dark:focus:ring-blue-500/20",
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
              <ul className="py-1" role="listbox">
                {options.map((o) => {
                  const active = String(value ?? '') === String(o.value)
                  return (
                    <li
                      key={String(o.value)}
                      role="option"
                      aria-selected={active}
                      className={cn(
                        "group flex cursor-pointer items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 transition-all last:border-b-0 dark:border-white/10",
                        active ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200" : "hover:bg-slate-50 dark:hover:bg-white/5"
                      )}
                      onClick={() => {
                        emitChange(String(o.value))
                        setOpen(false)
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
