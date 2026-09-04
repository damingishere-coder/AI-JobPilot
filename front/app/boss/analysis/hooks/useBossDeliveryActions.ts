"use client"

import { useCallback, useState } from "react"

import { API_BASE, readApiResponse } from "@/lib/api"
import { sendChromeBridgeMessage } from "@/lib/chromeBridge"
import type { BossJob, FilterState } from "../types"

type ReservedTask = { id?: number; requestKey?: string }
type BatchPreviewItem = { id?: number; companyName?: string; jobName?: string; greeting?: string; greetingSource?: string; empty?: boolean }

function greetingSourceLabel(source?: string) {
  if (source === "USER_EDITED") return "人工编辑稿"
  if (source === "AI_GREETING") return "岗位 JD 定制"
  if (source === "PROFILE_DEFAULT") return "AI 失败兜底（档案默认）"
  return "空白警告"
}

function greetingSnapshots(items: BatchPreviewItem[]) {
  return Object.fromEntries(items
    .filter((item): item is BatchPreviewItem & { id: number; greeting: string } => (
      typeof item.id === "number" && typeof item.greeting === "string"
    ))
    .map((item) => [String(item.id), item.greeting]))
}

async function postJsonWithRetry(url: string, body?: unknown) {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return await response.json()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error("投递请求未收到响应")
}

function unresolvedReservations(tasks: ReservedTask[], result: Record<string, unknown>) {
  const rows = Array.isArray(result.results) ? result.results : []
  if (rows.length === 0) return tasks
  const persistedKeys = new Set(rows.map((row) => {
    if (!row || typeof row !== "object") return ""
    const item = row as { requestKey?: unknown; persisted?: unknown }
    return item.persisted === true ? String(item.requestKey || "") : ""
  }))
  return tasks.filter((task) => !task.requestKey || !persistedKeys.has(task.requestKey))
}

function formatBatchDeliveryResult(result: Record<string, unknown>) {
  const summary = String(result.message || "批量投递任务已结束。")
  const rows = Array.isArray(result.results) ? result.results : []
  if (rows.length === 0) return summary
  const details = rows.slice(0, 50).map((row, index) => {
    const item = row && typeof row === "object"
      ? row as { id?: unknown; requestKey?: unknown; outcome?: unknown; evidence?: unknown; greetingOutcome?: unknown; greetingEvidence?: unknown; skipped?: unknown; persisted?: unknown; message?: unknown }
      : {}
    const persisted = item.persisted === true ? "已落库" : "待补偿"
    const action = item.skipped === true ? "未触达" : "已执行"
    return `${index + 1}. 岗位 ${String(item.id || "-")} · ${String(item.outcome || "UNKNOWN")} · ${action} · ${persisted}\n`
      + `平台证据：${String(item.evidence || "-")}；话术结果：${String(item.greetingOutcome || "-")}；话术证据：${String(item.greetingEvidence || "-")}\n`
      + String(item.message || "")
  })
  return `${summary}\n\n逐条结果：\n${details.join("\n")}`
}

function formatBatchGreetingPreview(items: BatchPreviewItem[], title: string) {
  const lines = items.map((item, index) => (
    `${index + 1}. ${item.companyName || "未知公司"} / ${item.jobName || "未命名岗位"}\n`
    + `来源：${greetingSourceLabel(item.greetingSource)}\n${item.greeting || "【空白】"}`
  ))
  return `${title}\n\n将使用以下 ${items.length} 条沟通话术：\n\n${lines.join("\n\n")}\n\n确认后才会创建投递任务并交给 Chrome。`
}

async function loadBatchPreview(body: unknown) {
  const data = await postJsonWithRetry(`${API_BASE}/api/boss/jobs/confirm-batch/preview`, body)
  return {
    success: data.success !== false,
    message: String(data.message || ""),
    items: Array.isArray(data.items) ? data.items as BatchPreviewItem[] : [],
    nativeGreetingDisabledConfirmed: data.nativeGreetingDisabledConfirmed === true,
  }
}

async function markUnknownReservations(tasks: ReservedTask[], reason: string) {
  const results = await Promise.allSettled(tasks.map(async (task) => {
    if (!task.id || !task.requestKey) return
    const response = await fetch(`${API_BASE}/api/boss/jobs/${task.id}/delivery-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestKey: task.requestKey,
        outcome: "UNKNOWN",
        evidence: "NO_CONFIRMATION",
        greetingOutcome: "UNKNOWN",
        greetingEvidence: "FRONTEND_RESULT_UNAVAILABLE",
        message: reason,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.success === false) {
      throw new Error(data.message || "Boss UNKNOWN 状态回写失败")
    }
  }))
  const failed = results.filter((result) => result.status === "rejected")
  if (failed.length > 0) console.error("Boss UNKNOWN 状态回写失败", failed)
}

export function useBossDeliveryActions({
  filters,
  activeScanRunId,
  page,
  size,
  loadList,
  refreshStats,
  clearLocalJobs,
  clearStats,
  openTextDialog,
}: {
  filters: FilterState
  activeScanRunId: string
  page: number
  size: number
  loadList: (page?: number, size?: number) => Promise<void>
  refreshStats: () => Promise<void>
  clearLocalJobs: () => void
  clearStats: () => void
  openTextDialog: (title: string, content?: string) => void
}) {
  const [actingJobId, setActingJobId] = useState<number | null>(null)
  const [blacklistingJobId, setBlacklistingJobId] = useState<number | null>(null)
  const [actingBatch, setActingBatch] = useState(false)
  const [actingAiBatch, setActingAiBatch] = useState(false)
  const [actingManualBatch, setActingManualBatch] = useState(false)
  const [clearingAnalysis, setClearingAnalysis] = useState(false)

  const handleBlacklistCompany = useCallback(async (job: BossJob) => {
    const value = (job.companyName || "").trim()
    if (!value) {
      openTextDialog("加入黑名单", "该岗位缺少公司名称，无法加入公司黑名单。")
      return
    }
    try {
      setBlacklistingJobId(job.id)
      const res = await fetch(`${API_BASE}/api/boss/config/blacklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "company", value }),
      })
      if (!res.ok) throw new Error("加入黑名单失败")
      openTextDialog("加入黑名单", `${value} 已加入公司黑名单。`)
    } catch (error) {
      openTextDialog("加入黑名单", error instanceof Error ? error.message : "加入黑名单失败：网络或服务异常。")
    } finally {
      setBlacklistingJobId(null)
    }
  }, [openTextDialog])

  const handleConfirmJob = useCallback(async (job: BossJob, greetingSnapshot: string) => {
    let reservedTasks: ReservedTask[] = []
    try {
      setActingJobId(job.id)
      const data = await postJsonWithRetry(`${API_BASE}/api/boss/jobs/${job.id}/confirm`, { greetingSnapshot })
      if (!data.success) {
        openTextDialog("确认投递", data.message || "该岗位暂不能投递。")
        return
      }
      reservedTasks = [data.task]
      const result = await sendChromeBridgeMessage({
        type: "BOSS_DELIVER_ONE",
        platform: "boss",
        task: data.task,
      }, 120000)
      if (result.persisted !== true) {
        await markUnknownReservations(reservedTasks, result.message || "Chrome Bridge 未返回岗位结果")
      }
      openTextDialog("确认投递", result.message || (result.success ? "已发送投递请求。" : "Chrome投递失败。"))
      await loadList(page, size)
      await refreshStats()
    } catch {
      await markUnknownReservations(reservedTasks, "前端未收到 Chrome 投递执行结果")
      openTextDialog("待确认发送", "确认失败：网络或服务异常。")
    } finally {
      setActingJobId(null)
    }
  }, [loadList, openTextDialog, page, refreshStats, size])

  const handleReconcileJob = useCallback(async (job: BossJob) => {
    const answer = window.prompt(
      "请先在 Boss 平台核对该岗位是否已存在沟通。输入“已投递”确认沟通存在，输入“未投递”确认失败；这里只核对沟通状态，不会把话术标成精确确认，也不会补发。",
    )?.trim()
    if (answer !== "已投递" && answer !== "未投递") return
    try {
      setActingJobId(job.id)
      const data = await postJsonWithRetry(`${API_BASE}/api/boss/jobs/${job.id}/delivery-reconcile`, {
        outcome: answer === "已投递" ? "CONFIRMED" : "FAILED",
        message: `用户在 Boss 平台人工核对：${answer}`,
      })
      openTextDialog("人工对账", data.message || (data.success ? "人工对账已保存。" : "人工对账失败。"))
      await loadList(page, size)
      await refreshStats()
    } catch {
      openTextDialog("人工对账", "人工对账失败：网络或服务异常。")
    } finally {
      setActingJobId(null)
    }
  }, [loadList, openTextDialog, page, refreshStats, size])

  const handleRetryJob = useCallback(async (job: BossJob) => {
    let reservedTasks: ReservedTask[] = []
    try {
      setActingJobId(job.id)
      const greetingResponse = await fetch(`${API_BASE}/api/platforms/boss/jobs/${job.id}/greeting`)
      const greetingResult = await readApiResponse<{ finalGreeting: string; greetingSource: string }>(greetingResponse, "读取最终沟通话术失败")
      const finalGreeting = greetingResult.data?.finalGreeting || ""
      if (!finalGreeting.trim()) {
        openTextDialog("重试投递", "最终沟通话术为空，请先编辑后再重试。")
        return
      }
      const ok = window.confirm(`这会创建新的投递 attempt，并可能再次联系该 Boss HR。\n\n最终话术：\n${finalGreeting}\n\n确认显式重试？`)
      if (!ok) return
      const data = await postJsonWithRetry(`${API_BASE}/api/boss/jobs/${job.id}/delivery-retry`, { greetingSnapshot: finalGreeting })
      if (!data.success || !data.task) {
        openTextDialog("重试投递", data.message || "当前岗位不能重试。")
        return
      }
      reservedTasks = [data.task]
      const result = await sendChromeBridgeMessage({
        type: "BOSS_DELIVER_ONE",
        platform: "boss",
        task: data.task,
      }, 120000)
      if (result.persisted !== true) {
        await markUnknownReservations(reservedTasks, result.message || "Chrome 重试结果未确认写入")
      }
      openTextDialog("重试投递", result.message || "重试任务已结束。")
      await loadList(page, size)
      await refreshStats()
    } catch {
      await markUnknownReservations(reservedTasks, "前端未收到 Chrome 重试执行结果")
      openTextDialog("重试投递", "重试失败：网络或服务异常，已保守标记待对账。")
    } finally {
      setActingJobId(null)
    }
  }, [loadList, openTextDialog, page, refreshStats, size])

  const currentBatchFilters = useCallback(() => ({
    location: filters.location || undefined,
    experience: filters.experience || undefined,
    degree: filters.degree || undefined,
    minK: filters.minK ? Number(filters.minK) : undefined,
    maxK: filters.maxK ? Number(filters.maxK) : undefined,
    minAiScore: filters.minAiScore ? Number(filters.minAiScore) : undefined,
    keyword: filters.keyword || undefined,
    scanRunId: activeScanRunId || undefined,
    filterHeadhunter: filters.filterHeadhunter,
  }), [activeScanRunId, filters])

  const handleConfirmBatch = useCallback(async () => {
    let reservedTasks: ReservedTask[] = []
    try {
      setActingBatch(true)
      const body = currentBatchFilters()
      const preview = await loadBatchPreview(body)
      if (!preview.nativeGreetingDisabledConfirmed) {
        openTextDialog("批量投递预览", "请先到 AI 配置页确认已关闭 BOSS 平台自带打招呼语。")
        return
      }
      if (!preview.success || preview.items.length === 0) {
        openTextDialog("批量投递预览", preview.message || "当前筛选条件下没有待确认岗位。")
        return
      }
      if (preview.items.some((item) => item.empty || !item.greeting?.trim())) {
        openTextDialog("批量投递预览", "批量范围内存在空白沟通话术，请逐条编辑后再确认。")
        return
      }
      const ok = window.confirm(formatBatchGreetingPreview(preview.items, "Boss 批量投递预览"))
      if (!ok) return
      const data = await postJsonWithRetry(`${API_BASE}/api/boss/jobs/confirm-batch`, {
        ...body,
        greetingSnapshots: greetingSnapshots(preview.items),
      })
      const tasks = data.tasks || []
      reservedTasks = tasks
      if (!data.success || tasks.length === 0) {
        openTextDialog("批量投递", data.message || "当前筛选条件下没有待确认岗位。")
        return
      }
      const result = await sendChromeBridgeMessage({
        type: "BOSS_DELIVER_BATCH",
        platform: "boss",
        tasks,
      }, Math.max(120000, tasks.length * 30000))
      const unresolved = unresolvedReservations(reservedTasks, result)
      if (unresolved.length > 0) {
        await markUnknownReservations(unresolved, result.message || "Chrome Bridge 未确认写入完整批量结果")
      }
      openTextDialog("批量投递", formatBatchDeliveryResult(result))
      await loadList(page, size)
      await refreshStats()
    } catch {
      await markUnknownReservations(reservedTasks, "前端未收到 Chrome 批量投递执行结果")
      openTextDialog("批量投递", "批量投递失败：网络或服务异常。")
    } finally {
      setActingBatch(false)
    }
  }, [currentBatchFilters, loadList, openTextDialog, page, refreshStats, size])

  const handleConfirmAiRecommendedBatch = useCallback(async () => {
    let reservedTasks: ReservedTask[] = []
    try {
      setActingAiBatch(true)
      const body = {
        aiRecommendedOnly: true,
        scanRunId: activeScanRunId || undefined,
      }
      const preview = await loadBatchPreview(body)
      if (!preview.nativeGreetingDisabledConfirmed) {
        openTextDialog("AI推荐投递预览", "请先到 AI 配置页确认已关闭 BOSS 平台自带打招呼语。")
        return
      }
      if (!preview.success || preview.items.length === 0) {
        openTextDialog("AI推荐投递预览", preview.message || "当前没有 AI 推荐的待确认岗位。")
        return
      }
      if (preview.items.some((item) => item.empty || !item.greeting?.trim())) {
        openTextDialog("AI推荐投递预览", "推荐范围内存在空白沟通话术，请逐条编辑后再确认。")
        return
      }
      const ok = window.confirm(formatBatchGreetingPreview(preview.items, "Boss AI 推荐投递预览"))
      if (!ok) return
      const data = await postJsonWithRetry(`${API_BASE}/api/boss/jobs/confirm-batch`, {
        ...body,
        greetingSnapshots: greetingSnapshots(preview.items),
      })
      const tasks = data.tasks || []
      reservedTasks = tasks
      if (!data.success || tasks.length === 0) {
        openTextDialog("AI推荐一键投递", data.message || "当前没有 AI 推荐的待确认岗位。")
        return
      }
      const result = await sendChromeBridgeMessage({
        type: "BOSS_DELIVER_BATCH",
        platform: "boss",
        tasks,
      }, Math.max(120000, tasks.length * 30000))
      const unresolved = unresolvedReservations(reservedTasks, result)
      if (unresolved.length > 0) {
        await markUnknownReservations(unresolved, result.message || "Chrome Bridge 未确认写入完整批量结果")
      }
      openTextDialog("AI推荐一键投递", formatBatchDeliveryResult(result))
      await loadList(page, size)
      await refreshStats()
    } catch {
      await markUnknownReservations(reservedTasks, "前端未收到 Chrome AI 推荐批量投递结果")
      openTextDialog("AI推荐一键投递", "AI推荐批量投递失败：网络或服务异常。")
    } finally {
      setActingAiBatch(false)
    }
  }, [activeScanRunId, loadList, openTextDialog, page, refreshStats, size])

  const handleConfirmManualBatch = useCallback(async (ids: number[]) => {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) {
      openTextDialog("人工投递", "请先勾选当前页中的AI不匹配岗位。")
      return false
    }

    let reservedTasks: ReservedTask[] = []
    try {
      setActingManualBatch(true)
      const body = { ids: uniqueIds, manualOverrideAiNotMatch: true }
      const preview = await loadBatchPreview(body)
      if (!preview.nativeGreetingDisabledConfirmed) {
        openTextDialog("人工投递预览", "请先到 AI 配置页确认已关闭 BOSS 平台自带打招呼语。")
        return false
      }
      if (!preview.success || preview.items.length === 0) {
        openTextDialog("人工投递预览", preview.message || "所选岗位中没有可人工投递的AI不匹配岗位。")
        return false
      }
      if (preview.items.some((item) => item.empty || !item.greeting?.trim())) {
        openTextDialog("人工投递预览", "所选岗位中存在空白沟通话术，请逐条编辑后再确认。")
        return false
      }
      const ok = window.confirm(formatBatchGreetingPreview(preview.items, `人工覆盖 ${uniqueIds.length} 个 AI 不匹配岗位`))
      if (!ok) return false
      const data = await postJsonWithRetry(`${API_BASE}/api/boss/jobs/confirm-batch`, {
        ...body,
        greetingSnapshots: greetingSnapshots(preview.items),
      })
      const tasks = data.tasks || []
      reservedTasks = tasks
      if (!data.success || tasks.length === 0) {
        openTextDialog("人工投递", data.message || "所选岗位中没有可人工投递的AI不匹配岗位。")
        return false
      }

      const result = await sendChromeBridgeMessage({
        type: "BOSS_DELIVER_BATCH",
        platform: "boss",
        tasks,
      }, Math.max(120000, tasks.length * 30000))
      const unresolved = unresolvedReservations(reservedTasks, result)
      if (unresolved.length > 0) {
        await markUnknownReservations(unresolved, result.message || "Chrome Bridge 未确认写入完整批量结果")
      }
      openTextDialog("人工投递", formatBatchDeliveryResult(result))
      await loadList(page, size)
      await refreshStats()
      return true
    } catch {
      await markUnknownReservations(reservedTasks, "前端未收到 Chrome 人工批量投递结果")
      openTextDialog("人工投递", "人工批量投递失败：网络或服务异常。")
      return false
    } finally {
      setActingManualBatch(false)
    }
  }, [loadList, openTextDialog, page, refreshStats, size])

  const handleSkipJob = useCallback(async (job: BossJob) => {
    try {
      setActingJobId(job.id)
      const res = await fetch(`${API_BASE}/api/boss/jobs/${job.id}/skip`, { method: "POST" })
      const data = await res.json()
      if (!data.success) {
        openTextDialog("跳过岗位", data.message || "跳过失败。")
      }
      await loadList(page, size)
      await refreshStats()
    } catch {
      openTextDialog("跳过岗位", "跳过失败：网络或服务异常。")
    } finally {
      setActingJobId(null)
    }
  }, [loadList, openTextDialog, page, refreshStats, size])

  const clearAnalysisData = useCallback(async () => {
    const ok = window.confirm("确认清空 Boss 投递分析数据？这会删除当前岗位列表、统计图和历史AI分析结果，适合切换人物或简历前使用。")
    if (!ok) return
    try {
      setClearingAnalysis(true)
      const res = await fetch(`${API_BASE}/api/boss/analysis`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "清空失败")
      }
      clearLocalJobs()
      clearStats()
      await loadList(1, size)
      await refreshStats()
      openTextDialog("清空投递分析", data.message || "Boss投递分析数据已清空。")
    } catch (error) {
      openTextDialog("清空投递分析", error instanceof Error ? error.message : "清空失败：网络或服务异常。")
    } finally {
      setClearingAnalysis(false)
    }
  }, [clearLocalJobs, clearStats, loadList, openTextDialog, refreshStats, size])

  return {
    actingJobId,
    blacklistingJobId,
    actingBatch,
    actingAiBatch,
    actingManualBatch,
    clearingAnalysis,
    handleBlacklistCompany,
    handleConfirmJob,
    handleConfirmBatch,
    handleConfirmAiRecommendedBatch,
    handleConfirmManualBatch,
    handleReconcileJob,
    handleRetryJob,
    handleSkipJob,
    clearAnalysisData,
  }
}
