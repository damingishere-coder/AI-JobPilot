"use client"

import { BiBriefcase, BiChevronDown, BiChevronUp, BiDownload, BiRefresh, BiTrash } from "react-icons/bi"

import { Button } from "@/components/ui/button"

export function BatchActionBar({
  disabled = false,
  scopeLabel = "当前档案全部历史",
  detailedTable = false,
  onToggleTable,
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
  disabled?: boolean
  scopeLabel?: string
  detailedTable?: boolean
  onToggleTable?: () => void
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
    <div className="flex flex-wrap items-center gap-2">
      {onToggleTable && <Button size="sm" variant="outline" onClick={onToggleTable}>{detailedTable ? "精简列表" : "详细表格"}</Button>}
      <Button size="sm" variant="success" onClick={onExport} disabled={exporting}>
        <BiDownload className="mr-1" /> {exporting ? "导出中..." : "导出CSV"}
      </Button>
      <Button size="sm" variant="outline" onClick={onReload} disabled={reloading}>
        <BiRefresh className="mr-1" /> 刷新数据
      </Button>
      <Button size="sm" variant="destructive" onClick={onClear} disabled={clearingAnalysis}>
        <BiTrash className="mr-1" /> {clearingAnalysis ? "归档中..." : "归档列表"}
      </Button>
      {detailedTable && <Button size="sm" variant="outline" onClick={onToggleDetailColumns}>
        {showDetailColumns ? <BiChevronUp className="mr-1" /> : <BiChevronDown className="mr-1" />}
        {showDetailColumns ? "收起详情列" : "展开详情列"}
      </Button>}
      <Button size="sm" variant="success" onClick={onConfirmAiRecommendedBatch} title={`范围：${scopeLabel}的全部 AI 推荐待确认岗位，不受当前筛选影响；下一步预览确认`} disabled={disabled || actingAiBatch || actingBatch || actingManualBatch}>
        <BiBriefcase className="mr-1" /> {actingAiBatch ? "投递中..." : "预览全部 AI 推荐待确认"}
      </Button>
      <Button size="sm" variant="destructive" onClick={onConfirmBatch} title={`范围：${scopeLabel}的全部待确认岗位，应用其他已提交筛选条件，包含其他页；状态固定待确认；下一步预览确认`} disabled={disabled || actingBatch || actingAiBatch || actingManualBatch}>
        <BiBriefcase className="mr-1" /> {actingBatch ? "投递中..." : "预览当前筛选待确认"}
      </Button>
      <span className="basis-full text-xs text-muted-foreground">AI 推荐：{scopeLabel}的全部推荐待确认，忽略列表筛选；当前筛选：状态固定待确认，应用其他已提交条件，包含其他页。确认前会展示逐条话术。</span>
    </div>
  )
}
