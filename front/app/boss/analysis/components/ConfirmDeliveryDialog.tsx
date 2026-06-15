"use client"

import { useRef } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function ConfirmDeliveryDialog({
  open,
  title,
  content,
  onClose,
}: {
  open: boolean
  title: string
  content: string
  onClose: () => void
}) {
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)

  if (!open) return null

  const selectText = () => {
    textAreaRef.current?.select()
  }

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(content || "")
      alert("已复制到剪贴板")
    } catch {
      try {
        const textarea = document.createElement("textarea")
        textarea.value = content || ""
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand("copy")
        document.body.removeChild(textarea)
        alert("已复制到剪贴板")
      } catch {
        alert("复制失败，请手动选中复制")
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-[92%] max-w-3xl border border-gray-200 dark:border-neutral-800 animate-in fade-in zoom-in-95">
        <Card className="border-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">{title}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <textarea
              ref={textAreaRef}
              readOnly
              value={content || ""}
              className="w-full h-[50vh] text-sm leading-6 rounded-md border p-2 bg-muted/30 dark:bg-neutral-800"
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={selectText} className="rounded-lg px-4">全选</Button>
              <Button variant="success" onClick={copyText} className="rounded-lg px-4">复制</Button>
              <Button onClick={onClose} className="rounded-lg px-4">关闭</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
