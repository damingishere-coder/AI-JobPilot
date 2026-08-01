"use client"

import { useCallback, useState } from "react"

import { API_BASE } from "@/lib/api"
import { sendChromeBridgeMessage } from "@/lib/chromeBridge"
import type { BossJob, FilterState } from "../types"

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

  const handleConfirmJob = useCallback(async (job: BossJob) => {
    try {
      setActingJobId(job.id)
      const res = await fetch(`${API_BASE}/api/boss/jobs/${job.id}/confirm`, { method: "POST" })
      const data = await res.json()
      if (!data.success) {
        openTextDialog("确认投递", data.message || "该岗位暂不能投递。")
        return
      }
      const ok = window.confirm(`将通过 Chrome 真实联系 Boss HR：${job.companyName || ""} / ${job.jobName || ""}。确认继续？`)
      if (!ok) return
      const result = await sendChromeBridgeMessage({
        type: "BOSS_DELIVER_ONE",
        platform: "boss",
        task: data.task,
      }, 120000)
      openTextDialog("确认投递", result.message || (result.success ? "已发送投递请求。" : "Chrome投递失败。"))
      await loadList(page, size)
      await refreshStats()
    } catch {
      openTextDialog("待确认发送", "确认失败：网络或服务异常。")
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
    try {
      setActingBatch(true)
      const res = await fetch(`${API_BASE}/api/boss/jobs/confirm-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentBatchFilters()),
      })
      const data = await res.json()
      const tasks = data.tasks || []
      if (!data.success || tasks.length === 0) {
        openTextDialog("批量投递", data.message || "当前筛选条件下没有待确认岗位。")
        return
      }
      const ok = window.confirm(`将通过 Chrome 真实联系 ${tasks.length} 个 Boss 待确认岗位。确认继续？`)
      if (!ok) return
      const result = await sendChromeBridgeMessage({
        type: "BOSS_DELIVER_BATCH",
        platform: "boss",
        tasks,
      }, Math.max(120000, tasks.length * 30000))
      openTextDialog("批量投递", result.message || "批量投递任务已结束。")
      await loadList(page, size)
      await refreshStats()
    } catch {
      openTextDialog("批量投递", "批量投递失败：网络或服务异常。")
    } finally {
      setActingBatch(false)
    }
  }, [currentBatchFilters, loadList, openTextDialog, page, refreshStats, size])

  const handleConfirmAiRecommendedBatch = useCallback(async () => {
    try {
      setActingAiBatch(true)
      const res = await fetch(`${API_BASE}/api/boss/jobs/confirm-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiRecommendedOnly: true, scanRunId: activeScanRunId || undefined }),
      })
      const data = await res.json()
      const tasks = data.tasks || []
      if (!data.success || tasks.length === 0) {
        openTextDialog("AI推荐一键投递", data.message || "当前没有 AI 推荐的待确认岗位。")
        return
      }
      const ok = window.confirm(`将通过 Chrome 真实联系 ${tasks.length} 个 Boss AI推荐待确认岗位。确认继续？`)
      if (!ok) return
      const result = await sendChromeBridgeMessage({
        type: "BOSS_DELIVER_BATCH",
        platform: "boss",
        tasks,
      }, Math.max(120000, tasks.length * 30000))
      openTextDialog("AI推荐一键投递", result.message || "AI推荐批量投递任务已结束。")
      await loadList(page, size)
      await refreshStats()
    } catch {
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

    try {
      setActingManualBatch(true)
      const res = await fetch(`${API_BASE}/api/boss/jobs/confirm-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: uniqueIds,
          manualOverrideAiNotMatch: true,
        }),
      })
      const data = await res.json()
      const tasks = data.tasks || []
      if (!data.success || tasks.length === 0) {
        openTextDialog("人工投递", data.message || "所选岗位中没有可人工投递的AI不匹配岗位。")
        return false
      }

      const ok = window.confirm(
        `AI 已将这些岗位判定为不匹配。你正在按人工判断强制投递 ${tasks.length} 个岗位，`
        + `将通过 Chrome 真实联系 Boss HR。确认继续？${data.message ? `\n\n${data.message}` : ""}`,
      )
      if (!ok) return false

      const result = await sendChromeBridgeMessage({
        type: "BOSS_DELIVER_BATCH",
        platform: "boss",
        tasks,
      }, Math.max(120000, tasks.length * 30000))
      openTextDialog("人工投递", result.message || "人工批量投递任务已结束。")
      await loadList(page, size)
      await refreshStats()
      return true
    } catch {
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
    handleSkipJob,
    clearAnalysisData,
  }
}
