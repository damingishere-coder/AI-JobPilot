import { API_BASE, localActionFetch } from './api'

export const strategyDimensions: Record<string, string> = { KEYWORD: '首次发现关键词', ROLE: '岗位方向（规则分类）', COMPANY_SCALE: '公司规模', SALARY: '月薪范围中点', RESUME: '平台实际发送简历', SCORE: '历史 AI 分组', PLATFORM: '平台' }
export type StrategyMetric = { mature: number; observed: number; positive: number; positiveIds: number[]; negativeIds: number[]; unobservedIds: number[]; confidence: string; ratePercent: number | null; coveragePercent: number }
export type StrategyGroup = { dimension: string; value: string; applications: number; reply: StrategyMetric; interview: StrategyMetric; opportunityIds: number[] }
export type StrategySnapshot = {
  id: number; profile_id: number; version: number; cutoff: string; window_days: number; through_event_id: number; rule_version: string;
  decisions: Record<string, { decision: string; history: { decision: string; at: string }[] }>;
  result: { exclusions: Record<string, number>; interviewRecords: number; minimumSample: number; analysis: {
    applications: number; reply: StrategyMetric; interview: StrategyMetric; groups: StrategyGroup[];
    insights: { id: string; dimension: string; value: string; text: string; confidence: string; samples: number }[];
  } };
}
export async function strategyApi<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const url = `${API_BASE}/api/strategy${path}`
  const response = body ? await localActionFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }) : await fetch(url, { signal, cache: 'no-store' })
  const value = await response.json().catch(() => { throw new Error('策略数据读取失败，请稍后刷新') })
  if (!response.ok || value.success === false) throw new Error(value.message || '策略操作失败')
  return value
}
