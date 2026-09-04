"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { API_BASE } from "@/lib/api"

type DeliveryAttempt = {
  requestKey?: string
  jobRowId?: number
  state?: string
  evidence?: string
  message?: string
  greetingSnapshot?: string
  greetingSource?: string
  greetingOutcome?: string
  greetingEvidence?: string
  requestedAt?: string
  resolvedAt?: string
  updatedAt?: string
}

function sourceLabel(source?: string) {
  if (source === "USER_EDITED") return "人工编辑稿"
  if (source === "AI_GREETING") return "岗位 JD 定制"
  if (source === "PROFILE_DEFAULT") return "AI 失败兜底（档案默认）"
  return source || "未记录"
}

function outcomeLabel(outcome?: string) {
  if (outcome === "CONFIRMED") return "精确话术已确认"
  if (outcome === "UNKNOWN") return "发送结果待人工核对"
  if (outcome === "NOT_SENT") return "未发送"
  if (outcome === "PENDING") return "等待发送结果"
  return outcome || "不适用"
}

export function BossDeliveryHistory({ refreshKey = 0 }: { refreshKey?: number }) {
  const [items, setItems] = useState<DeliveryAttempt[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/delivery-attempts?platform=boss&limit=50`, {
        cache: "no-store",
        signal,
      })
      if (!response.ok) throw new Error(`投递历史读取失败（HTTP ${response.status}）`)
      const data = await response.json()
      if (!Array.isArray(data)) throw new Error("投递历史响应格式不正确")
      setItems(data)
    } catch (loadError) {
      if (signal?.aborted) return
      setError(loadError instanceof Error ? loadError.message : "投递历史读取失败")
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, refreshKey])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">BOSS 投递历史</CardTitle>
            <CardDescription>最近 50 条任务的真实话术来源、快照与发送验证证据</CardDescription>
          </div>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
            {loading ? "刷新中..." : "刷新历史"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? <div className="mb-3 text-sm text-destructive">{error}</div> : null}
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {loading ? "正在读取投递历史..." : "当前档案暂无投递历史。"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">岗位</th>
                  <th className="px-3 py-2">任务状态</th>
                  <th className="px-3 py-2">话术来源</th>
                  <th className="px-3 py-2">话术验证</th>
                  <th className="px-3 py-2">确认时话术快照</th>
                  <th className="px-3 py-2">证据</th>
                  <th className="px-3 py-2">更新时间</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.requestKey || `${item.jobRowId || "job"}-${index}`} className="border-b align-top last:border-0">
                    <td className="px-3 py-3">#{item.jobRowId || "-"}</td>
                    <td className="px-3 py-3 font-medium">{item.state || "-"}</td>
                    <td className="px-3 py-3">{sourceLabel(item.greetingSource)}</td>
                    <td className="px-3 py-3">{outcomeLabel(item.greetingOutcome)}</td>
                    <td className="max-w-md whitespace-pre-wrap px-3 py-3 leading-6">{item.greetingSnapshot || "-"}</td>
                    <td className="px-3 py-3 text-xs leading-5 text-muted-foreground">
                      <div>平台：{item.evidence || "-"}</div>
                      <div>话术：{item.greetingEvidence || "-"}</div>
                      {item.message ? <div>{item.message}</div> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">
                      {item.resolvedAt || item.updatedAt || item.requestedAt || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
