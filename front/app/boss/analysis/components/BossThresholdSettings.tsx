"use client"

import { useCallback, useEffect, useState } from "react"
import { BiSave } from "react-icons/bi"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { API_BASE, friendlyApiError, readApiResponse } from "@/lib/api"

const DEFAULT_APPLY_THRESHOLD = 75
const DEFAULT_PRIORITY_APPLY_THRESHOLD = 65

type ThresholdConfig = {
  applyThreshold: number
  priorityApplyThreshold: number
}

const parseThreshold = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100 ? parsed : fallback
}

export function BossThresholdSettings() {
  const [thresholds, setThresholds] = useState<ThresholdConfig>({
    applyThreshold: DEFAULT_APPLY_THRESHOLD,
    priorityApplyThreshold: DEFAULT_PRIORITY_APPLY_THRESHOLD,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const loadThresholds = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/ai/thresholds`)
      const result = await readApiResponse<ThresholdConfig>(response, "分数线加载失败")
      setThresholds({
        applyThreshold: parseThreshold(result.data?.applyThreshold, DEFAULT_APPLY_THRESHOLD),
        priorityApplyThreshold: parseThreshold(
          result.data?.priorityApplyThreshold,
          DEFAULT_PRIORITY_APPLY_THRESHOLD,
        ),
      })
    } catch (loadError) {
      console.error("加载AI投递分数线失败:", loadError)
      setError(friendlyApiError(loadError, "分数线加载失败"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadThresholds()
  }, [loadThresholds])

  const saveThresholds = async () => {
    if (!Number.isInteger(thresholds.applyThreshold) || thresholds.applyThreshold < 0 || thresholds.applyThreshold > 100) {
      setError("普通公司分数线必须是0到100之间的整数")
      return
    }
    if (
      !Number.isInteger(thresholds.priorityApplyThreshold)
      || thresholds.priorityApplyThreshold < 0
      || thresholds.priorityApplyThreshold > 100
    ) {
      setError("优先公司分数线必须是0到100之间的整数")
      return
    }
    if (thresholds.priorityApplyThreshold > thresholds.applyThreshold) {
      setError("优先公司分数线不能高于普通公司分数线")
      return
    }

    setSaving(true)
    setMessage("")
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/ai/thresholds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(thresholds),
      })
      const result = await readApiResponse<ThresholdConfig>(response, "分数线保存失败")
      const savedThresholds = {
        applyThreshold: parseThreshold(result.data?.applyThreshold, thresholds.applyThreshold),
        priorityApplyThreshold: parseThreshold(
          result.data?.priorityApplyThreshold,
          thresholds.priorityApplyThreshold,
        ),
      }
      setThresholds(savedThresholds)
      setMessage(`已保存：普通公司${savedThresholds.applyThreshold}分，优先公司${savedThresholds.priorityApplyThreshold}分`)
    } catch (saveError) {
      console.error("保存AI投递分数线失败:", saveError)
      setError(friendlyApiError(saveError, "分数线保存失败"))
    } finally {
      setSaving(false)
    }
  }

  const disabled = loading || saving

  return (
    <div className="mt-4 rounded-lg border border-blue-200/70 bg-blue-50/60 p-3 dark:border-blue-400/20 dark:bg-blue-500/10">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[150px] flex-1 space-y-1.5 sm:max-w-[190px]">
          <Label htmlFor="boss-apply-threshold">普通公司最低分</Label>
          <div className="flex items-center gap-2">
            <Input
              id="boss-apply-threshold"
              type="number"
              min={0}
              max={100}
              step={1}
              value={thresholds.applyThreshold}
              onChange={(event) => {
                const applyThreshold = Number(event.target.value)
                setThresholds((current) => ({
                  applyThreshold,
                  priorityApplyThreshold: Math.min(current.priorityApplyThreshold, applyThreshold),
                }))
                setMessage("")
                setError("")
              }}
              disabled={disabled}
              className="h-9"
            />
            <span className="text-sm text-muted-foreground">分</span>
          </div>
        </div>

        <div className="min-w-[150px] flex-1 space-y-1.5 sm:max-w-[190px]">
          <Label htmlFor="boss-priority-apply-threshold">优先公司最低分</Label>
          <div className="flex items-center gap-2">
            <Input
              id="boss-priority-apply-threshold"
              type="number"
              min={0}
              max={thresholds.applyThreshold}
              step={1}
              value={thresholds.priorityApplyThreshold}
              onChange={(event) => {
                setThresholds((current) => ({
                  ...current,
                  priorityApplyThreshold: Number(event.target.value),
                }))
                setMessage("")
                setError("")
              }}
              disabled={disabled}
              className="h-9"
            />
            <span className="text-sm text-muted-foreground">分</span>
          </div>
        </div>

        <Button type="button" size="sm" onClick={saveThresholds} disabled={disabled}>
          <BiSave className="mr-1" />
          {saving ? "保存中..." : loading ? "加载中..." : "保存分数线"}
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        AI分数达到或超过对应分数线后进入“待确认”，仍需你确认才会实际投递。
      </p>
      {message ? <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">{message}</p> : null}
      {error ? <p className="mt-1 text-xs text-red-600 dark:text-red-300">{error}</p> : null}
    </div>
  )
}
