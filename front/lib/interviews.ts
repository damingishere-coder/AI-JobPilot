import { API_BASE } from './api'

export const interviewStatuses: Record<string, string> = { PENDING: '待安排', SCHEDULED: '已安排', COMPLETED: '已完成', CANCELLED: '已取消' }
export const interviewModes: Record<string, string> = { ONLINE: '线上', PHONE: '电话', ONSITE: '现场', OTHER: '其他' }
export const interviewPreparation: Record<string, string> = {
  TIME_LOCATION: '核对时间、方式与地点', JOB_RESUME: '复习 JD 与投递简历', PROJECT_STORIES: '准备项目经历与案例', QUESTIONS: '准备向面试官提问',
}
export type Interview = {
  id: number; opportunity_id: number; round_number: number; scheduled_at: string | null; timezone: string;
  mode: string; status: string; preparation: string[]; note: string; version: number; opportunity_version: number;
  job_name: string; company_name: string; archived: number;
}
export async function loadInterviews(opportunityId?: number, page = 1, size = 20, signal?: AbortSignal): Promise<{ items: Interview[]; total: number; profileId: number }> {
  const query = new URLSearchParams({ page: String(page), size: String(size) })
  if (opportunityId) query.set('opportunityId', String(opportunityId))
  const response = await fetch(`${API_BASE}/api/interviews?${query}`, { cache: 'no-store', signal })
  const data = await response.json().catch(() => { throw new Error('面试数据读取失败，请稍后刷新') })
  if (!response.ok || data.success === false) throw new Error(data.message || '面试数据读取失败')
  return data
}
export function interviewTime(record: Interview) {
  return record.scheduled_at ? `${new Date(record.scheduled_at).toLocaleString('zh-CN', { timeZone: record.timezone, hour12: false })}（${record.timezone}）` : '时间尚未确认'
}
export function interviewEventSummary(payload?: string) {
  try {
    const value = JSON.parse(payload || '{}')
    if (!value.interviewId) return ''
    const format = (time: string | null) => time ? new Date(time).toLocaleString('zh-CN', { timeZone: value.timezone || 'Asia/Shanghai', hour12: false }) : '时间未知'
    const changed = value.previousScheduledAt && value.previousScheduledAt !== value.scheduledAt
    return `第 ${value.round} 轮 · ${interviewStatuses[value.status] || '历史状态'} · ${changed ? `${format(value.previousScheduledAt)} → ` : ''}${format(value.scheduledAt)}（${value.timezone || 'Asia/Shanghai'}）`
  } catch { return '历史面试详情格式不完整，请查看当前面试记录' }
}
