"use client"

import { BiBriefcase, BiChevronDown, BiChevronUp, BiDownload, BiRefresh, BiTrash } from "react-icons/bi"

import { Button } from "@/components/ui/button"

export function BatchActionBar({
  exporting,
  reloading,
  clearingAnalysis,
  showDetailColumns,
  actingAiBatch,
  actingBatch,
  actingManualBatch,
  onExport,
  onReload,
  onClear,
  onToggleDetailColumns,
  onConfirmAiRecommendedBatch,
  onConfirmBatch,
}: {
  exporting: boolean
  reloading: boolean
  clearingAnalysis: boolean
  showDetailColumns: boolean
  actingAiBatch: boolean
  actingBatch: boolean
  actingManualBatch: boolean
  onExport: () => void
  onReload: () => void
  onClear: () => void
  onToggleDetailColumns: () => void
  onConfirmAiRecommendedBatch: () => void
  onConfirmBatch: () => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="success" onClick={onExport} disabled={exporting}>
        <BiDownload className="mr-1" /> {exporting ? "导出中..." : "导出CSV"}
      </Button>
      <Button size="sm" variant="outline" onClick={onReload} disabled={reloading}>
        <BiRefresh className="mr-1" /> 刷新数据
      </Button>
      <Button size="sm" variant="destructive" onClick={onClear} disabled={clearingAnalysis}>
        <BiTrash className="mr-1" /> {clearingAnalysis ? "清空中..." : "清空分析"}
      </Button>
      <Button size="sm" variant="outline" onClick={onToggleDetailColumns}>
        {showDetailColumns ? <BiChevronUp className="mr-1" /> : <BiChevronDown className="mr-1" />}
        {showDetailColumns ? "收起详情列" : "展开详情列"}
      </Button>
      <Button size="sm" variant="success" onClick={onConfirmAiRecommendedBatch} disabled={actingAiBatch || actingBatch || actingManualBatch}>
        <BiBriefcase className="mr-1" /> {actingAiBatch ? "投递中..." : "一键投递AI推荐待确认"}
      </Button>
      <Button size="sm" variant="destructive" onClick={onConfirmBatch} disabled={actingBatch || actingAiBatch || actingManualBatch}>
        <BiBriefcase className="mr-1" /> {actingBatch ? "投递中..." : "投递当前待确认"}
      </Button>
    </div>
  )
}
