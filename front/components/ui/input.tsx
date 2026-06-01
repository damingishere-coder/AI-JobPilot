import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-slate-200 bg-white/90 px-4 py-2 text-sm text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all duration-200 hover:border-blue-200 hover:bg-white focus-visible:border-blue-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:focus-visible:ring-blue-500/20",
          // 文件输入与占位
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "placeholder:text-muted-foreground",
          // 禁用态
          "disabled:cursor-not-allowed disabled:opacity-50",
          // 覆盖浏览器自动填充样式
          "[&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_rgba(255,255,255,0.95)]",
          "[&:-webkit-autofill:hover]:shadow-[inset_0_0_0_1000px_rgba(255,255,255,0.98)]",
          "[&:-webkit-autofill:focus]:shadow-[inset_0_0_0_1000px_rgba(255,255,255,0.98)]",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
