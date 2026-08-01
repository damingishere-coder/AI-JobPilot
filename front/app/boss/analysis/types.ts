export type NameValue = { name: string; value: number }

export type BucketValue = { bucket: string; value: number }

export type StatsResponse = {
  kpi: {
    total: number
    delivered: number
    pending: number
    waitingConfirm?: number
    listCollected?: number
    insufficient?: number
    filtered: number
    failed: number
    avgMonthlyK?: number | null
  }
  overview?: {
    aiAvgScore?: number | null
    aiPassCount?: number
    aiRejectCount?: number
    aiFailedCount?: number
    priorityCompanyCount?: number
    missingLinkCount?: number
    missingSalaryCount?: number
    latestCreatedAt?: string | null
    topCity?: string | null
    topIndustry?: string | null
    topCompany?: string | null
    topExperience?: string | null
    topDegree?: string | null
  }
  charts: {
    byStatus: NameValue[]
    byCity: NameValue[]
    byIndustry: NameValue[]
    byCompany: NameValue[]
    byExperience: NameValue[]
    byDegree: NameValue[]
    salaryBuckets: BucketValue[]
    dailyTrend: NameValue[]
    hrActivity: NameValue[]
    byFailureType?: NameValue[]
  }
}

export type BossJob = {
  id: number
  companyName?: string
  jobName?: string
  salary?: string
  location?: string
  experience?: string
  degree?: string
  hrName?: string
  hrPosition?: string
  hrActiveStatus?: string
  deliveryStatus?: string
  failureType?: string
  failureReason?: string
  jobUrl?: string
  recruitmentStatus?: string
  companyAddress?: string
  industry?: string
  introduce?: string
  financingStage?: string
  companyScale?: string
  jobDescription?: string
  aiScore?: number
  aiDecision?: string
  aiReason?: string
  priorityCompany?: number
  sourceKeyword?: string
  scanRunId?: string
  createdAt?: string
}

export type PagedResult = {
  items: BossJob[]
  total: number
  page: number
  size: number
}

export type FilterState = {
  statuses: string[]
  location: string
  experience: string
  degree: string
  minK: string
  maxK: string
  minAiScore: string
  keyword: string
  filterHeadhunter: boolean
}

export const DELIVERY_STATUS_OPTIONS = ["待确认", "LIST_COLLECTED", "AI分析中", "已投递", "未投递", "AI不匹配", "AI分析失败", "采集信息不足", "已过滤", "已跳过", "投递失败"]
export const EXPERIENCE_OPTIONS = ["在校/应届", "1年以内", "1-3年", "3-5年", "5-10年", "10年以上"]
export const DEGREE_OPTIONS = ["不限", "中专/中技", "高中", "大专", "本科", "硕士", "博士"]

export const EMPTY_FILTERS: FilterState = {
  statuses: [],
  location: "",
  experience: "",
  degree: "",
  minK: "",
  maxK: "",
  minAiScore: "",
  keyword: "",
  filterHeadhunter: false,
}

export const DEFAULT_PENDING_FILTERS: FilterState = { ...EMPTY_FILTERS, statuses: ["待确认"] }
export const LIST_COLLECTED_FILTERS: FilterState = { ...EMPTY_FILTERS, statuses: ["LIST_COLLECTED"] }

export const FAILURE_TYPE_LABELS: Record<string, string> = {
  LOGIN_EXPIRED: "登录失效",
  PLATFORM_VERIFICATION: "平台验证",
  JOB_CLOSED: "岗位关闭",
  BUTTON_UNCLICKABLE: "按钮不可点击",
  ALREADY_DELIVERED: "已投递过",
  NETWORK_ERROR: "网络异常",
  UNKNOWN_ERROR: "未知错误",
}

export const CATEGORY_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#6366f1",
  "#22c55e",
  "#fb7185",
  "#a78bfa",
  "#f97316",
  "#06b6d4",
  "#4ade80",
  "#2dd4bf",
  "#f472b6",
  "#64748b",
]
