"use client"

import { useCallback, useRef, useState } from "react"

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
  const statsRequestSequence = useRef(0)
  const dashboardRequestSequence = useRef(0)

  const loadStats = useCallback(async () => {
    const requestSequence = ++statsRequestSequence.current
    const params = buildFilterParams(filters, activeScanRunId)

    try {
      const res = await fetch(`${API_BASE}/api/boss/stats?${params.toString()}`)
      const data: StatsResponse = await res.json()
      if (requestSequence === statsRequestSequence.current) setStats(data)
    } catch (error) {
      if (requestSequence === statsRequestSequence.current) console.error("fetch stats failed", error)
    }
  }, [activeScanRunId, buildFilterParams, filters])

  const loadDashboardStats = useCallback(async () => {
    const requestSequence = ++dashboardRequestSequence.current
    try {
      setLoadingDashboardStats(true)
      const params = new URLSearchParams()
      if (activeScanRunId) params.set("scanRunId", activeScanRunId)
      const res = await fetch(`${API_BASE}/api/boss/stats?${params.toString()}`)
      const data: StatsResponse = await res.json()
      if (requestSequence === dashboardRequestSequence.current) setDashboardStats(data)
    } catch (error) {
      if (requestSequence === dashboardRequestSequence.current) console.error("fetch dashboard stats failed", error)
    } finally {
      if (requestSequence === dashboardRequestSequence.current) setLoadingDashboardStats(false)
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
