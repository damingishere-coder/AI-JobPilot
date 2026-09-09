export type KeywordResult = {
  keywordIndex: number
  keyword: string
  collected: number
  historyDuplicates: number
  detailFailures: number
  stopReason: string
  outcome: string
}

export type ScanResultData = { runId: string; outcome: string; keywordResults: KeywordResult[] }

export function readScanResult(payload: Record<string, unknown>): ScanResultData | null {
  if (typeof payload.runId !== 'string' || !payload.runId.trim() || !Array.isArray(payload.keywordResults)) return null
  const count = (value: unknown) => Math.max(0, Number(value) || 0)
  return {
    runId: payload.runId, outcome: String(payload.outcome || 'running'),
    keywordResults: payload.keywordResults.filter(item => item && typeof item.keyword === 'string').map(item => ({
      keywordIndex: count(item.keywordIndex), keyword: item.keyword, collected: count(item.collected),
      historyDuplicates: count(item.historyDuplicates), detailFailures: count(item.detailFailures),
      stopReason: String(item.stopReason || ''), outcome: String(item.outcome || 'partial')
    }))
  }
}

const labels: Record<string, string> = { running: '进行中', complete: '完成', partial: '部分完成', failed: '失败', stopped: '已停止' }
const reasons: Record<string, string> = {
  target_reached: '已达到采集目标', platform_exhausted: '官网结果已到底',
  stagnation_safety_cap: '加载无进展，尚未确认官网结果已到底', timeout_safety_cap: '已达到关键词时间上限',
  page_safety_cap: '已达到翻页上限', unrecognized_layout: '页面岗位结构未识别'
}

export default function ScanResult({ result }: { result: ScanResultData | null }) {
  if (!result || !result.keywordResults.length) return null
  const unfinished = result.keywordResults.filter(item => item.outcome !== 'complete')
  return <section aria-label="关键词采集结果" className="rounded-lg border p-4 space-y-3">
    <p className={result.outcome === 'failed' ? 'text-red-700' : result.outcome === 'partial' ? 'text-amber-700' : ''}>
      采集结果 · {labels[result.outcome] || '进行中'}
    </p>
    {unfinished.length > 0 && <p className="text-sm text-amber-700">未完成关键词：{unfinished.map(item => item.keyword).join('、')}。已验证的岗位已保留。</p>}
    <ul className="space-y-2 text-sm">
      {result.keywordResults.map(item => <li key={item.keywordIndex}>
        <span className="font-medium">{item.keyword}</span>：完整详情 {item.collected} 个，历史重复 {item.historyDuplicates} 个，详情失败 {item.detailFailures} 个。
        {item.stopReason === 'platform_exhausted' && item.collected === 0 && item.detailFailures === 0
          ? item.historyDuplicates > 0 ? '官网结果全部为历史重复。' : '官网明确没有匹配岗位。'
          : `${reasons[item.stopReason] || '采集未完成'}。`}
      </li>)}
    </ul>
  </section>
}
