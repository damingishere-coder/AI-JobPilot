import { API_BASE, localActionFetch } from './api'

export const stages: Record<string, string> = {
  DISCOVERED: '已发现', SHORTLISTED: '已关注', APPLIED: '已投递', RECRUITER_REPLIED: 'HR 已回复',
  CHATTING: '沟通中', PHONE_SCREEN: '电话沟通', INTERVIEW: '面试', OFFER: 'Offer', REJECTED: '淘汰', WITHDRAWN: '主动退出',
}
export const applicationStatuses: Record<string, string> = {
  NOT_REQUESTED: '尚未请求', REQUESTED: '请求中', CONFIRMED: '已确认', FAILED: '失败', UNKNOWN: '结果未知，需对账',
}
export type Opportunity = {
  id: number; profile_id?: number; platform: string; job_name: string; company_name: string; stage: string;
  interest: string; archived: number; version: number; application_status?: string; follow_up_at: string | null;
}
export type OpportunityEvent = {
  id: number; type: string; source: string; occurred_at: string | null; observed_at: string; reason: string;
}
export type OpportunityDetail = Opportunity & {
  note: string; nextAction: string; job_snapshot: string; events: OpportunityEvent[];
  applications: { id: number; state: string; evidence: string; requested_at: string }[];
  analyses: { id: number; score: number; decision: string; summary: string; resume_version_id: number | null }[];
}
export async function opportunityApi<T>(path = '', body?: object, signal?: AbortSignal): Promise<T> {
  const url = `${API_BASE}/api/opportunities${path}`
  const response = body
    ? await localActionFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await fetch(url, { cache: 'no-store', signal })
  const result = await response.json()
  if (!response.ok || result.success === false) throw new Error(result.message || '求职机会加载失败')
  return result as T
}

export function jobDescription(snapshot: string) {
  try { return String(JSON.parse(snapshot).description || '暂无 JD，可前往原平台分析页查看。') }
  catch { return '历史岗位信息不完整' }
}
