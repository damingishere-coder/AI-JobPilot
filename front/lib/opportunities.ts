import { API_BASE, localActionFetch } from './api'

export const stages: Record<string, string> = {
  DISCOVERED: '已发现', SHORTLISTED: '已关注', APPLIED: '已投递', RECRUITER_REPLIED: 'HR 已回复',
  CHATTING: '沟通中', PHONE_SCREEN: '电话沟通', INTERVIEW: '面试', OFFER: 'Offer', REJECTED: '淘汰', WITHDRAWN: '主动退出',
}
export const applicationStatuses: Record<string, string> = {
  NOT_REQUESTED: '尚未请求', REQUESTED: '请求中', CONFIRMED: '已确认', FAILED: '失败', UNKNOWN: '结果未知，需对账',
}
const eventLabels: Record<string, string> = {
  DISCOVERED: '发现岗位', SEARCH_DISCOVERY: '搜索来源已记录', AI_ANALYZED: 'AI 分析完成',
  APPLICATION_REQUESTED: '用户已确认投递请求', APPLICATION_CONFIRMED: '投递结果已确认', APPLICATION_FAILED: '投递失败', APPLICATION_UNKNOWN: '投递结果未知',
  USER_UPDATED: '用户更新记录', CORRECTION: '更正历史记录', ARCHIVED: '归档机会',
  HR_INBOUND_OBSERVED: '观察到 HR 消息，结果待确认', HR_OBSERVATIONS_REVIEWED: '已查看消息提醒，未自动确认结果', CONVERSATION_LINKED: '用户确认会话关联', CONVERSATION_UNLINKED: '用户取消会话关联',
  OUTCOME_RECRUITER_REPLIED: '确认 HR 已回复', OUTCOME_CHATTING: '确认继续沟通', OUTCOME_PHONE_SCREEN: '记录电话沟通',
  OUTCOME_INTERVIEW_INVITED: '确认收到面试邀请', OUTCOME_OFFER: '确认收到 Offer', OUTCOME_REJECTED: '确认淘汰结果', OUTCOME_WITHDRAWN: '记录主动退出', OUTCOME_NO_REPLY_OBSERVED: '已核对，暂未回复',
}
export const eventLabel = (type: string) => eventLabels[type] || '历史事件'
export const eventSourceLabel = (source: string) => ({ USER: '用户记录', COLLECTOR: '岗位采集', LEGACY_IMPORT: '历史导入', AI: 'AI 分析', APPLICATION_SERVICE: '投递结果', HR_OBSERVATION: '会话观察' }[source] || '历史来源')
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
  const result = await response.json().catch(() => { throw new Error('后端返回异常，请稍后刷新核对') })
  if (!response.ok || result.success === false) throw new Error(result.message || '求职机会加载失败')
  return result as T
}

export function jobDescription(snapshot: string) {
  try { return String(JSON.parse(snapshot).description || '暂无 JD，可前往原平台分析页查看。') }
  catch { return '历史岗位信息不完整' }
}

export function localDateTimeInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
