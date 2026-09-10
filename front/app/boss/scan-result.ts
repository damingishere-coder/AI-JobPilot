export interface BossScanResultSummary {
  saved?: number
  listCollected?: number
  restored?: number
}

export const hasBossScanResult = (summary: BossScanResultSummary): boolean => (
  Number(summary.saved || 0)
  + Number(summary.listCollected || 0)
  + Number(summary.restored || 0)
) > 0

export const readBossScanRunId = (payload: Record<string, unknown>): string => (
  typeof payload.runId === 'string' ? payload.runId.trim() : ''
)
