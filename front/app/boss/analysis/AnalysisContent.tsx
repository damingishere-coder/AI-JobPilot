"use client"

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from "chart.js"
import type { ChartDataset } from "chart.js"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import PageHeader from "@/app/components/PageHeader"
import { API_BASE } from "@/lib/api"
import { sendChromeBridgeMessage } from "@/lib/chromeBridge"
import {
  BiRefresh,
  BiDownload,
  BiBarChart,
  BiLineChart,
  BiPieChart,
  BiBriefcase,
  BiFilterAlt,
  BiSearch,
  BiX,
  BiChevronDown,
  BiChevronUp,
  BiLinkExternal,
  BiTrash,
  BiCheckCircle,
  BiBlock,
} from "react-icons/bi"

type NameValue = { name: string; value: number }
type BucketValue = { bucket: string; value: number }

type StatsResponse = {
  kpi: {
    total: number
    delivered: number
    pending: number
    waitingConfirm?: number
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

type BossJob = {
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
  scanRunId?: string
  createdAt?: string
}

type PagedResult = {
  items: BossJob[]
  total: number
  page: number
  size: number
}

const DELIVERY_STATUS_OPTIONS = ["待确认", "AI分析中", "已投递", "未投递", "AI不匹配", "AI分析失败", "采集信息不足", "已过滤", "已跳过", "投递失败"]
const EXPERIENCE_OPTIONS = ["在校/应届", "1年以内", "1-3年", "3-5年", "5-10年", "10年以上"]
const DEGREE_OPTIONS = ["不限", "中专/中技", "高中", "大专", "本科", "硕士", "博士"]

type FilterState = {
  statuses: string[]
  location: string
  experience: string
  degree: string
  minK: string
  maxK: string
  keyword: string
  filterHeadhunter: boolean
}

type ChartRef = { destroy: () => void }

const EMPTY_FILTERS: FilterState = {
  statuses: [],
  location: "",
  experience: "",
  degree: "",
  minK: "",
  maxK: "",
  keyword: "",
  filterHeadhunter: false,
}
const DEFAULT_PENDING_FILTERS: FilterState = { ...EMPTY_FILTERS, statuses: ["待确认"] }
const FAILURE_TYPE_LABELS: Record<string, string> = {
  LOGIN_EXPIRED: "登录失效",
  PLATFORM_VERIFICATION: "平台验证",
  JOB_CLOSED: "岗位关闭",
  BUTTON_UNCLICKABLE: "按钮不可点击",
  ALREADY_DELIVERED: "已投递过",
  NETWORK_ERROR: "网络异常",
  UNKNOWN_ERROR: "未知错误",
}

// 通用分类颜色（用于柱状/饼状图每个分类不同颜色）
const CATEGORY_COLORS = [
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

Chart.register(ArcElement, BarElement, LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend, Title)

function ChartCanvas({
  type,
  labels,
  data,
  title,
  color = "#3b82f6",
  colors,
}: {
  type: "pie" | "bar" | "line"
  labels: string[]
  data: number[]
  title?: string
  color?: string
  colors?: string[]
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const chartRef = useRef<ChartRef | null>(null)
  // 颜色统一使用纯色（不透明）
  const toSolid = (hex: string) => hex

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return

    // 销毁旧图表
    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    const pieColorsBase = [
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
    ]

    const backgroundColor = (() => {
      if (type === "pie") {
        const arr = (colors && colors.length ? colors : pieColorsBase).slice(0, labels.length)
        return arr
      }
      if (type === "bar" && colors && colors.length) {
        // 柱状图每个分类使用纯色
        return colors.slice(0, data.length).map((c) => toSolid(c))
      }
      // 折线图/默认均使用纯色
      return toSolid(color ?? "#3b82f6")
    })()

    const borderColor = (() => {
      if (type === "pie") {
        // 饼图无需边框或统一边框
        return undefined
      }
      if (type === "bar" && colors && colors.length) {
        return colors.slice(0, data.length)
      }
      return color
    })()

    const dataset: ChartDataset<"pie" | "bar" | "line", number[]> = {
      label: title || "",
      data,
      backgroundColor,
      borderColor,
      ...(type === "line"
        ? {
            fill: false,
            pointBackgroundColor: toSolid(color),
            pointBorderColor: toSolid(color),
          }
        : {}),
    }

    chartRef.current = new Chart(ctx, {
      type,
      data: {
        labels,
        datasets: [dataset],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: type === "pie" },
          title: { display: !!title, text: title },
        },
        scales: type !== "pie" ? { x: { ticks: { autoSkip: true } }, y: { beginAtZero: true } } : undefined,
      },
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [type, labels, data, title, color, colors])

  return <canvas ref={canvasRef} className="h-44 w-full md:h-48" />
}

function formatDateOnlyValue(value?: string | null) {
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

function OverviewMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-foreground" title={String(value)}>
        {value}
      </div>
    </div>
  )
}

function failureTypeLabel(type?: string) {
  const key = (type || "UNKNOWN_ERROR").trim()
  return FAILURE_TYPE_LABELS[key] || key || "未知错误"
}

function failureReasonText(job: BossJob) {
  if (job.deliveryStatus !== "投递失败") return "-"
  const reason = job.failureReason?.trim()
  const type = failureTypeLabel(job.failureType)
  return reason ? `${type}：${reason}` : type
}

function OverviewSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0 rounded-lg border border-white/20 bg-white/35 p-4 dark:bg-white/5">
      <div className="mb-4">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </div>
      {children}
    </div>
  )
}

function OverviewPanel({ stats, loading }: { stats: StatsResponse | null; loading: boolean }) {
  const k = stats?.kpi
  const overview = stats?.overview
  const statusCount = (name: string) => stats?.charts.byStatus.find((item) => item.name === name)?.value ?? 0
  const total = k?.total ?? 0
  const delivered = k?.delivered ?? 0
  const waitingConfirm = k?.waitingConfirm ?? 0
  const filtered = k?.filtered ?? 0
  const failed = k?.failed ?? 0
  const skipped = statusCount("已跳过")
  const remainder = Math.max(0, total - delivered - waitingConfirm - filtered - failed - skipped)
  const segments = [
    { label: "已投递", value: delivered, className: "bg-emerald-500" },
    { label: "待确认", value: waitingConfirm, className: "bg-cyan-500" },
    { label: "已过滤", value: filtered, className: "bg-pink-500" },
    { label: "失败/跳过", value: failed + skipped, className: "bg-amber-500" },
    { label: "其他", value: remainder, className: "bg-slate-400" },
  ].filter((segment) => segment.value > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><BiBarChart /> 数据总览</CardTitle>
        <CardDescription>基于当前 Boss 岗位库生成的投递进度、AI 判断、岗位画像与数据质量概况</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && !stats ? (
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            加载中...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
            <OverviewSection title="投递进度" description="按当前状态查看岗位流转">
              <div className="grid grid-cols-2 gap-4">
                <OverviewMetric label="总岗位" value={total} />
                <OverviewMetric label="待确认" value={waitingConfirm} />
                <OverviewMetric label="已投递" value={delivered} />
                <OverviewMetric label="过滤/失败/跳过" value={filtered + failed + skipped} />
              </div>
              <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                {total > 0 ? (
                  <div className="flex h-full w-full">
                    {segments.map((segment) => (
                      <div
                        key={segment.label}
                        className={segment.className}
                        style={{ width: `${(segment.value / total) * 100}%` }}
                        title={`${segment.label}: ${segment.value}`}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </OverviewSection>

            <OverviewSection title="AI判断" description="查看 AI 分析后的通过与风险">
              <div className="grid grid-cols-2 gap-4">
                <OverviewMetric label="平均AI分" value={overview?.aiAvgScore ?? "暂无数据"} />
                <OverviewMetric label="AI通过" value={overview?.aiPassCount ?? 0} />
                <OverviewMetric label="AI不匹配" value={overview?.aiRejectCount ?? 0} />
                <OverviewMetric label="优先公司" value={overview?.priorityCompanyCount ?? 0} />
              </div>
              <div className="mt-4 text-xs text-muted-foreground">分析失败 {overview?.aiFailedCount ?? 0} 个</div>
            </OverviewSection>

            <OverviewSection title="岗位画像" description="从城市、行业、公司与要求看集中度">
              <div className="grid grid-cols-2 gap-4">
                <OverviewMetric label="TOP城市" value={overview?.topCity || "暂无数据"} />
                <OverviewMetric label="TOP行业" value={overview?.topIndustry || "暂无数据"} />
                <OverviewMetric label="TOP公司" value={overview?.topCompany || "暂无数据"} />
                <OverviewMetric label="主流经验" value={overview?.topExperience || "暂无数据"} />
              </div>
              <div className="mt-4">
                <OverviewMetric label="主流学历" value={overview?.topDegree || "暂无数据"} />
              </div>
            </OverviewSection>

            <OverviewSection title="数据质量" description="检查采集完整度与最近入库时间">
              <div className="grid grid-cols-2 gap-4">
                <OverviewMetric label="采集不足" value={k?.insufficient ?? 0} />
                <OverviewMetric label="缺少链接" value={overview?.missingLinkCount ?? 0} />
                <OverviewMetric label="缺少薪资" value={overview?.missingSalaryCount ?? 0} />
                <OverviewMetric label="最近入库" value={formatDateOnlyValue(overview?.latestCreatedAt)} />
              </div>
            </OverviewSection>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PendingJobCard({
  job,
  acting,
  blacklisting,
  riskText,
  onOpenText,
  onConfirm,
  onSkip,
  onBlacklist,
}: {
  job: BossJob
  acting: boolean
  blacklisting: boolean
  riskText: string
  onOpenText: (title: string, content?: string) => void
  onConfirm: () => void
  onSkip: () => void
  onBlacklist: () => void
}) {
  const jobTitle = job.jobName || "未命名岗位"
  const company = job.companyName || "未知公司"

  return (
    <Card className="border-cyan-200 bg-cyan-50/50 dark:border-cyan-900/60 dark:bg-cyan-950/10">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="line-clamp-2 text-base">{jobTitle}</CardTitle>
            <CardDescription className="mt-1">{company}</CardDescription>
          </div>
          <div className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-cyan-700 shadow-sm dark:bg-cyan-950/60 dark:text-cyan-200">
            AI {job.aiScore ?? "-"}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
          <div>
            <div className="text-xs text-muted-foreground">薪资</div>
            <div className="mt-1 font-medium">{job.salary || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">地点</div>
            <div className="mt-1 font-medium">{job.location || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">经验</div>
            <div className="mt-1 font-medium">{job.experience || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">学历</div>
            <div className="mt-1 font-medium">{job.degree || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">状态</div>
            <div className="mt-1 font-medium">{job.deliveryStatus || "-"}</div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            className="rounded-lg border border-white/60 bg-white/70 p-3 text-left text-sm dark:border-white/10 dark:bg-neutral-900/50"
            onClick={() => onOpenText("AI理由", job.aiReason)}
          >
            <div className="mb-1 text-xs font-semibold text-muted-foreground">AI理由</div>
            <div className="line-clamp-3 leading-6">{job.aiReason || "暂无AI理由"}</div>
          </button>
          <button
            type="button"
            className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-left text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100"
            onClick={() => onOpenText("风险点", riskText)}
          >
            <div className="mb-1 text-xs font-semibold">风险点</div>
            <div className="line-clamp-3 leading-6">{riskText}</div>
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {job.jobUrl ? (
            <Button asChild size="sm" variant="outline">
              <a href={job.jobUrl} target="_blank" rel="noreferrer">
                <BiLinkExternal className="mr-1" /> 查看原岗位
              </a>
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled>
              <BiLinkExternal className="mr-1" /> 无岗位链接
            </Button>
          )}
          <Button size="sm" variant="success" disabled={acting} onClick={onConfirm}>
            <BiCheckCircle className="mr-1" /> {acting ? "处理中..." : "确认投递"}
          </Button>
          <Button size="sm" variant="outline" disabled={acting} onClick={onSkip}>
            <BiX className="mr-1" /> 跳过
          </Button>
          <Button size="sm" variant="destructive" disabled={blacklisting} onClick={onBlacklist}>
            <BiBlock className="mr-1" /> {blacklisting ? "加入中..." : "加入黑名单"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function AnalysisContent({ showHeader = false, refreshSignal = 0 }: { showHeader?: boolean; refreshSignal?: number }) {
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [dashboardStats, setDashboardStats] = useState<StatsResponse | null>(null)
  const [loadingDashboardStats, setLoadingDashboardStats] = useState(true)

  const [items, setItems] = useState<BossJob[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  // 分页输入（页码与每页条数），便于自定义跳转与控制
  const [inputPage, setInputPage] = useState<number | string>(1)
  const [inputSize, setInputSize] = useState<number | string>(20)

  const [filters, setFilters] = useState<FilterState>(DEFAULT_PENDING_FILTERS)
  const [draftFilters, setDraftFilters] = useState<FilterState>(DEFAULT_PENDING_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [pendingCardsExpanded, setPendingCardsExpanded] = useState(false)
  const [showDetailColumns, setShowDetailColumns] = useState(false)
  const [loadingList, setLoadingList] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [clearingAnalysis, setClearingAnalysis] = useState(false)

  // 查看全文弹窗
  const [showTextDialog, setShowTextDialog] = useState(false)
  const [textDialogTitle, setTextDialogTitle] = useState<string>("")
  const [textDialogContent, setTextDialogContent] = useState<string>("")
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const [actingJobId, setActingJobId] = useState<number | null>(null)
  const [blacklistingJobId, setBlacklistingJobId] = useState<number | null>(null)
  const [actingBatch, setActingBatch] = useState(false)
  const [actingAiBatch, setActingAiBatch] = useState(false)
  const activeScanRunId = useMemo(() => items.find((item) => item.scanRunId)?.scanRunId || "", [items])

  const openTextDialog = (title: string, content?: string) => {
    setTextDialogTitle(title)
    setTextDialogContent(content || "")
    setShowTextDialog(true)
  }

  const selectDialogText = () => {
    const el = textAreaRef.current
    if (el) el.select()
  }

  const copyDialogText = async () => {
    try {
      await navigator.clipboard.writeText(textDialogContent || "")
      alert("已复制到剪贴板")
    } catch {
      try {
        const ta = document.createElement("textarea")
        ta.value = textDialogContent || ""
        document.body.appendChild(ta)
        ta.select()
        document.execCommand("copy")
        document.body.removeChild(ta)
        alert("已复制到剪贴板")
      } catch {
        alert("复制失败，请手动选中复制")
      }
    }
  }

  // 当实际页码/每页条数变化时，同步到输入框
  useEffect(() => {
    setInputPage(page)
  }, [page])
  useEffect(() => {
    setInputSize(size)
  }, [size])

  // 仅显示日期（YYYY-MM-DD）
  const formatDateOnly = (s?: string) => {
    if (!s) return ""
    const d = new Date(s)
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, "0")
      const day = String(d.getDate()).padStart(2, "0")
      return `${y}-${m}-${day}`
    }
    // 非标准时间串，兜底截取前10位
    return s.slice(0, 10)
  }

  const buildFilterParams = (source: FilterState = filters) => {
    const params = new URLSearchParams()
    if (source.statuses.length) params.set("statuses", source.statuses.join(","))
    if (source.location.trim()) params.set("location", source.location.trim())
    if (source.experience) params.set("experience", source.experience)
    if (source.degree) params.set("degree", source.degree)
    if (source.minK) params.set("minK", String(Number(source.minK)))
    if (source.maxK) params.set("maxK", String(Number(source.maxK)))
    if (source.keyword.trim()) params.set("keyword", source.keyword.trim())
    if (source.filterHeadhunter) params.set("filterHeadhunter", "true")
    if (activeScanRunId) params.set("scanRunId", activeScanRunId)
    return params
  }

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filters.statuses.length) count += 1
    if (filters.location.trim()) count += 1
    if (filters.experience) count += 1
    if (filters.degree) count += 1
    if (filters.minK || filters.maxK) count += 1
    if (filters.keyword.trim()) count += 1
    if (filters.filterHeadhunter) count += 1
    return count
  }, [filters])

  const toggleDraftStatus = (status: string) => {
    setDraftFilters((prev) => {
      const exists = prev.statuses.includes(status)
      return {
        ...prev,
        statuses: exists ? prev.statuses.filter((item) => item !== status) : [...prev.statuses, status],
      }
    })
  }

  const applyFilters = () => {
    setFilters(draftFilters)
  }

  const resetFilters = () => {
    setDraftFilters(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
  }

  const resetToPendingFilters = () => {
    setDraftFilters(DEFAULT_PENDING_FILTERS)
    setFilters(DEFAULT_PENDING_FILTERS)
  }

  const pendingJobs = useMemo(() => (
    items.filter((item) => item.deliveryStatus === "待确认")
  ), [items])
  const visiblePendingJobs = useMemo(() => (
    pendingCardsExpanded ? pendingJobs : pendingJobs.slice(0, 2)
  ), [pendingCardsExpanded, pendingJobs])

  const riskTextOf = (job: BossJob) => {
    const reason = (job.aiReason || "").trim()
    if (reason) return reason
    if (!job.jobUrl) return "缺少原岗位链接，确认前建议核对岗位来源。"
    if (!job.aiScore && job.aiScore !== 0) return "暂无AI分数，确认前建议人工复核。"
    return "暂无明显风险点。"
  }

  const handleBlacklistCompany = async (job: BossJob) => {
    const value = (job.companyName || "").trim()
    if (!value) {
      openTextDialog("加入黑名单", "该岗位缺少公司名称，无法加入公司黑名单。")
      return
    }
    try {
      setBlacklistingJobId(job.id)
      const res = await fetch(`${API_BASE}/api/boss/config/blacklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "company", value }),
      })
      if (!res.ok) throw new Error("加入黑名单失败")
      openTextDialog("加入黑名单", `${value} 已加入公司黑名单。`)
    } catch (error) {
      openTextDialog("加入黑名单", error instanceof Error ? error.message : "加入黑名单失败：网络或服务异常。")
    } finally {
      setBlacklistingJobId(null)
    }
  }

  const loadList = async (toPage = page, toSize = size) => {
    const params = buildFilterParams()
    params.set("page", String(toPage))
    params.set("size", String(toSize))

    try {
      setLoadingList(true)
      const res = await fetch(`${API_BASE}/api/boss/list?${params.toString()}`)
      const data: PagedResult = await res.json()
      // 前端兜底过滤猎头（避免后端未更新导致的显示异常）
      const filteredItems = (data.items || []).filter(it => {
        if (!filters.filterHeadhunter) return true
        const hp = (it.hrPosition || "").toLowerCase()
        return !(hp.includes("猎头") || hp.includes("獵頭"))
      })
      setItems(filteredItems)
      setTotal(data.total || 0)
      setPage(data.page || toPage)
      setSize(data.size || toSize)
    } catch (e) {
      console.error("fetch list failed", e)
    } finally {
      setLoadingList(false)
    }
  }

  // 统计图加载：与列表共享相同筛选条件
  const loadStats = async () => {
    const params = buildFilterParams()

    try {
      const res = await fetch(`${API_BASE}/api/boss/stats?${params.toString()}`)
      const data: StatsResponse = await res.json()
      setStats(data)
    } catch (e) {
      console.error("fetch stats failed", e)
    }
  }

  const loadDashboardStats = async () => {
    try {
      setLoadingDashboardStats(true)
      const params = new URLSearchParams()
      if (activeScanRunId) params.set("scanRunId", activeScanRunId)
      const res = await fetch(`${API_BASE}/api/boss/stats?${params.toString()}`)
      const data: StatsResponse = await res.json()
      setDashboardStats(data)
    } catch (e) {
      console.error("fetch dashboard stats failed", e)
    } finally {
      setLoadingDashboardStats(false)
    }
  }

  useEffect(() => {
    loadList(1, size)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!refreshSignal) return
    loadList(1, size)
    loadStats()
    loadDashboardStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal])

  useEffect(() => {
    loadList(1, size)
    loadStats()
    loadDashboardStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const onReload = async () => {
    try {
      setReloading(true)
      const res = await fetch(`${API_BASE}/api/boss/reload`)
      const data = await res.json()
      console.log("reload", data)
      await loadList(1, size)
      await loadStats()
      await loadDashboardStats()
    } catch (e) {
      console.error("reload failed", e)
    } finally {
      setReloading(false)
    }
  }

  const clearAnalysisData = async () => {
    const ok = window.confirm("确认清空 Boss 投递分析数据？这会删除当前岗位列表、统计图和历史AI分析结果，适合切换人物或简历前使用。")
    if (!ok) return
    try {
      setClearingAnalysis(true)
      const res = await fetch(`${API_BASE}/api/boss/analysis`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.success === false) {
        throw new Error(data.message || "清空失败")
      }
      setItems([])
      setTotal(0)
      setPage(1)
      setInputPage(1)
      setStats(null)
      setDashboardStats(null)
      await loadList(1, size)
      await loadStats()
      await loadDashboardStats()
      openTextDialog("清空投递分析", data.message || "Boss投递分析数据已清空。")
    } catch (error) {
      openTextDialog("清空投递分析", error instanceof Error ? error.message : "清空失败：网络或服务异常。")
    } finally {
      setClearingAnalysis(false)
    }
  }

  const exportCSV = async () => {
    try {
      setExporting(true)
      // 组装当前筛选条件
      const baseParams = buildFilterParams()

      // 分页抓取，直到获取全部数据
      const pageSize = 1000
      let currentPage = 1
      let all: BossJob[] = []
      let totalCount = 0

      while (true) {
        const params = new URLSearchParams(baseParams)
        params.set("page", String(currentPage))
        params.set("size", String(pageSize))
        const res = await fetch(`${API_BASE}/api/boss/list?${params.toString()}`)
        const data: PagedResult = await res.json()
        let chunk = data.items || []
        // 导出也做兜底过滤，确保CSV不含猎头岗位
        if (filters.filterHeadhunter) {
          chunk = chunk.filter(it => {
            const hp = (it.hrPosition || "").toLowerCase()
            return !(hp.includes("猎头") || hp.includes("獵頭"))
          })
        }
        if (currentPage === 1) totalCount = data.total || chunk.length
        all = all.concat(chunk)
        if (all.length >= totalCount || chunk.length === 0) break
        currentPage += 1
      }

      const header = [
        "公司名称",
        "岗位名称",
        "薪资",
        "工作地点",
        "经验",
        "学历",
        "HR",
        "投递状态",
        "失败类型",
        "失败原因",
        "AI分",
        "AI决策",
        "AI原因",
        "优先公司",
        "链接",
        "创建时间",
      ]
      const rows = all.map((it) => [
        it.companyName || "",
        it.jobName || "",
        it.salary || "",
        it.location || "",
        it.experience || "",
        it.degree || "",
        it.hrName || "",
        it.deliveryStatus || "",
        it.deliveryStatus === "投递失败" ? failureTypeLabel(it.failureType) : "",
        it.deliveryStatus === "投递失败" ? (it.failureReason || "") : "",
        it.aiScore ?? "",
        it.aiDecision || "",
        it.aiReason || "",
        it.priorityCompany ? "是" : "",
        it.jobUrl || "",
        it.createdAt || "",
      ])
      const csv = [header, ...rows]
        .map((r) => r.map((v) => (String(v).includes(",") ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(","))
        .join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `boss_jobs_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error("export CSV failed", e)
      alert("导出失败，请稍后重试")
    } finally {
      setExporting(false)
    }
  }

  const handleConfirmJob = async (job: BossJob) => {
    try {
      setActingJobId(job.id)
      const res = await fetch(`${API_BASE}/api/boss/jobs/${job.id}/confirm`, { method: "POST" })
      const data = await res.json()
      if (!data.success) {
        openTextDialog("确认投递", data.message || "该岗位暂不能投递。")
        return
      }
      const ok = window.confirm(`将通过 Chrome 真实联系 Boss HR：${job.companyName || ""} / ${job.jobName || ""}。确认继续？`)
      if (!ok) return
      const result = await sendChromeBridgeMessage({
        type: "BOSS_DELIVER_ONE",
        platform: "boss",
        task: data.task,
      }, 120000)
      openTextDialog("确认投递", result.message || (result.success ? "已发送投递请求。" : "Chrome投递失败。"))
      await loadList(page, size)
      await loadStats()
      await loadDashboardStats()
    } catch {
      openTextDialog("待确认发送", "确认失败：网络或服务异常。")
    } finally {
      setActingJobId(null)
    }
  }

  const currentBatchFilters = () => ({
    location: filters.location || undefined,
    experience: filters.experience || undefined,
    degree: filters.degree || undefined,
    minK: filters.minK ? Number(filters.minK) : undefined,
    maxK: filters.maxK ? Number(filters.maxK) : undefined,
    keyword: filters.keyword || undefined,
    scanRunId: activeScanRunId || undefined,
    filterHeadhunter: filters.filterHeadhunter,
  })

  const handleConfirmBatch = async () => {
    try {
      setActingBatch(true)
      const res = await fetch(`${API_BASE}/api/boss/jobs/confirm-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentBatchFilters()),
      })
      const data = await res.json()
      const tasks = data.tasks || []
      if (!data.success || tasks.length === 0) {
        openTextDialog("批量投递", data.message || "当前筛选条件下没有待确认岗位。")
        return
      }
      const ok = window.confirm(`将通过 Chrome 真实联系 ${tasks.length} 个 Boss 待确认岗位。确认继续？`)
      if (!ok) return
      const result = await sendChromeBridgeMessage({
        type: "BOSS_DELIVER_BATCH",
        platform: "boss",
        tasks,
      }, Math.max(120000, tasks.length * 30000))
      openTextDialog("批量投递", result.message || "批量投递任务已结束。")
      await loadList(page, size)
      await loadStats()
      await loadDashboardStats()
    } catch {
      openTextDialog("批量投递", "批量投递失败：网络或服务异常。")
    } finally {
      setActingBatch(false)
    }
  }

  const handleConfirmAiRecommendedBatch = async () => {
    try {
      setActingAiBatch(true)
      const res = await fetch(`${API_BASE}/api/boss/jobs/confirm-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiRecommendedOnly: true, scanRunId: activeScanRunId || undefined }),
      })
      const data = await res.json()
      const tasks = data.tasks || []
      if (!data.success || tasks.length === 0) {
        openTextDialog("AI推荐一键投递", data.message || "当前没有 AI 推荐的待确认岗位。")
        return
      }
      const ok = window.confirm(`将通过 Chrome 真实联系 ${tasks.length} 个 Boss AI推荐待确认岗位。确认继续？`)
      if (!ok) return
      const result = await sendChromeBridgeMessage({
        type: "BOSS_DELIVER_BATCH",
        platform: "boss",
        tasks,
      }, Math.max(120000, tasks.length * 30000))
      openTextDialog("AI推荐一键投递", result.message || "AI推荐批量投递任务已结束。")
      await loadList(page, size)
      await loadStats()
      await loadDashboardStats()
    } catch {
      openTextDialog("AI推荐一键投递", "AI推荐批量投递失败：网络或服务异常。")
    } finally {
      setActingAiBatch(false)
    }
  }

  const handleSkipJob = async (job: BossJob) => {
    try {
      setActingJobId(job.id)
      const res = await fetch(`${API_BASE}/api/boss/jobs/${job.id}/skip`, { method: "POST" })
      const data = await res.json()
      if (!data.success) {
        openTextDialog("跳过岗位", data.message || "跳过失败。")
      }
      await loadList(page, size)
      await loadStats()
      await loadDashboardStats()
    } catch {
      openTextDialog("跳过岗位", "跳过失败：网络或服务异常。")
    } finally {
      setActingJobId(null)
    }
  }

  // 彩色标签样式（用于状态类字段）
  const badgeClass = (kind: "delivery" | "hr" | "recruitment", value?: string) => {
    const base = "px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap"
    const v = (value || "").trim()
    if (kind === "delivery") {
      if (v.includes("已投递")) return `${base} bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300`
      if (v.includes("待确认")) return `${base} bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300`
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
    // recruitment
    if (/暂停|关闭|下线|结束/.test(v)) return `${base} bg-gray-200 text-gray-800 dark:bg-gray-700/60 dark:text-gray-200`
    if (/急/.test(v)) return `${base} bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300`
    if (/招|招聘|中/.test(v)) return `${base} bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300`
    return `${base} bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-200`
  }

  const kpiCards = useMemo(() => {
    const k = dashboardStats?.kpi
    return [
      { title: "总岗位数", value: k?.total ?? 0 },
      { title: "已投递", value: k?.delivered ?? 0 },
      { title: "待确认", value: k?.waitingConfirm ?? 0 },
      { title: "采集不足", value: k?.insufficient ?? 0 },
      { title: "未投递", value: k?.pending ?? 0 },
      { title: "已过滤", value: k?.filtered ?? 0 },
      { title: "投递失败", value: k?.failed ?? 0 },
      { title: "平均月薪(K)", value: k?.avgMonthlyK ?? 0 },
    ]
  }, [dashboardStats])

  return (
    <div className="space-y-8">
      {showHeader && (
        <PageHeader
          title="Boss 投递分析"
          subtitle="基于 boss_data 表的统计图与列表分析"
          icon={<BiBarChart size={28} />}
          actions={
            <Button size="sm" variant="destructive" onClick={clearAnalysisData} disabled={clearingAnalysis}>
              <BiTrash className="mr-1" /> {clearingAnalysis ? "清空中..." : "清空分析"}
            </Button>
          }
        />
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
          {kpiCards.map((c, idx) => (
            <Card key={idx} className="border">
              <CardHeader>
                <CardTitle className="text-sm">{c.title}</CardTitle>
                <CardDescription className="text-xl font-semibold">{c.value}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>

        <OverviewPanel stats={dashboardStats} loading={loadingDashboardStats} />
      </div>

      {/* 列表 */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><BiBriefcase /> 岗位数据</CardTitle>
              <CardDescription>当前 Boss 岗位库明细</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="success" onClick={exportCSV} disabled={exporting}>
                <BiDownload className="mr-1" /> {exporting ? "导出中..." : "导出CSV"}
              </Button>
              <Button size="sm" variant="outline" onClick={onReload} disabled={reloading}>
                <BiRefresh className="mr-1" /> 刷新数据
              </Button>
              <Button size="sm" variant="destructive" onClick={clearAnalysisData} disabled={clearingAnalysis}>
                <BiTrash className="mr-1" /> {clearingAnalysis ? "清空中..." : "清空分析"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowDetailColumns((value) => !value)}>
                {showDetailColumns ? <BiChevronUp className="mr-1" /> : <BiChevronDown className="mr-1" />}
                {showDetailColumns ? "收起详情列" : "展开详情列"}
              </Button>
              <Button size="sm" variant="success" onClick={handleConfirmAiRecommendedBatch} disabled={actingAiBatch || actingBatch}>
                <BiBriefcase className="mr-1" /> {actingAiBatch ? "投递中..." : "一键投递AI推荐待确认"}
              </Button>
              <Button size="sm" variant="destructive" onClick={handleConfirmBatch} disabled={actingBatch || actingAiBatch}>
                <BiBriefcase className="mr-1" /> {actingBatch ? "投递中..." : "投递当前待确认"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/30">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                className="inline-flex items-center gap-2 text-sm font-semibold text-foreground"
                onClick={() => setFiltersOpen((open) => !open)}
              >
                <BiFilterAlt />
                表头筛选
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{activeFilterCount}</span>
                )}
                {filtersOpen ? <BiChevronUp /> : <BiChevronDown />}
              </button>
              <div className="text-xs text-muted-foreground">
                当前显示 {items.length} 条，本页/总数 {total} 条
              </div>
            </div>

            {filtersOpen && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <div className="xl:col-span-2">
                    <Label className="text-xs">关键词</Label>
                    <div className="relative mt-1">
                      <BiSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={draftFilters.keyword}
                        onChange={(e) => setDraftFilters((prev) => ({ ...prev, keyword: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") applyFilters()
                        }}
                        placeholder="公司 / 岗位 / HR"
                        className="h-9 pl-9"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">地点</Label>
                    <Input
                      value={draftFilters.location}
                      onChange={(e) => setDraftFilters((prev) => ({ ...prev, location: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applyFilters()
                      }}
                      placeholder="如 深圳"
                      className="mt-1 h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">经验</Label>
                    <Select
                      value={draftFilters.experience}
                      onChange={(e) => setDraftFilters((prev) => ({ ...prev, experience: e.target.value }))}
                      className="mt-1 h-9 rounded-md bg-background"
                    >
                      <option value="">全部</option>
                      {EXPERIENCE_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">学历</Label>
                    <Select
                      value={draftFilters.degree}
                      onChange={(e) => setDraftFilters((prev) => ({ ...prev, degree: e.target.value }))}
                      className="mt-1 h-9 rounded-md bg-background"
                    >
                      <option value="">全部</option>
                      {DEGREE_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">月薪(K)</Label>
                    <div className="mt-1 flex gap-2">
                      <Input
                        type="number"
                        value={draftFilters.minK}
                        onChange={(e) => setDraftFilters((prev) => ({ ...prev, minK: e.target.value }))}
                        placeholder="最低"
                        className="h-9"
                      />
                      <Input
                        type="number"
                        value={draftFilters.maxK}
                        onChange={(e) => setDraftFilters((prev) => ({ ...prev, maxK: e.target.value }))}
                        placeholder="最高"
                        className="h-9"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-xs text-muted-foreground">投递状态</span>
                  {DELIVERY_STATUS_OPTIONS.map((status) => {
                    const active = draftFilters.statuses.includes(status)
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => toggleDraftStatus(status)}
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-slate-300 bg-background text-foreground hover:border-primary/60 dark:border-slate-700"
                        }`}
                      >
                        {status}
                      </button>
                    )
                  })}
                  <label className="ml-0 inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-300 bg-background px-3 py-1 text-xs dark:border-slate-700 md:ml-2">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={draftFilters.filterHeadhunter}
                      onChange={(e) => setDraftFilters((prev) => ({ ...prev, filterHeadhunter: e.target.checked }))}
                    />
                    过滤猎头
                  </label>
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" onClick={resetFilters}>
                      <BiX className="mr-1" /> 清空
                    </Button>
                    <Button size="sm" onClick={applyFilters}>
                      <BiFilterAlt className="mr-1" /> 应用筛选
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mb-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <BiCheckCircle className="text-cyan-600" />
                  待确认岗位卡片
                </div>
                <div className="mt-1 text-xs text-muted-foreground">优先处理待确认投递，确认前可查看原岗位、跳过或加入公司黑名单。</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {pendingJobs.length > 2 && (
                  <Button size="sm" variant="outline" onClick={() => setPendingCardsExpanded((expanded) => !expanded)}>
                    {pendingCardsExpanded ? <BiChevronUp className="mr-1" /> : <BiChevronDown className="mr-1" />}
                    {pendingCardsExpanded ? "收起，只留 2 个" : `展开全部 ${pendingJobs.length} 个`}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={resetToPendingFilters}>
                  <BiFilterAlt className="mr-1" /> 只看待确认
                </Button>
                <Button size="sm" variant="success" onClick={handleConfirmAiRecommendedBatch} disabled={actingAiBatch || actingBatch}>
                  <BiBriefcase className="mr-1" /> {actingAiBatch ? "投递中..." : "一键投递AI推荐"}
                </Button>
              </div>
            </div>

            {loadingList && items.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">待确认岗位加载中...</div>
            ) : pendingJobs.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                当前筛选下没有待确认岗位。
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {visiblePendingJobs.map((job) => (
                  <PendingJobCard
                    key={job.id}
                    job={job}
                    acting={actingJobId === job.id}
                    blacklisting={blacklistingJobId === job.id}
                    riskText={riskTextOf(job)}
                    onOpenText={openTextDialog}
                    onConfirm={() => handleConfirmJob(job)}
                    onSkip={() => handleSkipJob(job)}
                    onBlacklist={() => handleBlacklistCompany(job)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="w-full overflow-x-auto rounded-lg border border-stroke/30 dark:border-strokedark/30 shadow-sm">
            <table className={`${showDetailColumns ? "min-w-[1920px]" : "min-w-[1320px]"} w-full table-fixed bg-white dark:bg-blacksection`}>
              <thead>
                <tr className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-b-2 border-blue-200 dark:border-blue-800">
                  <th className={`${showDetailColumns ? "w-[80px]" : "w-[86px]"} px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700`}>操作</th>
                  <th className={`${showDetailColumns ? "w-[140px]" : "w-[180px]"} px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700`}>公司名称</th>
                  <th className={`${showDetailColumns ? "w-[170px]" : "w-[220px]"} px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700`}>岗位名称</th>
                  <th className="w-[110px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">薪资</th>
                  <th className="w-[94px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">地点</th>
                  <th className="w-[96px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">经验</th>
                  <th className="w-[76px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">学历</th>
                  <th className="w-[120px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">HR</th>
                  <th className="w-[136px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">投递状态</th>
                  <th className={`${showDetailColumns ? "w-[170px]" : "w-[210px]"} px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700`}>失败原因</th>
                  <th className="w-[70px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">AI分</th>
                  <th className="w-[120px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">AI决策</th>
                  <th className={`${showDetailColumns ? "w-[160px]" : "w-[230px]"} px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700`}>AI原因</th>
                  <th className="w-[86px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">优先</th>
                  <th className="w-[120px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">招聘状态</th>
                  <th className="w-[78px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">链接</th>
                  {showDetailColumns && (
                    <>
                      <th className="w-[180px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">公司地址</th>
                      <th className="w-[110px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">行业</th>
                      <th className="w-[110px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">公司规模</th>
                      <th className="w-[110px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">融资阶段</th>
                      <th className="w-[180px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">公司介绍</th>
                      <th className="w-[180px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">岗位描述</th>
                    </>
                  )}
                  <th className="w-[120px] px-3 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={showDetailColumns ? 23 : 17} className="px-4 py-12 text-center text-muted-foreground bg-gray-50 dark:bg-gray-900/20">
                      <div className="flex flex-col items-center gap-3">
                        <BiBriefcase className="text-4xl text-gray-300 dark:text-gray-600" />
                        <p className="text-sm">当前还没有入库岗位；请查看 Boss 页进度日志里的采集数量、详情缺失和提交结果。</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  items.map((it, idx) => (
                    <tr
                      key={it.id}
                      className={`group transition-colors border-b last:border-b-0 ${
                        (it.deliveryStatus || "").includes("已投递")
                          ? "border-emerald-200 bg-emerald-50/80 hover:bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30"
                          : `border-gray-200 dark:border-gray-700 ${
                              idx % 2 === 0
                                ? "bg-white dark:bg-blacksection hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
                                : "bg-gray-50/50 dark:bg-gray-900/20 hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
                            }`
                      }`}
                    >
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                        {it.deliveryStatus === "待确认" ? (
                          <div className="flex flex-col gap-2">
                            <Button size="sm" disabled={actingJobId === it.id} onClick={() => handleConfirmJob(it)} className="h-7 w-full rounded px-2 text-xs leading-none">
                              发送
                            </Button>
                            <Button size="sm" variant="outline" disabled={actingJobId === it.id} onClick={() => handleSkipJob(it)} className="h-7 w-full rounded px-2 text-xs leading-none">
                              跳过
                            </Button>
                          </div>
                        ) : (it.deliveryStatus || "").includes("已投递") ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                            <BiCheckCircle className="h-3.5 w-3.5" />
                            已投递
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                        <div className="truncate cursor-pointer hover:text-primary transition-colors" title={it.companyName || '-'} onClick={() => openTextDialog("公司名称", it.companyName)}>{it.companyName || '-'}</div>
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                        <div className="truncate cursor-pointer hover:text-primary transition-colors" title={it.jobName || '-'} onClick={() => openTextDialog("岗位名称", it.jobName)}>{it.jobName || '-'}</div>
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                        <div className="truncate cursor-pointer hover:text-primary transition-colors" title={it.salary || '-'} onClick={() => openTextDialog("薪资", it.salary)}>{it.salary || '-'}</div>
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                        <div className="truncate cursor-pointer hover:text-primary transition-colors" title={it.location || '-'} onClick={() => openTextDialog("地点", it.location)}>{it.location || '-'}</div>
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                        <div className="truncate cursor-pointer hover:text-primary transition-colors" title={it.experience || '-'} onClick={() => openTextDialog("经验", it.experience)}>{it.experience || '-'}</div>
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                        <div className="truncate cursor-pointer hover:text-primary transition-colors" title={it.degree || '-'} onClick={() => openTextDialog("学历", it.degree)}>{it.degree || '-'}</div>
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                        <div className="truncate cursor-pointer hover:text-primary transition-colors" title={it.hrName || '-'} onClick={() => openTextDialog("HR", it.hrName)}>{it.hrName || '-'}</div>
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                        <button className={badgeClass("delivery", it.deliveryStatus)} title={it.deliveryStatus} onClick={() => openTextDialog("投递状态", it.deliveryStatus)}>
                          {(it.deliveryStatus || "").includes("已投递") ? (
                            <span className="inline-flex items-center gap-1">
                              <BiCheckCircle className="h-3.5 w-3.5" />
                              已投递
                            </span>
                          ) : (
                            it.deliveryStatus || "-"
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                        <div className="line-clamp-2 cursor-pointer hover:text-primary transition-colors" title={failureReasonText(it)} onClick={() => openTextDialog("失败原因", failureReasonText(it))}>{failureReasonText(it)}</div>
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                        {it.aiScore ?? "-"}
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                        <button className={badgeClass("delivery", it.aiDecision)} title={it.aiDecision} onClick={() => openTextDialog("AI决策", it.aiDecision)}>{it.aiDecision || "-"}</button>
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                        <div className="line-clamp-2 cursor-pointer hover:text-primary transition-colors" title={it.aiReason || '-'} onClick={() => openTextDialog("AI原因", it.aiReason)}>{it.aiReason || '-'}</div>
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                        {it.priorityCompany ? "是" : "-"}
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                        <button className={badgeClass("recruitment", it.recruitmentStatus)} title={it.recruitmentStatus} onClick={() => openTextDialog("招聘状态", it.recruitmentStatus)}>{it.recruitmentStatus || "-"}</button>
                      </td>
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                        {it.jobUrl ? (
                          <a href={it.jobUrl} className="inline-flex items-center gap-1 text-primary underline hover:text-primary/80 transition-colors" target="_blank" rel="noreferrer">链接 <BiLinkExternal /></a>
                        ) : (
                          "-"
                        )}
                      </td>
                      {showDetailColumns && (
                        <>
                          <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                            <div className="truncate cursor-pointer hover:text-primary transition-colors" title={it.companyAddress || '-'} onClick={() => openTextDialog("公司地址", it.companyAddress)}>{it.companyAddress || '-'}</div>
                          </td>
                          <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                            <div className="truncate cursor-pointer hover:text-primary transition-colors" title={it.industry || '-'} onClick={() => openTextDialog("行业", it.industry)}>{it.industry || '-'}</div>
                          </td>
                          <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                            <div className="truncate cursor-pointer hover:text-primary transition-colors" title={it.companyScale || '-'} onClick={() => openTextDialog("公司规模", it.companyScale)}>{it.companyScale || '-'}</div>
                          </td>
                          <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                            <div className="truncate cursor-pointer hover:text-primary transition-colors" title={it.financingStage || '-'} onClick={() => openTextDialog("融资阶段", it.financingStage)}>{it.financingStage || '-'}</div>
                          </td>
                          <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                            <div className="truncate cursor-pointer hover:text-primary transition-colors" title={it.introduce || '-'} onClick={() => openTextDialog("公司介绍", it.introduce)}>{it.introduce || '-'}</div>
                          </td>
                          <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                            <div className="line-clamp-2 cursor-pointer hover:text-primary transition-colors" title={it.jobDescription || '-'} onClick={() => openTextDialog("岗位描述", it.jobDescription)}>{it.jobDescription || '-'}</div>
                          </td>
                        </>
                      )}
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top">
                        <div className="truncate cursor-pointer hover:text-primary transition-colors" title={formatDateOnly(it.createdAt) || '-'} onClick={() => openTextDialog("创建时间", formatDateOnly(it.createdAt))}>{formatDateOnly(it.createdAt) || '-'}</div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button variant="outline" onClick={() => loadList(Math.max(1, page - 1), size)} disabled={loadingList || page <= 1}>上一页</Button>
            <div className="text-sm">第 {page} 页 / 共 {Math.max(1, Math.ceil(total / size))} 页</div>
            <Button variant="outline" onClick={() => loadList(page + 1, size)} disabled={loadingList || page >= Math.ceil(total / size)}>下一页</Button>
            {/* 自定义页码与每页条数 */}
            <div className="flex items-center gap-2 ml-4">
              <Label className="text-sm">页码</Label>
              <Input
                type="number"
                value={inputPage}
                onChange={(e) => setInputPage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const toPage = Math.max(1, Number(inputPage) || 1)
                    loadList(toPage, size)
                  }
                }}
                className="h-8 w-20"
              />
              <Label className="text-sm">每页</Label>
              <Select
                value={String(inputSize)}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setInputSize(v)
                  loadList(1, Math.max(1, v))
                }}
                className="h-8 w-28"
              >
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </Select>
              <span className="text-sm text-muted-foreground">条</span>
            </div>
            <div className="ml-auto text-sm text-muted-foreground">共 {total} 条</div>
          </div>
      </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><BiBarChart /> 统计分析</CardTitle>
            <CardDescription>岗位库概览和图表保留在下方，默认收起，不影响待确认投递。</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAnalyticsOpen((open) => !open)}>
            {analyticsOpen ? <BiChevronUp className="mr-1" /> : <BiChevronDown className="mr-1" />}
            {analyticsOpen ? "收起统计" : "展开统计"}
          </Button>
        </CardHeader>
        {analyticsOpen && (
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base flex items-center gap-2"><BiPieChart /> 投递状态分布</CardTitle>
                  <CardDescription>已投递/未投递/已过滤/失败等占比</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {stats ? (
                    <ChartCanvas
                      type="pie"
                      labels={stats.charts.byStatus.map((x) => x.name)}
                      data={stats.charts.byStatus.map((x) => x.value)}
                    />
                  ) : (
                    <div className="h-44 md:h-48 flex items-center justify-center border-2 border-dashed rounded-lg text-muted-foreground">
                      加载中...
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base flex items-center gap-2"><BiPieChart /> 失败类型统计</CardTitle>
                  <CardDescription>按 failure_type 聚合投递失败原因</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {stats ? (
                    <ChartCanvas
                      type="pie"
                      labels={(stats.charts.byFailureType || []).map((x) => failureTypeLabel(x.name))}
                      data={(stats.charts.byFailureType || []).map((x) => x.value)}
                    />
                  ) : (
                    <div className="h-44 md:h-48 flex items-center justify-center border-2 border-dashed rounded-lg text-muted-foreground">
                      加载中...
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base flex items-center gap-2"><BiBarChart /> 行业TOP10</CardTitle>
                  <CardDescription>岗位按行业聚合</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {stats ? (
                    <ChartCanvas
                      type="bar"
                      labels={stats.charts.byIndustry.map((x) => x.name)}
                      data={stats.charts.byIndustry.map((x) => x.value)}
                      colors={CATEGORY_COLORS}
                    />
                  ) : (
                    <div className="h-44 md:h-48 flex items-center justify-center border-2 border-dashed rounded-lg text-muted-foreground">加载中...</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base flex items-center gap-2"><BiBarChart /> 公司岗位数TOP10</CardTitle>
                  <CardDescription>按公司名称聚合</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {stats ? (
                    <ChartCanvas type="bar" labels={stats.charts.byCompany.map((x) => x.name)} data={stats.charts.byCompany.map((x) => x.value)} colors={CATEGORY_COLORS} />
                  ) : (
                    <div className="h-44 md:h-48 flex items-center justify-center border-2 border-dashed rounded-lg text-muted-foreground">加载中...</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base flex items-center gap-2"><BiBarChart /> 经验分布</CardTitle>
                  <CardDescription>不同经验要求的岗位数</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {stats ? (
                    <ChartCanvas type="bar" labels={stats.charts.byExperience.map((x) => x.name)} data={stats.charts.byExperience.map((x) => x.value)} colors={CATEGORY_COLORS} />
                  ) : (
                    <div className="h-44 md:h-48 flex items-center justify-center border-2 border-dashed rounded-lg text-muted-foreground">加载中...</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base flex items-center gap-2"><BiBarChart /> 学历分布</CardTitle>
                  <CardDescription>不同学历要求的岗位数</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {stats ? (
                    <ChartCanvas type="bar" labels={stats.charts.byDegree.map((x) => x.name)} data={stats.charts.byDegree.map((x) => x.value)} colors={CATEGORY_COLORS} />
                  ) : (
                    <div className="h-44 md:h-48 flex items-center justify-center border-2 border-dashed rounded-lg text-muted-foreground">加载中...</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base flex items-center gap-2"><BiLineChart /> 薪资区间分布</CardTitle>
                  <CardDescription>基于中位数K的桶聚合</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {stats ? (
                    <ChartCanvas type="line" labels={stats.charts.salaryBuckets.map((x) => x.bucket)} data={stats.charts.salaryBuckets.map((x) => x.value)} color="#ef4444" />
                  ) : (
                    <div className="h-44 md:h-48 flex items-center justify-center border-2 border-dashed rounded-lg text-muted-foreground">加载中...</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 查看全文弹框 */}
      {showTextDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-[92%] max-w-3xl border border-gray-200 dark:border-neutral-800 animate-in fade-in zoom-in-95">
            <Card className="border-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">{textDialogTitle}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <textarea
                  ref={textAreaRef}
                  readOnly
                  value={textDialogContent || ''}
                  className="w-full h-[50vh] text-sm leading-6 rounded-md border p-2 bg-muted/30 dark:bg-neutral-800"
                />
                <div className="flex justify-end gap-2 mt-4">
                  <Button variant="outline" onClick={selectDialogText} className="rounded-lg px-4">全选</Button>
                  <Button variant="success" onClick={copyDialogText} className="rounded-lg px-4">复制</Button>
                  <Button onClick={() => setShowTextDialog(false)} className="rounded-lg px-4">关闭</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
