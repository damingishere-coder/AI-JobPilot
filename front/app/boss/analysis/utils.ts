import type { BossJob } from "./types"
import { FAILURE_TYPE_LABELS } from "./types"

export function formatDateOnlyValue(value?: string | null) {
  if (!value) return "暂无数据"
  const date = new Date(value)
  if (!Number.isNaN(date.getTime())) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, "0")
    const d = String(date.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  return value.slice(0, 10) || "暂无数据"
}

export function formatDateOnly(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  if (!Number.isNaN(date.getTime())) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, "0")
    const d = String(date.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  return value.slice(0, 10)
}

export function failureTypeLabel(type?: string) {
  const key = (type || "UNKNOWN_ERROR").trim()
  return FAILURE_TYPE_LABELS[key] || key || "未知错误"
}

export function failureReasonText(job: BossJob) {
  if (job.deliveryStatus !== "投递失败") return "-"
  const reason = job.failureReason?.trim()
  const type = failureTypeLabel(job.failureType)
  return reason ? `${type}：${reason}` : type
}

export function canManualDeliverAiNotMatch(job: BossJob) {
  return job.deliveryStatus === "AI不匹配" && Boolean(job.jobUrl?.trim())
}

export function deliveryStatusLabel(value?: string) {
  return value === "LIST_COLLECTED" ? "已采集" : value || "-"
}

export function riskTextOf(job: BossJob) {
  const reason = (job.aiReason || "").trim()
  if (reason) return reason
  if (!job.jobUrl) return "缺少原岗位链接，确认前建议核对岗位来源。"
  if (!job.aiScore && job.aiScore !== 0) return "暂无AI分数，确认前建议人工复核。"
  return "暂无明显风险点。"
}

export function badgeClass(kind: "delivery" | "hr" | "recruitment", value?: string) {
  const base = "px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap"
  const v = (value || "").trim()
  if (kind === "delivery") {
    if (v.includes("已投递")) return `${base} bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300`
    if (v.includes("待确认")) return `${base} bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300`
    if (v === "LIST_COLLECTED") return `${base} bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300`
    if (v.includes("AI分析中")) return `${base} bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300`
    if (v.includes("采集信息不足")) return `${base} bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300`
    if (v.includes("AI不匹配")) return `${base} bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300`
    if (v.includes("已过滤")) return `${base} bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300`
    if (v.includes("已跳过")) return `${base} bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300`
    if (v.includes("失败")) return `${base} bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300`
    return `${base} bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300`
  }
  if (kind === "hr") {
    if (/刚|在线|今日/.test(v)) return `${base} bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300`
    if (/小时|近/.test(v)) return `${base} bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300`
    if (/天|周|月|很久/.test(v)) return `${base} bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300`
    return `${base} bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300`
  }
  if (/暂停|关闭|下线|结束/.test(v)) return `${base} bg-gray-200 text-gray-800 dark:bg-gray-700/60 dark:text-gray-200`
  if (/急/.test(v)) return `${base} bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300`
  if (/招|招聘|中/.test(v)) return `${base} bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300`
  return `${base} bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-200`
}
