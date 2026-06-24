"use client"

import { useCallback, useState } from "react"

import { API_BASE } from "@/lib/api"
import type { BossJob, FilterState, PagedResult } from "../types"
import { deliveryStatusLabel, failureTypeLabel } from "../utils"

export function useCsvExport({
  filters,
  activeScanRunId,
  buildFilterParams,
}: {
  filters: FilterState
  activeScanRunId: string
  buildFilterParams: (source?: FilterState, scanRunId?: string) => URLSearchParams
}) {
  const [exporting, setExporting] = useState(false)

  const exportCSV = useCallback(async () => {
    try {
      setExporting(true)
      const baseParams = buildFilterParams(filters, activeScanRunId)
      const pageSize = 1000
      let currentPage = 1
      let all: BossJob[] = []
      let totalCount = 0

      while (true) {
        const params = new URLSearchParams(baseParams)
        params.set("page", String(currentPage))
        params.set("size", String(pageSize))
        const res = await fetch(`${API_BASE}/api/boss/list?${params.toString()}`)
        const data: PagedResult = await res.json()
        let chunk = data.items || []
        if (filters.filterHeadhunter) {
          chunk = chunk.filter((item) => {
            const hrPosition = (item.hrPosition || "").toLowerCase()
            return !(hrPosition.includes("猎头") || hrPosition.includes("獵頭"))
          })
        }
        if (currentPage === 1) totalCount = data.total || chunk.length
        all = all.concat(chunk)
        if (all.length >= totalCount || chunk.length === 0) break
        currentPage += 1
      }

      const header = [
        "公司名称",
        "岗位名称",
        "薪资",
        "工作地点",
        "经验",
        "学历",
        "HR",
        "投递状态",
        "失败类型",
        "失败原因",
        "AI分",
        "AI决策",
        "AI原因",
        "优先公司",
        "链接",
        "创建时间",
      ]
      const rows = all.map((item) => [
        item.companyName || "",
        item.jobName || "",
        item.salary || "",
        item.location || "",
        item.experience || "",
        item.degree || "",
        item.hrName || "",
        deliveryStatusLabel(item.deliveryStatus),
        item.deliveryStatus === "投递失败" ? failureTypeLabel(item.failureType) : "",
        item.deliveryStatus === "投递失败" ? (item.failureReason || "") : "",
        item.aiScore ?? "",
        item.aiDecision || "",
        item.aiReason || "",
        item.priorityCompany ? "是" : "",
        item.jobUrl || "",
        item.createdAt || "",
      ])
      const csv = [header, ...rows]
        .map((row) => row.map((value) => (String(value).includes(",") ? `"${String(value).replace(/"/g, '""')}"` : String(value))).join(","))
        .join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `boss_jobs_${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("export CSV failed", error)
      alert("导出失败，请稍后重试")
    } finally {
      setExporting(false)
    }
  }, [activeScanRunId, buildFilterParams, filters])

  return { exporting, exportCSV }
}
