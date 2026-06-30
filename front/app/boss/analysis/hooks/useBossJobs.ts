"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { API_BASE } from "@/lib/api"
import type { BossJob, FilterState, PagedResult } from "../types"

export function useBossJobs({
  filters,
  buildFilterParams,
  requestedScanRunId = "",
}: {
  filters: FilterState
  buildFilterParams: (source?: FilterState, scanRunId?: string) => URLSearchParams
  requestedScanRunId?: string
}) {
  const [items, setItems] = useState<BossJob[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [inputPage, setInputPage] = useState<number | string>(1)
  const [inputSize, setInputSize] = useState<number | string>(20)
  const [loadingList, setLoadingList] = useState(false)
  const [reloading, setReloading] = useState(false)

  const activeScanRunId = useMemo(
    () => requestedScanRunId.trim(),
    [requestedScanRunId],
  )

  useEffect(() => {
    setInputPage(page)
  }, [page])

  useEffect(() => {
    setInputSize(size)
  }, [size])

  const loadList = useCallback(async (toPage = page, toSize = size) => {
    const params = buildFilterParams(filters, activeScanRunId)
    params.set("page", String(toPage))
    params.set("size", String(toSize))

    try {
      setLoadingList(true)
      const res = await fetch(`${API_BASE}/api/boss/list?${params.toString()}`)
      const data: PagedResult = await res.json()
      const filteredItems = (data.items || []).filter((item) => {
        if (!filters.filterHeadhunter) return true
        const hrPosition = (item.hrPosition || "").toLowerCase()
        return !(hrPosition.includes("猎头") || hrPosition.includes("獵頭"))
      })
      setItems(filteredItems)
      setTotal(data.total || 0)
      setPage(data.page || toPage)
      setSize(data.size || toSize)
    } catch (error) {
      console.error("fetch list failed", error)
    } finally {
      setLoadingList(false)
    }
  }, [activeScanRunId, buildFilterParams, filters, page, size])

  const reloadJobs = useCallback(async (refreshStats: () => Promise<void>) => {
    try {
      setReloading(true)
      const res = await fetch(`${API_BASE}/api/boss/reload`)
      const data = await res.json()
      console.log("reload", data)
      await loadList(1, size)
      await refreshStats()
    } catch (error) {
      console.error("reload failed", error)
    } finally {
      setReloading(false)
    }
  }, [loadList, size])

  const clearLocalJobs = useCallback(() => {
    setItems([])
    setTotal(0)
    setPage(1)
    setInputPage(1)
  }, [])

  return {
    items,
    total,
    page,
    size,
    inputPage,
    inputSize,
    loadingList,
    reloading,
    activeScanRunId,
    setInputPage,
    setInputSize,
    loadList,
    reloadJobs,
    clearLocalJobs,
  }
}
