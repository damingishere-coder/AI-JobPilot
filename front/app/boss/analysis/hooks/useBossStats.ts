"use client"

import { useCallback, useState } from "react"

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
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [dashboardStats, setDashboardStats] = useState<StatsResponse | null>(null)
  const [loadingDashboardStats, setLoadingDashboardStats] = useState(true)

  const loadStats = useCallback(async () => {
    const params = buildFilterParams(filters, activeScanRunId)

    try {
      const res = await fetch(`${API_BASE}/api/boss/stats?${params.toString()}`)
      const data: StatsResponse = await res.json()
      setStats(data)
    } catch (error) {
      console.error("fetch stats failed", error)
    }
  }, [activeScanRunId, buildFilterParams, filters])

  const loadDashboardStats = useCallback(async () => {
    try {
      setLoadingDashboardStats(true)
      const params = new URLSearchParams()
      if (activeScanRunId) params.set("scanRunId", activeScanRunId)
      const res = await fetch(`${API_BASE}/api/boss/stats?${params.toString()}`)
      const data: StatsResponse = await res.json()
      setDashboardStats(data)
    } catch (error) {
      console.error("fetch dashboard stats failed", error)
    } finally {
      setLoadingDashboardStats(false)
    }
  }, [activeScanRunId])

  const clearStats = useCallback(() => {
    setStats(null)
    setDashboardStats(null)
  }, [])

  return {
    stats,
    dashboardStats,
    loadingDashboardStats,
    loadStats,
    loadDashboardStats,
    clearStats,
  }
}
