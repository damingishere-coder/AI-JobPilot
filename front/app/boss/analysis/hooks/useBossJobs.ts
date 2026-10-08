"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

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
  const [loadError, setLoadError] = useState("")
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [items, setItems] = useState<BossJob[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [inputPage, setInputPage] = useState<number | string>(1)
  const [inputSize, setInputSize] = useState<number | string>(20)
  const [loadingList, setLoadingList] = useState(true)
  const [reloading, setReloading] = useState(false)
  const listRequestSequence = useRef(0)

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
    const requestSequence = ++listRequestSequence.current
    const params = buildFilterParams(filters, activeScanRunId)
    params.set("page", String(toPage))
    params.set("size", String(toSize))

    try {
      setLoadingList(true)
      const res = await fetch(`${API_BASE}/api/boss/list?${params.toString()}`)
      const data: PagedResult & { success?: boolean; message?: string } = await res.json().catch(() => { throw new Error("岗位服务返回异常，请重试。") })
      if (!res.ok || data.success === false) throw new Error(data.message || `岗位读取失败（HTTP ${res.status}）`)
      if (!Array.isArray(data.items)) throw new Error("岗位数据格式异常，请检查服务版本。")
      if (requestSequence !== listRequestSequence.current) return
      const filteredItems = (data.items || []).filter((item) => {
        if (!filters.filterHeadhunter) return true
        const hrPosition = (item.hrPosition || "").toLowerCase()
        return !(hrPosition.includes("猎头") || hrPosition.includes("獵頭"))
      })
      setLoadError("")
      setLastUpdatedAt(Date.now())
      setLoaded(true)
      setItems(filteredItems)
      setTotal(data.total || 0)
      setPage(data.page || toPage)
      setSize(data.size || toSize)
    } catch (error) {
      if (requestSequence === listRequestSequence.current) setLoadError(error instanceof Error ? error.message : "岗位加载失败，请重试。")
    } finally {
      if (requestSequence === listRequestSequence.current) setLoadingList(false)
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
    loadError,
    loaded,
    lastUpdatedAt,
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
