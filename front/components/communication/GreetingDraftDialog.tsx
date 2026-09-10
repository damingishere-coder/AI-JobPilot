"use client"

import { useEffect, useId, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { API_BASE, friendlyApiError, localActionFetch, readApiResponse } from "@/lib/api"

export type GreetingView = {
  aiGreeting: string
  greetingDraft: string
  greetingSource: "USER_EDITED" | "AI_GREETING" | "PROFILE_DEFAULT" | "EMPTY"
  greetingUpdatedAt?: string | null
  finalGreeting: string
}

export type GreetingJob = GreetingView & {
  id: number
  companyName?: string
  jobName?: string
}

const sourceLabels: Record<GreetingView["greetingSource"], string> = {
  USER_EDITED: "人工编辑稿",
  AI_GREETING: "AI 原稿",
  PROFILE_DEFAULT: "档案默认话术",
  EMPTY: "空白警告",
}

export function GreetingDraftDialog({
  open,
  platform,
  job,
  confirmMode,
  submitting,
  onClose,
  onSaved,
  onConfirm,
}: {
  open: boolean
  platform: "boss" | "zhilian"
  job: GreetingJob | null
  confirmMode: boolean
  submitting: boolean
  onClose: () => void
  onSaved: () => Promise<void>
  onConfirm: (job: GreetingJob) => Promise<void>
}) {
  const titleId = useId()
  const descriptionId = useId()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [view, setView] = useState<GreetingView | null>(null)
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open || !job) return
    const nextView: GreetingView = {
      aiGreeting: job.aiGreeting || "",
      greetingDraft: job.greetingDraft || "",
      greetingSource: job.greetingSource || "EMPTY",
      greetingUpdatedAt: job.greetingUpdatedAt || null,
      finalGreeting: job.finalGreeting || "",
    }
    setView(nextView)
    setContent(nextView.greetingDraft || nextView.finalGreeting)
    setError("")
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }, [job, open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving && !submitting) onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onClose, open, saving, submitting])

  if (!open || !job || !view) return null

  const persist = async () => {
    const normalized = content.trim()
    if (!normalized) throw new Error("最终沟通话术为空，请先补充内容")
    const response = await localActionFetch(`${API_BASE}/api/platforms/${platform}/jobs/${job.id}/greeting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: normalized, expectedUpdatedAt: view.greetingUpdatedAt || null }),
    })
    const result = await readApiResponse<GreetingView>(response, "沟通草稿保存失败")
    if (!result.data) throw new Error("后端未返回最新沟通草稿")
    setView(result.data)
    setContent(result.data.finalGreeting)
    await onSaved()
    return result.data
  }

  const save = async () => {
    try {
      setSaving(true)
      setError("")
      await persist()
    } catch (saveError) {
      setError(friendlyApiError(saveError, "沟通草稿保存失败"))
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    try {
      setSaving(true)
      setError("")
      const query = view.greetingUpdatedAt
        ? `?expectedUpdatedAt=${encodeURIComponent(view.greetingUpdatedAt)}`
        : ""
      const response = await localActionFetch(`${API_BASE}/api/platforms/${platform}/jobs/${job.id}/greeting${query}`, {
        method: "DELETE",
      })
      const result = await readApiResponse<GreetingView>(response, "恢复 AI 原稿失败")
      if (!result.data) throw new Error("后端未返回恢复后的沟通话术")
      setView(result.data)
      setContent(result.data.finalGreeting)
      await onSaved()
    } catch (resetError) {
      setError(friendlyApiError(resetError, "恢复 AI 原稿失败"))
    } finally {
      setSaving(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setError("")
    } catch {
      setError("复制失败，请在文本框中手动全选复制")
      textareaRef.current?.select()
    }
  }

  const confirm = async () => {
    try {
      setSaving(true)
      setError("")
      let latest = view
      if (content.trim() !== view.finalGreeting.trim()) latest = await persist()
      if (!latest.finalGreeting.trim()) throw new Error("最终沟通话术为空，已阻止确认")
      await onConfirm({ ...job, ...latest })
    } catch (confirmError) {
      setError(friendlyApiError(confirmError, "确认失败"))
    } finally {
      setSaving(false)
    }
  }

  const busy = saving || submitting

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <div className="w-full max-w-2xl rounded-2xl border bg-background p-5 shadow-2xl">
        <div className="space-y-1">
          <h2 id={titleId} className="text-lg font-semibold">{confirmMode ? "核对最终沟通话术" : "编辑沟通草稿"}</h2>
          <p id={descriptionId} className="text-sm text-muted-foreground">
            {job.companyName || "未知公司"} · {job.jobName || "未命名岗位"}。当前来源：{
              platform === "boss" && view.greetingSource === "AI_GREETING"
                ? "岗位 JD 定制"
                : platform === "boss" && view.greetingSource === "PROFILE_DEFAULT"
                  ? "AI 失败兜底（档案默认）"
                  : sourceLabels[view.greetingSource]
            }。
          </p>
        </div>

        <div className="mt-5 space-y-2">
          <Label htmlFor={`${titleId}-content`}>最终将使用的话术</Label>
          <Textarea
            ref={textareaRef}
            id={`${titleId}-content`}
            value={content}
            maxLength={1000}
            rows={10}
            disabled={busy}
            onChange={(event) => setContent(event.target.value)}
            aria-invalid={Boolean(error)}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{platform === "boss"
              ? "优先级：人工编辑稿 → 岗位 JD 定制 → AI 失败兜底（档案默认）"
              : "优先级：人工编辑稿 → AI 原稿 → 档案默认话术"}</span>
            <span>{content.length}/1000</span>
          </div>
        </div>

        {view.aiGreeting && (
          <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="mb-1 font-medium">AI 原稿（只读）</div>
            <div className="whitespace-pre-wrap text-muted-foreground">{view.aiGreeting}</div>
          </div>
        )}

        <div className="mt-3 min-h-5 text-sm text-destructive" role="status" aria-live="polite">{error}</div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy || !view.greetingDraft} onClick={reset}>恢复 AI 原稿</Button>
          <Button variant="outline" disabled={busy || !content} onClick={copy}>复制</Button>
          <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="secondary" disabled={busy || !content.trim()} onClick={save}>{saving ? "保存中..." : "保存草稿"}</Button>
          {confirmMode && (
            <Button variant="success" disabled={busy || !content.trim()} onClick={confirm}>
              {submitting ? "执行中..." : "确认并交给 Chrome"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
