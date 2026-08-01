"use client"

import { useCallback, useMemo, useState } from "react"

import {
  DEFAULT_PENDING_FILTERS,
  EMPTY_FILTERS,
  LIST_COLLECTED_FILTERS,
  type FilterState,
} from "../types"

export function useBossFilters() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [draftFilters, setDraftFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(true)

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filters.statuses.length) count += 1
    if (filters.location.trim()) count += 1
    if (filters.experience) count += 1
    if (filters.degree) count += 1
    if (filters.minK || filters.maxK) count += 1
    if (filters.minAiScore) count += 1
    if (filters.keyword.trim()) count += 1
    if (filters.filterHeadhunter) count += 1
    return count
  }, [filters])

  const buildFilterParams = useCallback((source: FilterState = filters, scanRunId?: string) => {
    const params = new URLSearchParams()
    if (source.statuses.length) params.set("statuses", source.statuses.join(","))
    if (source.location.trim()) params.set("location", source.location.trim())
    if (source.experience) params.set("experience", source.experience)
    if (source.degree) params.set("degree", source.degree)
    if (source.minK) params.set("minK", String(Number(source.minK)))
    if (source.maxK) params.set("maxK", String(Number(source.maxK)))
    if (source.minAiScore) params.set("minAiScore", String(Number(source.minAiScore)))
    if (source.keyword.trim()) params.set("keyword", source.keyword.trim())
    if (source.filterHeadhunter) params.set("filterHeadhunter", "true")
    if (scanRunId) params.set("scanRunId", scanRunId)
    return params
  }, [filters])

  const toggleDraftStatus = useCallback((status: string) => {
    setDraftFilters((prev) => {
      const exists = prev.statuses.includes(status)
      return {
        ...prev,
        statuses: exists ? prev.statuses.filter((item) => item !== status) : [...prev.statuses, status],
      }
    })
  }, [])

  const applyFilters = useCallback(() => {
    setFilters(draftFilters)
  }, [draftFilters])

  const resetFilters = useCallback(() => {
    setDraftFilters(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
  }, [])

  const resetToPendingFilters = useCallback(() => {
    setDraftFilters(DEFAULT_PENDING_FILTERS)
    setFilters(DEFAULT_PENDING_FILTERS)
  }, [])

  const showListCollectedFilters = useCallback(() => {
    setDraftFilters(LIST_COLLECTED_FILTERS)
    setFilters(LIST_COLLECTED_FILTERS)
  }, [])

  return {
    filters,
    draftFilters,
    filtersOpen,
    activeFilterCount,
    setDraftFilters,
    setFiltersOpen,
    buildFilterParams,
    toggleDraftStatus,
    applyFilters,
    resetFilters,
    resetToPendingFilters,
    showListCollectedFilters,
  }
}
