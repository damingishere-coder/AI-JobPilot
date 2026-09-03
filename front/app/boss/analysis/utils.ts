import type { AiReasonDimension, AiReasonHardConflict, BossJob, ParsedAiReason } from "./types"
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
  const reason = parseAiReason(job.aiReason)
  const dimensionRisks = reason.dimensions
    .filter((item) => item.status === "PARTIAL" || item.status === "CONFLICT")
    .map((item) => `${item.label}：${item.note || (item.status === "CONFLICT" ? "存在冲突" : "部分匹配")}`)
  const risks = Array.from(new Set([
    ...reason.hardConflicts.map((item) => `硬冲突：${item.requirement}`),
    ...reason.gaps,
    ...dimensionRisks,
    ...reason.unknowns.map((item) => `待核实：${item}`),
  ]))
  if (risks.length > 0) return risks.join("\n")
  if (reason.errorCode) return `${reason.summary}（${reason.errorCode}）`
  if (!job.jobUrl) return "缺少原岗位链接，确认前建议核对岗位来源。"
  if (!job.aiScore && job.aiScore !== 0) return "暂无AI分数，确认前建议人工复核。"
  return "暂无明显风险点。"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
    : []
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

const MATCH_STATUS_LABEL: Record<string, string> = {
  MATCH: "匹配",
  PARTIAL: "部分匹配",
  UNKNOWN: "待核实",
  CONFLICT: "冲突",
}

function parseDimensions(value: unknown): AiReasonDimension[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.key !== "string") return []
    return [{
      key: item.key,
      label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : item.key,
      weight: numberValue(item.weight) ?? 0,
      status: typeof item.status === "string" ? item.status : "UNKNOWN",
      awarded: numberValue(item.awarded) ?? 0,
      jobEvidence: stringList(item.jobEvidence),
      resumeEvidence: stringList(item.resumeEvidence),
      note: typeof item.note === "string" ? item.note.trim() : "",
    }]
  })
}

function parseHardConflicts(value: unknown): AiReasonHardConflict[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.requirement !== "string" || !item.requirement.trim()) return []
    return [{
      requirement: item.requirement.trim(),
      jobEvidence: stringList(item.jobEvidence),
      resumeEvidence: stringList(item.resumeEvidence),
    }]
  })
}

export function parseAiReason(value?: string | null): ParsedAiReason {
  const text = (value || "").trim()
  const empty: ParsedAiReason = {
    schemaVersion: 0,
    summary: "暂无AI理由",
    matches: [],
    gaps: [],
    unknowns: [],
    dimensions: [],
    hardConflicts: [],
    malformed: false,
  }
  if (!text) return empty
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed)) throw new Error("reason is not an object")
    const schemaVersion = numberValue(parsed.schemaVersion) ?? 1
    return {
      schemaVersion,
      summary: typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : "暂无AI结论",
      matches: stringList(schemaVersion >= 2 ? parsed.matches : parsed.strengths),
      gaps: stringList(schemaVersion >= 2 ? parsed.gaps : parsed.risks),
      unknowns: stringList(parsed.unknowns),
      dimensions: parseDimensions(parsed.dimensions),
      hardConflicts: parseHardConflicts(parsed.hardConflicts),
      threshold: numberValue(parsed.threshold),
      errorCode: typeof parsed.errorCode === "string" && parsed.errorCode.trim()
        ? parsed.errorCode.trim()
        : undefined,
      malformed: false,
    }
  } catch {
    if (text.startsWith("{") || text.startsWith("[")) {
      return {
        ...empty,
        summary: "AI分析理由格式异常，请重试该岗位",
        errorCode: "AI_REASON_INVALID_JSON",
        malformed: true,
      }
    }
    return { ...empty, summary: text }
  }
}

export function formatAiReasonDetail(value?: string | null) {
  const reason = parseAiReason(value)
  const sections: string[] = [`结论\n${reason.summary}`]
  if (reason.matches.length > 0) sections.push(`匹配证据\n${reason.matches.map((item, index) => `${index + 1}. ${item}`).join("\n")}`)
  if (reason.gaps.length > 0) sections.push(`明确差距\n${reason.gaps.map((item, index) => `${index + 1}. ${item}`).join("\n")}`)
  if (reason.unknowns.length > 0) sections.push(`待核实\n${reason.unknowns.map((item, index) => `${index + 1}. ${item}`).join("\n")}`)
  if (reason.dimensions.length > 0) {
    sections.push(`分项得分\n${reason.dimensions.map((item) =>
      `${item.label}：${Number.isInteger(item.awarded) ? item.awarded : item.awarded.toFixed(2)}/${item.weight}（${MATCH_STATUS_LABEL[item.status] || item.status}）${item.note ? `，${item.note}` : ""}`
      + `${item.jobEvidence.length > 0 ? `\n   岗位原文：${item.jobEvidence.join("；")}` : ""}`
      + `${item.resumeEvidence.length > 0 ? `\n   简历原文：${item.resumeEvidence.join("；")}` : ""}`).join("\n")}`)
  }
  if (reason.hardConflicts.length > 0) {
    sections.push(`硬冲突\n${reason.hardConflicts.map((item, index) =>
      `${index + 1}. ${item.requirement}\n   岗位原文：${item.jobEvidence.join("；")}\n   简历原文：${item.resumeEvidence.join("；")}`).join("\n")}`)
  }
  if (reason.threshold !== undefined) sections.push(`当前投递阈值\n${reason.threshold}`)
  if (reason.errorCode) sections.push(`错误代码\n${reason.errorCode}`)
  return sections.join("\n\n")
}

export function badgeClass(kind: "delivery" | "hr" | "recruitment", value?: string) {
  const base = "px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap"
  const v = (value || "").trim()
  if (kind === "delivery") {
    if (v.includes("已投递")) return `${base} bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300`
    if (v.includes("待确认")) return `${base} bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300`
    if (v.includes("投递确认中")) return `${base} bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300`
    if (v.includes("投递结果待确认")) return `${base} bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300`
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
