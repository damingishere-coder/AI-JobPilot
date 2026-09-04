"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { API_BASE } from "@/lib/api"
import type { JobAnalysisTask, JobAnalysisTasksResponse } from "../types"

export function useBossAnalysisTasks() {
  const [tasks, setTasks] = useState<JobAnalysisTask[]>([])
  const [queueSize, setQueueSize] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [processingCount, setProcessingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [retryingTaskId, setRetryingTaskId] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [visible, setVisible] = useState(true)
  const [pollRevision, setPollRevision] = useState(0)
  const requestInFlight = useRef<Promise<void> | null>(null)
  const snapshotSignature = useRef<string | null>(null)

  const loadTasks = useCallback((): Promise<void> => {
    if (requestInFlight.current) return requestInFlight.current
    const request = (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/ai/job-analysis/tasks?limit=200&platform=boss`)
        const payload: JobAnalysisTasksResponse = await response.json()
        if (!response.ok || !payload.success) {
          throw new Error(payload.message || "AI分析任务读取失败")
        }
        const bossTasks = (payload.data || []).filter(
          (task) => task.platform.toLowerCase() === "boss",
        )
        const nextSignature = JSON.stringify({
          queueSize: payload.queueSize ?? 0,
          pendingCount: payload.pendingCount ?? 0,
          processingCount: payload.processingCount ?? 0,
          tasks: bossTasks.map((task) => [task.id, task.status, task.updatedAt, task.lastError]),
        })
        setTasks(bossTasks)
        setQueueSize(payload.queueSize ?? bossTasks.filter((task) => task.status === "PENDING" || task.status === "LEASED").length)
        setPendingCount(payload.pendingCount ?? bossTasks.filter((task) => task.status === "PENDING").length)
        setProcessingCount(payload.processingCount ?? bossTasks.filter((task) => task.status === "LEASED").length)
        setError("")
        if (snapshotSignature.current !== null && snapshotSignature.current !== nextSignature) {
          setPollRevision((revision) => revision + 1)
        }
        snapshotSignature.current = nextSignature
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "AI分析任务读取失败")
      } finally {
        setLoading(false)
      }
    })()
    requestInFlight.current = request
    void request.finally(() => {
      if (requestInFlight.current === request) requestInFlight.current = null
    })
    return request
  }, [])

  useEffect(() => {
    setVisible(document.visibilityState === "visible")
    const onVisibilityChange = () => {
      const nextVisible = document.visibilityState === "visible"
      setVisible(nextVisible)
      if (nextVisible) void loadTasks()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [loadTasks])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  useEffect(() => {
    if (!visible || queueSize <= 0) return
    const timer = window.setInterval(() => void loadTasks(), 3000)
    return () => window.clearInterval(timer)
  }, [loadTasks, queueSize, visible])

  const taskByJobId = useMemo(() => {
    const mapped = new Map<number, JobAnalysisTask>()
    tasks.forEach((task) => {
      if (!mapped.has(task.jobRowId)) mapped.set(task.jobRowId, task)
    })
    return mapped
  }, [tasks])

  const retryTask = useCallback(async (task: JobAnalysisTask) => {
    setRetryingTaskId(task.id)
    try {
      const confirmUnknown = task.status === "UNKNOWN"
      const response = await fetch(
        `${API_BASE}/api/ai/job-analysis/tasks/${task.id}/retry?confirmUnknown=${confirmUnknown}`,
        { method: "POST" },
      )
      const payload: JobAnalysisTasksResponse = await response.json()
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "AI分析任务重试失败")
      }
      if (requestInFlight.current) await requestInFlight.current
      await loadTasks()
      return { success: true, message: payload.message || "AI分析任务已重新进入队列" }
    } catch (retryError) {
      return {
        success: false,
        message: retryError instanceof Error ? retryError.message : "AI分析任务重试失败",
      }
    } finally {
      setRetryingTaskId(null)
    }
  }, [loadTasks])

  return {
    tasks,
    taskByJobId,
    queueSize,
    pendingCount,
    processingCount,
    loading,
    retryingTaskId,
    error,
    pollRevision,
    loadTasks,
    retryTask,
  }
}
