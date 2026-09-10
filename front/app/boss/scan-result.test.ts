import { describe, expect, it } from 'vitest'

import { hasBossScanResult, readBossScanRunId } from './scan-result'

describe('Boss 扫描结果聚焦', () => {
  it('仅恢复历史结果时仍视为本次扫描有结果', () => {
    expect(hasBossScanResult({ saved: 0, listCollected: 0, restored: 2 })).toBe(true)
  })

  it('没有新采集或历史恢复时保持空结果', () => {
    expect(hasBossScanResult({ saved: 0, listCollected: 0, restored: 0 })).toBe(false)
  })

  it('从进度消息读取并清理扫描批次 ID', () => {
    expect(readBossScanRunId({ runId: ' boss-run-1 ' })).toBe('boss-run-1')
    expect(readBossScanRunId({ runId: 42 })).toBe('')
  })
})
