"use client"

import { useCallback, useRef, useState } from "react"

import { readWorkspaceResponse } from "@/app/discover/WorkspaceDataStatus"
import { API_BASE } from "@/lib/api"
import type { FilterState, StatsResponse } from "../types"

export function useBossStats({
  filters,
  activeScanRunId,
  buildFilterParams,
}: {
  filters: FilterState
  activeScanRunId: string
  buildFilterParams: (source?: FilterState, scanRunId?: string) => URLSearchParams
}) {
  const [filteredStatsError, setFilteredStatsError] = useState("")
  const [dashboardStatsError, setDashboardStatsError] = useState("")
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [dashboardStats, setDashboardStats] = useState<StatsResponse | null>(null)
  const [loadingDashboardStats, setLoadingDashboardStats] = useState(true)
  const statsRequestSequence = useRef(0)
  const dashboardRequestSequence = useRef(0)

  const loadStats = useCallback(async () => {
    const requestSequence = ++statsRequestSequence.current
    const params = buildFilterParams(filters, activeScanRunId)

    try {
      const res = await fetch(`${API_BASE}/api/boss/stats?${params.toString()}`)
      const data = await readWorkspaceResponse<StatsResponse>(res, "BOSS 统计读取")
      if (!data.kpi || !data.charts) throw new Error("BOSS 统计格式异常，请检查服务版本。")
      if (requestSequence === statsRequestSequence.current) { setStats(data); setFilteredStatsError("") }
    } catch (error) {
      if (requestSequence === statsRequestSequence.current) setFilteredStatsError(error instanceof Error ? error.message : "统计读取失败")
    }
  }, [activeScanRunId, buildFilterParams, filters])

  const loadDashboardStats = useCallback(async () => {
    const requestSequence = ++dashboardRequestSequence.current
    try {
      setLoadingDashboardStats(true)
      const params = new URLSearchParams()
      if (activeScanRunId) params.set("scanRunId", activeScanRunId)
      const res = await fetch(`${API_BASE}/api/boss/stats?${params.toString()}`)
      const data = await readWorkspaceResponse<StatsResponse>(res, "BOSS 统计读取")
      if (!data.kpi || !data.charts) throw new Error("BOSS 统计格式异常，请检查服务版本。")
      if (requestSequence === dashboardRequestSequence.current) { setDashboardStats(data); setDashboardStatsError("") }
    } catch (error) {
      if (requestSequence === dashboardRequestSequence.current) setDashboardStatsError(error instanceof Error ? error.message : "统计读取失败")
    } finally {
      if (requestSequence === dashboardRequestSequence.current) setLoadingDashboardStats(false)
    }
  }, [activeScanRunId])

  const clearStats = useCallback(() => {
    setStats(null)
    setDashboardStats(null)
  }, [])

  return {
    statsError: filteredStatsError || dashboardStatsError,
    stats,
    dashboardStats,
    loadingDashboardStats,
    loadStats,
    loadDashboardStats,
    clearStats,
  }
}
