import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { BossJobTable } from "./BossJobTable"
import type { BossJob, JobAnalysisTask } from "../types"

function renderTable(job: BossJob, task?: JobAnalysisTask) {
  const onOpenText = vi.fn()
  const onRetryAnalysisJob = vi.fn()
  render(<BossJobTable
    items={[job]}
    total={1}
    page={1}
    size={20}
    inputPage={1}
    inputSize={20}
    showDetailColumns={false}
    loadingList={false}
    actingJobId={null}
    actingManualBatch={false}
    selectedManualJobIds={new Set()}
    onOpenText={onOpenText}
    onConfirmJob={vi.fn()}
    onReconcileJob={vi.fn()}
    onRetryJob={vi.fn()}
    analysisTaskByJobId={task ? new Map([[job.id, task]]) : new Map()}
    retryingAnalysisTaskId={null}
    onRetryAnalysisJob={onRetryAnalysisJob}
    onSkipJob={vi.fn()}
    onLoadList={vi.fn()}
    onInputPageChange={vi.fn()}
    onInputSizeChange={vi.fn()}
    onToggleManualJob={vi.fn()}
    onToggleAllManualJobs={vi.fn()}
    onConfirmManualBatch={vi.fn()}
  />)
  return { onOpenText, onRetryAnalysisJob }
}

describe("Boss岗位表 AI分析展示", () => {
  it("结构化展示结论且失败岗位提供单岗重试", () => {
    const rawReason = JSON.stringify({
      schemaVersion: 2,
      summary: "技能匹配但薪资待核实",
      matches: ["Java匹配"],
      gaps: [],
      unknowns: ["薪资待核实"],
      dimensions: [],
      hardConflicts: [],
      threshold: 75,
    })
    const job: BossJob = { id: 9, jobName: "Java工程师", deliveryStatus: "AI分析失败", aiReason: rawReason }
    const task: JobAnalysisTask = {
      id: 19,
      profileId: 1,
      platform: "boss",
      jobKey: "job-9",
      jobRowId: 9,
      status: "FAILED",
      attemptCount: 1,
    }
    const { onOpenText, onRetryAnalysisJob } = renderTable(job, task)

    expect(screen.getByText("技能匹配但薪资待核实")).toBeInTheDocument()
    expect(screen.queryByText(rawReason)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "重试分析" }))
    expect(onRetryAnalysisJob).toHaveBeenCalledWith(job)
    fireEvent.click(screen.getByText("技能匹配但薪资待核实"))
    expect(onOpenText).toHaveBeenCalledWith("AI分析详情", expect.stringContaining("待核实"))
  })
})
