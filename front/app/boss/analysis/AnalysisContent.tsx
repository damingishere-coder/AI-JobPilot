"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BiBarChart, BiBriefcase, BiTrash } from "react-icons/bi"

import PageHeader from "@/app/components/PageHeader"
import { Button } from "@/components/ui/button"
import { GreetingDraftDialog, type GreetingJob } from "@/components/communication/GreetingDraftDialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { BatchActionBar } from "./components/BatchActionBar"
import { BossChartPanel } from "./components/BossChartPanel"
import { BossDeliveryHistory } from "./components/BossDeliveryHistory"
import { BossFilterPanel } from "./components/BossFilterPanel"
import { BossJobTable } from "./components/BossJobTable"
import { BossKpiCards } from "./components/BossKpiCards"
import { BossPendingCards } from "./components/BossPendingCards"
import { BossThresholdSettings } from "./components/BossThresholdSettings"
import { ConfirmDeliveryDialog } from "./components/ConfirmDeliveryDialog"
import { useBossDeliveryActions } from "./hooks/useBossDeliveryActions"
import { useBossAnalysisTasks } from "./hooks/useBossAnalysisTasks"
import { useBossFilters } from "./hooks/useBossFilters"
import { useBossJobs } from "./hooks/useBossJobs"
import { useBossStats } from "./hooks/useBossStats"
import { useCsvExport } from "./hooks/useCsvExport"
import { canManualDeliverAiNotMatch } from "./utils"
import type { BossJob } from "./types"

export default function AnalysisContent({
  showHeader = false,
  refreshSignal = 0,
  focusScanRunId = "",
}: {
  showHeader?: boolean
  refreshSignal?: number
  focusScanRunId?: string
}) {
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [pendingCardsExpanded, setPendingCardsExpanded] = useState(false)
  const [showDetailColumns, setShowDetailColumns] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [dialogTitle, setDialogTitle] = useState("")
  const [dialogContent, setDialogContent] = useState("")
  const [selectedManualJobIds, setSelectedManualJobIds] = useState<Set<number>>(new Set())
  const [greetingJob, setGreetingJob] = useState<BossJob | null>(null)
  const [greetingConfirmMode, setGreetingConfirmMode] = useState(false)
  const [deliveryHistoryRevision, setDeliveryHistoryRevision] = useState(0)

  const {
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
  } = useBossFilters()

  const {
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
  } = useBossJobs({ filters, buildFilterParams, requestedScanRunId: focusScanRunId })

  const {
    stats,
    dashboardStats,
    loadingDashboardStats,
    loadStats,
    loadDashboardStats,
    clearStats,
  } = useBossStats({ filters, activeScanRunId, buildFilterParams })

  const {
    taskByJobId,
    queueSize: analysisQueueSize,
    pendingCount: analysisPendingCount,
    processingCount: analysisProcessingCount,
    loading: loadingAnalysisTasks,
    retryingTaskId,
    error: analysisTaskError,
    pollRevision,
    retryTask: retryAnalysisTask,
  } = useBossAnalysisTasks()

  const openTextDialog = useCallback((title: string, content?: string) => {
    setDialogTitle(title)
    setDialogContent(content || "")
    setShowDialog(true)
  }, [])

  const refreshStats = useCallback(async () => {
    await loadStats()
    await loadDashboardStats()
    setDeliveryHistoryRevision((current) => current + 1)
  }, [loadDashboardStats, loadStats])

  const handleRetryAnalysisJob = useCallback(async (job: BossJob) => {
    const task = taskByJobId.get(job.id)
    if (!task || (task.status !== "FAILED" && task.status !== "UNKNOWN")) {
      openTextDialog("重试AI分析", "没有找到可重试的失败任务，请先刷新任务状态。")
      return
    }
    if (task.status === "UNKNOWN" && !window.confirm(
      "该任务上次执行结果未知，重新分析可能再次消耗一次 AI 调用。确认重试吗？",
    )) return
    const result = await retryAnalysisTask(task)
    openTextDialog(result.success ? "AI分析已重新排队" : "AI分析重试失败", result.message)
  }, [openTextDialog, retryAnalysisTask, taskByJobId])

  const {
    actingJobId,
    blacklistingJobId,
    actingBatch,
    actingAiBatch,
    actingManualBatch,
    clearingAnalysis,
    handleBlacklistCompany,
    handleConfirmJob,
    handleConfirmBatch,
    handleConfirmAiRecommendedBatch,
    handleConfirmManualBatch,
    handleReconcileJob,
    handleRetryJob,
    handleSkipJob,
    clearAnalysisData,
  } = useBossDeliveryActions({
    filters,
    activeScanRunId,
    page,
    size,
    loadList,
    refreshStats,
    clearLocalJobs,
    clearStats,
    openTextDialog,
  })

  const { exporting, exportCSV } = useCsvExport({
    filters,
    activeScanRunId,
    buildFilterParams,
  })

  const pendingJobs = useMemo(() => (
    items.filter((item) => item.deliveryStatus === "待确认")
  ), [items])

  const visiblePendingJobs = useMemo(() => (
    pendingCardsExpanded ? pendingJobs : pendingJobs.slice(0, 2)
  ), [pendingCardsExpanded, pendingJobs])

  const selectedManualIds = useMemo(() => (
    items
      .filter((job) => canManualDeliverAiNotMatch(job) && selectedManualJobIds.has(job.id))
      .map((job) => job.id)
  ), [items, selectedManualJobIds])

  const toggleManualJob = useCallback((id: number, checked: boolean) => {
    setSelectedManualJobIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const toggleAllManualJobs = useCallback((ids: number[], checked: boolean) => {
    setSelectedManualJobIds((current) => {
      const next = new Set(current)
      ids.forEach((id) => {
        if (checked) next.add(id)
        else next.delete(id)
      })
      return next
    })
  }, [])

  const confirmSelectedManualJobs = useCallback(async () => {
    const completed = await handleConfirmManualBatch(selectedManualIds)
    if (completed) setSelectedManualJobIds(new Set())
  }, [handleConfirmManualBatch, selectedManualIds])

  const reloadJobsAndClearSelection = useCallback(() => {
    setSelectedManualJobIds(new Set())
    void reloadJobs(refreshStats)
  }, [refreshStats, reloadJobs])

  const clearAnalysisAndSelection = useCallback(() => {
    setSelectedManualJobIds(new Set())
    void clearAnalysisData()
  }, [clearAnalysisData])

  const openGreetingDialog = useCallback((job: BossJob, confirmMode: boolean) => {
    setGreetingJob(job)
    setGreetingConfirmMode(confirmMode)
  }, [])

  const greetingDialogJob = useMemo<GreetingJob | null>(() => greetingJob ? ({
    id: greetingJob.id,
    companyName: greetingJob.companyName,
    jobName: greetingJob.jobName,
    aiGreeting: greetingJob.aiGreeting || "",
    greetingDraft: greetingJob.greetingDraft || "",
    greetingSource: greetingJob.greetingSource || "EMPTY",
    greetingUpdatedAt: greetingJob.greetingUpdatedAt || null,
    finalGreeting: greetingJob.finalGreeting || "",
  }) : null, [greetingJob])

  useEffect(() => {
    loadList(1, size)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!refreshSignal) return
    loadList(1, size)
    refreshStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal])

  useEffect(() => {
    if (!pollRevision) return
    loadList(page, size)
    refreshStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollRevision])

  useEffect(() => {
    loadList(1, size)
    refreshStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  useEffect(() => {
    setSelectedManualJobIds(new Set())
  }, [filters, page, size])

  return (
    <div className="space-y-8">
      {showHeader && (
        <PageHeader
          title="Boss 投递分析"
          subtitle="基于 boss_data 表的统计图与列表分析"
          icon={<BiBarChart size={28} />}
          actions={
            <Button size="sm" variant="destructive" onClick={clearAnalysisAndSelection} disabled={clearingAnalysis}>
              <BiTrash className="mr-1" /> {clearingAnalysis ? "清空中..." : "清空分析"}
            </Button>
          }
        />
      )}

      <BossKpiCards stats={dashboardStats} loading={loadingDashboardStats} />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><BiBriefcase /> 岗位数据</CardTitle>
              <CardDescription>当前 Boss 岗位库明细</CardDescription>
            </div>
            <BatchActionBar
              exporting={exporting}
              reloading={reloading}
              clearingAnalysis={clearingAnalysis}
              showDetailColumns={showDetailColumns}
              actingAiBatch={actingAiBatch}
              actingBatch={actingBatch}
              actingManualBatch={actingManualBatch}
              onExport={exportCSV}
              onReload={reloadJobsAndClearSelection}
              onClear={clearAnalysisAndSelection}
              onToggleDetailColumns={() => setShowDetailColumns((value) => !value)}
              onConfirmAiRecommendedBatch={handleConfirmAiRecommendedBatch}
              onConfirmBatch={handleConfirmBatch}
            />
          </div>
          <BossThresholdSettings onApplied={async () => {
            setSelectedManualJobIds(new Set())
            await Promise.all([loadList(1, size), refreshStats()])
          }} />
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-100">
            <span className="font-semibold">AI分析队列</span>
            <span>排队中 {analysisPendingCount}</span>
            <span>处理中 {analysisProcessingCount}</span>
            {loadingAnalysisTasks ? <span className="text-muted-foreground">读取中...</span> : null}
            {analysisQueueSize > 0 ? <span className="text-muted-foreground">页面可见时每 3 秒自动刷新</span> : null}
            {analysisTaskError ? <span className="text-red-600 dark:text-red-300">{analysisTaskError}</span> : null}
          </div>
        </CardHeader>
        <CardContent>
          <BossFilterPanel
            filtersOpen={filtersOpen}
            activeFilterCount={activeFilterCount}
            draftFilters={draftFilters}
            itemsLength={items.length}
            total={total}
            onToggleOpen={() => setFiltersOpen((open) => !open)}
            onDraftChange={setDraftFilters}
            onToggleStatus={toggleDraftStatus}
            onApply={applyFilters}
            onReset={resetFilters}
          />

          <BossPendingCards
            itemsLength={items.length}
            loadingList={loadingList}
            pendingJobs={pendingJobs}
            visiblePendingJobs={visiblePendingJobs}
            pendingCardsExpanded={pendingCardsExpanded}
            actingJobId={actingJobId}
            blacklistingJobId={blacklistingJobId}
            actingAiBatch={actingAiBatch}
            actingBatch={actingBatch}
            onToggleExpanded={() => setPendingCardsExpanded((expanded) => !expanded)}
            onResetToPendingFilters={resetToPendingFilters}
            onConfirmAiRecommendedBatch={handleConfirmAiRecommendedBatch}
            onOpenText={openTextDialog}
            onConfirmJob={(job) => openGreetingDialog(job, true)}
            onEditGreeting={(job) => openGreetingDialog(job, false)}
            onSkipJob={handleSkipJob}
            onBlacklistCompany={handleBlacklistCompany}
          />

          <BossJobTable
            items={items}
            total={total}
            page={page}
            size={size}
            inputPage={inputPage}
            inputSize={inputSize}
            showDetailColumns={showDetailColumns}
            loadingList={loadingList}
            actingJobId={actingJobId}
            actingManualBatch={actingManualBatch}
            selectedManualJobIds={selectedManualJobIds}
            onOpenText={openTextDialog}
            onConfirmJob={(job) => openGreetingDialog(job, true)}
            onReconcileJob={handleReconcileJob}
            onRetryJob={handleRetryJob}
            analysisTaskByJobId={taskByJobId}
            retryingAnalysisTaskId={retryingTaskId}
            onRetryAnalysisJob={handleRetryAnalysisJob}
            onSkipJob={handleSkipJob}
            onLoadList={loadList}
            onInputPageChange={setInputPage}
            onInputSizeChange={setInputSize}
            onToggleManualJob={toggleManualJob}
            onToggleAllManualJobs={toggleAllManualJobs}
            onConfirmManualBatch={confirmSelectedManualJobs}
          />
        </CardContent>
      </Card>

      <BossDeliveryHistory refreshKey={deliveryHistoryRevision} />

      <BossChartPanel
        stats={stats}
        analyticsOpen={analyticsOpen}
        onToggleOpen={() => setAnalyticsOpen((open) => !open)}
      />

      <ConfirmDeliveryDialog
        open={showDialog}
        title={dialogTitle}
        content={dialogContent}
        onClose={() => setShowDialog(false)}
      />
      <GreetingDraftDialog
        open={Boolean(greetingJob)}
        platform="boss"
        job={greetingDialogJob}
        confirmMode={greetingConfirmMode}
        submitting={actingJobId === greetingJob?.id}
        onClose={() => setGreetingJob(null)}
        onSaved={async () => {
          await loadList(page, size)
        }}
        onConfirm={async (reviewedJob) => {
          if (!greetingJob) return
          await handleConfirmJob(greetingJob, reviewedJob.finalGreeting)
          setGreetingJob(null)
        }}
      />
    </div>
  )
}
