"use client"

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  Title,
  Tooltip,
} from "chart.js"
import type { ChartDataset } from "chart.js"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import PageHeader from "@/app/components/PageHeader"
import { API_BASE } from "@/lib/api"
import { sendChromeBridgeMessage } from "@/lib/chromeBridge"
import {
  BiRefresh,
  BiDownload,
  BiBarChart,
  BiLineChart,
  BiBriefcase,
  BiTrash,
  BiCheckCircle,
  BiChevronDown,
  BiChevronUp,
  BiLinkExternal,
} from "react-icons/bi"
import { parseSalary } from "@/lib/salary"

type NameValue = { name: string; value: number }
type BucketValue = { bucket: string; value: number }
type SalaryBucketLike = BucketValue | { bucket?: string; name?: string; value: number }

type StatsResponse = {
  kpi: {
	    total: number
	    delivered: number
	    waitingConfirm?: number
	    pending: number
    filtered: number
    failed: number
    avgMonthlyK?: number | null
  }
  charts: {
    byStatus: NameValue[]
    byCity: NameValue[]
    byCompany: NameValue[]
    byExperience: NameValue[]
    byDegree: NameValue[]
    salaryBuckets: BucketValue[]
    dailyTrend?: NameValue[]
    byFailureType?: NameValue[]
  }
}

type ZhilianJob = {
  id?: number
  jobId: string
  companyName?: string
  jobTitle?: string
  salary?: string
  location?: string
  experience?: string
  degree?: string
  deliveryStatus?: string
  failureType?: string
  failureReason?: string
  jobLink?: string
  jobDescription?: string
  aiScore?: number
  aiDecision?: string
  aiReason?: string
  priorityCompany?: number
  scanRunId?: string
  createTime?: string
}

type PagedResult = {
  items: ZhilianJob[]
  total: number
  page: number
  size: number
}

type ChartRef = { destroy: () => void }

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

Chart.register(
  PieController,
  BarController,
  LineController,
  ArcElement,
  BarElement,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  Title
)
const FAILURE_TYPE_LABELS: Record<string, string> = {
  LOGIN_EXPIRED: "登录失效",
  PLATFORM_VERIFICATION: "平台验证",
  JOB_CLOSED: "岗位关闭",
  BUTTON_UNCLICKABLE: "按钮不可点击",
  ALREADY_DELIVERED: "已投递过",
  NETWORK_ERROR: "网络异常",
  UNKNOWN_ERROR: "未知错误",
}

function failureTypeLabel(type?: string) {
  const key = (type || "UNKNOWN_ERROR").trim()
  return FAILURE_TYPE_LABELS[key] || key || "未知错误"
}

function failureReasonText(job: ZhilianJob) {
  if (job.deliveryStatus !== "投递失败") return "-"
  const reason = job.failureReason?.trim()
  const type = failureTypeLabel(job.failureType)
  return reason ? `${type}：${reason}` : type
}

function salaryBucketLabel(x: SalaryBucketLike): string {
  return "bucket" in x && x.bucket ? x.bucket : "name" in x && x.name ? x.name : ""
}

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
  const toSolid = (hex: string) => hex

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return

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
        return colors.slice(0, data.length).map((c) => toSolid(c))
      }
      return toSolid(color ?? "#3b82f6")
    })()

    const borderColor = (() => {
      if (type === "pie") return undefined
      if (type === "bar" && colors && colors.length) return colors.slice(0, data.length)
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
      data: { labels, datasets: [dataset] },
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

  return <canvas ref={canvasRef} className="w-full h-64" />
}

function formatDateOnly(s?: string) {
  if (!s) return ""
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  } catch {
    return s
  }
}

function badgeClass(type: "status" | "delivery", text?: string) {
  const base = "px-2 py-0.5 rounded text-xs"
  if (type === "delivery") {
	    if (!text || text === "未投递") return `${base} bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200`
	    if (text === "待确认") return `${base} bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200`
	    if (text === "AI分析中") return `${base} bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200`
	    if (text === "已投递") return `${base} bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200`
    if (text === "已过滤") return `${base} bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-200`
    if (text === "投递失败") return `${base} bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200`
    return `${base} bg-gray-100 text-gray-800`
  }
  return base
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

function topName(items?: NameValue[]) {
  return items && items.length > 0 ? items[0].name || "暂无数据" : "暂无数据"
}

function OverviewPanel({
  stats,
  items,
  loading,
}: {
  stats: StatsResponse | null
  items: ZhilianJob[]
  loading: boolean
}) {
  const k = stats?.kpi
  const statusCount = (name: string) => stats?.charts.byStatus.find((item) => item.name === name)?.value ?? 0
  const total = k?.total ?? 0
  const delivered = k?.delivered ?? 0
  const waitingConfirm = k?.waitingConfirm ?? 0
  const filtered = k?.filtered ?? 0
  const failed = k?.failed ?? 0
  const skipped = statusCount("已跳过")
  const insufficient = statusCount("采集信息不足")
  const remainder = Math.max(0, total - delivered - waitingConfirm - filtered - failed - skipped - insufficient)
  const segments = [
    { label: "已投递", value: delivered, className: "bg-emerald-500" },
    { label: "待确认", value: waitingConfirm, className: "bg-cyan-500" },
    { label: "采集不足", value: insufficient, className: "bg-orange-500" },
    { label: "已过滤", value: filtered, className: "bg-pink-500" },
    { label: "失败/跳过", value: failed + skipped, className: "bg-amber-500" },
    { label: "其他", value: remainder, className: "bg-slate-400" },
  ].filter((segment) => segment.value > 0)
  const scoredItems = items.filter((item) => item.aiScore || item.aiScore === 0)
  const aiAvgScore = scoredItems.length
    ? Math.round((scoredItems.reduce((sum, item) => sum + (item.aiScore || 0), 0) / scoredItems.length) * 10) / 10
    : "暂无数据"
  const aiRejectCount = statusCount("AI不匹配")
  const aiFailedCount = statusCount("AI分析失败")
  const priorityCompanyCount = items.filter((item) => item.priorityCompany).length
  const missingLinkCount = items.filter((item) => !item.jobLink?.trim()).length
  const missingSalaryCount = items.filter((item) => !item.salary?.trim()).length
  const latestCreatedAt = items[0]?.createTime ? formatDateOnly(items[0].createTime) : "暂无数据"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><BiBarChart /> 数据总览</CardTitle>
        <CardDescription>基于当前智联岗位库生成的投递进度、AI 判断、岗位画像与数据质量概况</CardDescription>
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
                <OverviewMetric label="平均AI分" value={aiAvgScore} />
                <OverviewMetric label="AI通过" value={waitingConfirm + delivered} />
                <OverviewMetric label="AI不匹配" value={aiRejectCount} />
                <OverviewMetric label="优先公司" value={priorityCompanyCount} />
              </div>
              <div className="mt-4 text-xs text-muted-foreground">分析失败 {aiFailedCount} 个</div>
            </OverviewSection>

            <OverviewSection title="岗位画像" description="从城市、公司与要求看集中度">
              <div className="grid grid-cols-2 gap-4">
                <OverviewMetric label="TOP城市" value={topName(stats?.charts.byCity)} />
                <OverviewMetric label="TOP公司" value={topName(stats?.charts.byCompany)} />
                <OverviewMetric label="主流经验" value={topName(stats?.charts.byExperience)} />
                <OverviewMetric label="主流学历" value={topName(stats?.charts.byDegree)} />
              </div>
            </OverviewSection>

            <OverviewSection title="数据质量" description="检查采集完整度与最近入库时间">
              <div className="grid grid-cols-2 gap-4">
                <OverviewMetric label="采集不足" value={insufficient} />
                <OverviewMetric label="缺少链接" value={missingLinkCount} />
                <OverviewMetric label="缺少薪资" value={missingSalaryCount} />
                <OverviewMetric label="最近入库" value={latestCreatedAt} />
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
  onConfirm,
}: {
  job: ZhilianJob
  acting: boolean
  onConfirm: () => void
}) {
  const jobTitle = job.jobTitle || "未命名岗位"
  const company = job.companyName || "未知公司"
  const riskText = job.aiReason?.trim() || (!job.jobLink ? "缺少原岗位链接，确认前建议核对岗位来源。" : "暂无明显风险点。")

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
          <div className="rounded-lg border border-white/60 bg-white/70 p-3 text-sm dark:border-white/10 dark:bg-neutral-900/50">
            <div className="mb-1 text-xs font-semibold text-muted-foreground">AI理由</div>
            <div className="line-clamp-3 leading-6">{job.aiReason || "暂无AI理由"}</div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
            <div className="mb-1 text-xs font-semibold">风险点</div>
            <div className="line-clamp-3 leading-6">{riskText}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {job.jobLink ? (
            <Button asChild size="sm" variant="outline">
              <a href={job.jobLink} target="_blank" rel="noreferrer">
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
        </div>
      </CardContent>
    </Card>
  )
}

export default function AnalysisContent({ showHeader = false, refreshSignal = 0 }: { showHeader?: boolean; refreshSignal?: number }) {
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [dashboardStats, setDashboardStats] = useState<StatsResponse | null>(null)
  const [loadingStats, setLoadingStats] = useState(true)
  const [loadingDashboardStats, setLoadingDashboardStats] = useState(true)

  const [items, setItems] = useState<ZhilianJob[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [inputPage, setInputPage] = useState<number | string>(1)
  const [inputSize, setInputSize] = useState<number | string>(20)

  const [statuses, setStatuses] = useState<string[]>([])
  const [location, setLocation] = useState<string>("")
  const [experience, setExperience] = useState<string>("")
  const [degree, setDegree] = useState<string>("")
  const [minK, setMinK] = useState<number | string>("")
  const [maxK, setMaxK] = useState<number | string>("")
  const [keyword, setKeyword] = useState<string>("")

  const [exporting, setExporting] = useState(false)
  const [clearingAnalysis, setClearingAnalysis] = useState(false)
  const [computedSalaryBuckets, setComputedSalaryBuckets] = useState<BucketValue[]>([])
  const [actingJobId, setActingJobId] = useState<number | null>(null)
  const [actingBatch, setActingBatch] = useState(false)
  const [pendingCardsExpanded, setPendingCardsExpanded] = useState(false)
  const activeScanRunId = ""

	  const statusOptions = ["待确认", "AI分析中", "未投递", "已投递", "已过滤", "投递失败", "AI不匹配", "AI分析失败"]

  const loadList = async (toPage = page, toSize = size) => {
    try {
      const params = new URLSearchParams()
      if (statuses.length) params.set("statuses", statuses.join(","))
      if (location) params.set("location", location)
      if (experience) params.set("experience", experience)
      if (degree) params.set("degree", degree)
      if (minK) params.set("minK", String(Number(minK)))
      if (maxK) params.set("maxK", String(Number(maxK)))
      if (keyword) params.set("keyword", keyword)
      if (activeScanRunId) params.set("scanRunId", activeScanRunId)
      params.set("page", String(toPage))
      params.set("size", String(toSize))
      const res = await fetch(`${API_BASE}/api/zhilian/list?${params.toString()}`)
      const data: PagedResult = await res.json()
      setItems(data.items || [])
      setTotal(data.total || 0)
      setPage(data.page || toPage)
      setSize(data.size || toSize)
    } catch (e) {
      console.error("fetch zhilian list failed", e)
    }
  }

  const loadStats = async () => {
    try {
      setLoadingStats(true)
      const params = new URLSearchParams()
      if (statuses.length) params.set("statuses", statuses.join(","))
      if (location) params.set("location", location)
      if (experience) params.set("experience", experience)
      if (degree) params.set("degree", degree)
      if (minK) params.set("minK", String(Number(minK)))
      if (maxK) params.set("maxK", String(Number(maxK)))
      if (keyword) params.set("keyword", keyword)
      if (activeScanRunId) params.set("scanRunId", activeScanRunId)
      const res = await fetch(`${API_BASE}/api/zhilian/stats?${params.toString()}`)
      const data: StatsResponse = await res.json()
      setStats(data)
    } catch (e) {
      console.error("fetch zhilian stats failed", e)
    } finally {
      setLoadingStats(false)
    }
  }

  const loadDashboardStats = async () => {
    try {
      setLoadingDashboardStats(true)
      const params = new URLSearchParams()
      if (activeScanRunId) params.set("scanRunId", activeScanRunId)
      const res = await fetch(`${API_BASE}/api/zhilian/stats?${params.toString()}`)
      const data: StatsResponse = await res.json()
      setDashboardStats(data)
    } catch (e) {
      console.error("fetch zhilian dashboard stats failed", e)
    } finally {
      setLoadingDashboardStats(false)
    }
  }

  const clearAnalysisData = async () => {
    const ok = window.confirm("确认清空智联投递分析数据？这会删除当前岗位列表、统计图和历史AI分析结果，适合切换人物或简历前使用。")
    if (!ok) return
    try {
      setClearingAnalysis(true)
      const res = await fetch(`${API_BASE}/api/zhilian/analysis`, { method: "DELETE" })
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
      setComputedSalaryBuckets([])
      await loadList(1, size)
      await loadStats()
      await loadDashboardStats()
      alert(data.message || "智联投递分析数据已清空。")
    } catch (error) {
      alert(error instanceof Error ? error.message : "清空失败：网络或服务异常。")
    } finally {
      setClearingAnalysis(false)
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
  }, [statuses.join(","), location, experience, degree, minK, maxK, keyword])

  const exportCSV = async () => {
    try {
      setExporting(true)
      const baseParams = new URLSearchParams()
      if (statuses.length) baseParams.set("statuses", statuses.join(","))
      if (location) baseParams.set("location", location)
      if (experience) baseParams.set("experience", experience)
      if (degree) baseParams.set("degree", degree)
      if (minK) baseParams.set("minK", String(Number(minK)))
      if (maxK) baseParams.set("maxK", String(Number(maxK)))
      if (keyword) baseParams.set("keyword", keyword)

      const pageSize = 1000
      let currentPage = 1
      let all: ZhilianJob[] = []
      let totalCount = 0

      while (true) {
        const params = new URLSearchParams(baseParams)
        params.set("page", String(currentPage))
        params.set("size", String(pageSize))
        const res = await fetch(`${API_BASE}/api/zhilian/list?${params.toString()}`)
        const data: PagedResult = await res.json()
        const chunk = data.items || []
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
        it.jobTitle || "",
        it.salary || "",
        it.location || "",
        it.experience || "",
        it.degree || "",
        it.deliveryStatus || "",
        it.deliveryStatus === "投递失败" ? failureTypeLabel(it.failureType) : "",
        it.deliveryStatus === "投递失败" ? (it.failureReason || "") : "",
        it.aiScore ?? "",
        it.aiDecision || "",
        it.aiReason || "",
        it.priorityCompany ? "是" : "",
        it.jobLink || "",
        formatDateOnly(it.createTime),
      ])

      const csv = [header.join(","), ...rows.map((r) => r.map((v) => String(v).replace(/"/g, '""')).join(","))].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `zhilian_jobs_${Date.now()}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error("export csv failed", e)
    } finally {
      setExporting(false)
    }
  }

  const refreshComputedSalaryBuckets = async () => {
    try {
      const baseParams = new URLSearchParams()
      if (statuses.length) baseParams.set("statuses", statuses.join(","))
      if (location) baseParams.set("location", location)
      if (experience) baseParams.set("experience", experience)
      if (degree) baseParams.set("degree", degree)
      if (minK) baseParams.set("minK", String(Number(minK)))
      if (maxK) baseParams.set("maxK", String(Number(maxK)))
      if (keyword) baseParams.set("keyword", keyword)

      const pageSize = 1000
      let currentPage = 1
      let totalCount = 0
      const ks: number[] = []

      while (true) {
        const params = new URLSearchParams(baseParams)
        params.set("page", String(currentPage))
        params.set("size", String(pageSize))
        const res = await fetch(`${API_BASE}/api/zhilian/list?${params.toString()}`)
        const data: PagedResult = await res.json()
        const chunk = data.items || []
        if (currentPage === 1) totalCount = data.total || chunk.length
        for (const it of chunk) {
          const info = parseSalary(it.salary)
          if (info && !isNaN(info.medianK)) ks.push(info.medianK)
        }
        if (currentPage * pageSize >= totalCount || chunk.length === 0) break
        currentPage += 1
      }

      if (!ks.length) { setComputedSalaryBuckets([]); return }

      const buckets: { key: string; min: number; max: number | null }[] = [
        { key: "0-10K", min: 0, max: 10 },
        { key: "10-15K", min: 10, max: 15 },
        { key: "15-20K", min: 15, max: 20 },
        { key: "20-25K", min: 20, max: 25 },
        { key: ">=25K", min: 25, max: null },
      ]
      const counts = buckets.map((b) => ks.filter((k) => (b.max == null ? k >= b.min : k >= b.min && k < b.max)).length)
      setComputedSalaryBuckets(buckets.map((b, i) => ({ bucket: b.key, value: counts[i] })))
    } catch (e) {
      console.error("compute salary buckets failed", e)
      setComputedSalaryBuckets([])
    }
  }

  const currentBatchFilters = () => ({
    location: location || undefined,
    experience: experience || undefined,
    degree: degree || undefined,
    minK: minK ? Number(minK) : undefined,
    maxK: maxK ? Number(maxK) : undefined,
    keyword: keyword || undefined,
    scanRunId: activeScanRunId || undefined,
  })

  const handleConfirmJob = async (job: ZhilianJob) => {
    if (!job.id) {
      alert("该智联岗位缺少内部ID，无法确认投递。")
      return
    }
    try {
      setActingJobId(job.id)
      const res = await fetch(`${API_BASE}/api/zhilian/jobs/${job.id}/confirm`, { method: "POST" })
      const data = await res.json()
      if (!data.success) {
        alert(data.message || "该智联岗位暂不能投递。")
        return
      }
      const ok = window.confirm(`将通过 Chrome 真实申请智联岗位：${job.companyName || ""} / ${job.jobTitle || ""}。确认继续？`)
      if (!ok) return
      const result = await sendChromeBridgeMessage({
        type: "ZHILIAN_DELIVER_ONE",
        platform: "zhilian",
        task: data.task,
      }, 120000)
      alert(result.message || (result.success ? "已发送投递请求。" : "Chrome投递失败。"))
      await loadList(page, size)
      await loadStats()
      await loadDashboardStats()
    } catch {
      alert("确认投递失败：网络或服务异常。")
    } finally {
      setActingJobId(null)
    }
  }

  const handleConfirmBatch = async () => {
    try {
      setActingBatch(true)
      const res = await fetch(`${API_BASE}/api/zhilian/jobs/confirm-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentBatchFilters()),
      })
      const data = await res.json()
      const tasks = data.tasks || []
      if (!data.success || tasks.length === 0) {
        alert(data.message || "当前筛选条件下没有智联待确认岗位。")
        return
      }
      const ok = window.confirm(`将通过 Chrome 真实申请 ${tasks.length} 个智联待确认岗位。确认继续？`)
      if (!ok) return
      const result = await sendChromeBridgeMessage({
        type: "ZHILIAN_DELIVER_BATCH",
        platform: "zhilian",
        tasks,
      }, Math.max(120000, tasks.length * 30000))
      alert(result.message || "批量投递任务已结束。")
      await loadList(page, size)
      await loadStats()
      await loadDashboardStats()
    } catch {
      alert("批量投递失败：网络或服务异常。")
    } finally {
      setActingBatch(false)
    }
  }

  useEffect(() => {
    const apiBuckets = stats?.charts?.salaryBuckets || []
    const sum = apiBuckets.reduce((a, b) => a + (b?.value || 0), 0)
    if (apiBuckets.length === 0 || sum === 0) {
      refreshComputedSalaryBuckets()
    } else {
      setComputedSalaryBuckets([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, statuses.join(","), location, experience, degree, minK, maxK, keyword])

  const kpiCards = useMemo(() => {
    const k = dashboardStats?.kpi
    const statusCount = (name: string) => dashboardStats?.charts.byStatus.find((item) => item.name === name)?.value ?? 0
    const avgMonthlyKFromItems = (() => {
      if (!items?.length) return undefined
      const ks: number[] = []
      for (const it of items) {
        const info = parseSalary(it.salary)
        if (info && !isNaN(info.medianK)) ks.push(info.medianK)
      }
      if (!ks.length) return undefined
      const sum = ks.reduce((a, b) => a + b, 0)
      return Math.round((sum / ks.length) * 10) / 10
    })()
    return [
      { title: "总岗位数", value: k?.total ?? 0 },
      { title: "已投递", value: k?.delivered ?? 0 },
      { title: "待确认", value: k?.waitingConfirm ?? 0 },
      { title: "采集不足", value: statusCount("采集信息不足") },
      { title: "未投递", value: k?.pending ?? 0 },
      { title: "已过滤", value: k?.filtered ?? 0 },
      { title: "投递失败", value: k?.failed ?? 0 },
      { title: "平均月薪(K)", value: (k?.avgMonthlyK ?? avgMonthlyKFromItems ?? 0) },
    ]
  }, [dashboardStats, items])

  const pendingJobs = useMemo(() => (
    items.filter((item) => item.deliveryStatus === "待确认")
  ), [items])
  const visiblePendingJobs = useMemo(() => (
    pendingCardsExpanded ? pendingJobs : pendingJobs.slice(0, 2)
  ), [pendingCardsExpanded, pendingJobs])

  return (
    <div className="space-y-8">
      {showHeader && (
        <PageHeader
          title="智联 投递分析"
          subtitle="基于 zhilian_data 表的统计图与列表分析"
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

        <OverviewPanel stats={dashboardStats} items={items} loading={loadingDashboardStats} />
      </div>

      {/* 操作栏 */}
      <Card>
        <CardHeader className="space-y-0">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">筛选与操作</CardTitle>
              <CardDescription>按状态、地区、经验、学历与薪资区间过滤列表</CardDescription>
            </div>
            <div className="flex flex-wrap gap-3 rounded-lg px-3 py-2 border border-white/20 bg-white/5 backdrop-blur-md shadow-sm">
              {statusOptions.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
                  className={`px-3 py-1.5 rounded-full text-xs border ${statuses.includes(s) ? "bg-primary text-white border-primary" : "bg-transparent text-primary border-primary"}`}
                >
                  {s}
                </button>
              ))}
              <button className="px-3 py-1.5 rounded-full text-xs border" onClick={() => setStatuses([])}>重置</button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div className="space-y-2">
              <Label>地区</Label>
              <Input placeholder="如：北京" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>经验</Label>
              <Input placeholder="如：3-5年" value={experience} onChange={(e) => setExperience(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>学历</Label>
              <Input placeholder="如：本科" value={degree} onChange={(e) => setDegree(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>最低K</Label>
              <Input placeholder="如：10" value={minK} onChange={(e) => setMinK(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>最高K</Label>
              <Input placeholder="如：30" value={maxK} onChange={(e) => setMaxK(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>关键词</Label>
              <Input placeholder="公司或岗位关键词" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button variant="default" onClick={() => loadStats()} disabled={loadingStats}>
              <BiRefresh className="mr-1" /> 刷新统计
            </Button>
            <Button variant="outline" onClick={() => loadList(1, size)}>
              <BiBriefcase className="mr-1" /> 刷新列表
            </Button>
            <Button variant="destructive" onClick={clearAnalysisData} disabled={clearingAnalysis}>
              <BiTrash className="mr-1" /> {clearingAnalysis ? "清空中..." : "清空分析"}
            </Button>
            <Button variant="outline" onClick={exportCSV} disabled={exporting}>
              <BiDownload className="mr-1" /> 导出CSV
            </Button>
            <Button variant="destructive" onClick={handleConfirmBatch} disabled={actingBatch}>
              <BiBriefcase className="mr-1" /> {actingBatch ? "投递中..." : "投递当前筛选待确认"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BiCheckCircle className="text-cyan-600" />
              待确认岗位卡片
            </div>
            <div className="mt-1 text-xs text-muted-foreground">优先处理待确认投递，确认前可查看原岗位和 AI 理由。</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {pendingJobs.length > 2 && (
              <Button size="sm" variant="outline" onClick={() => setPendingCardsExpanded((expanded) => !expanded)}>
                {pendingCardsExpanded ? <BiChevronUp className="mr-1" /> : <BiChevronDown className="mr-1" />}
                {pendingCardsExpanded ? "收起，只留 2 个" : `展开全部 ${pendingJobs.length} 个`}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setStatuses(["待确认"])}>
              <BiBarChart className="mr-1" /> 只看待确认
            </Button>
            <Button size="sm" variant="destructive" onClick={handleConfirmBatch} disabled={actingBatch}>
              <BiBriefcase className="mr-1" /> {actingBatch ? "投递中..." : "投递当前筛选待确认"}
            </Button>
          </div>
        </div>

        {pendingJobs.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            当前筛选下没有待确认岗位。
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {visiblePendingJobs.map((job) => (
              <PendingJobCard
                key={job.id || job.jobId}
                job={job}
                acting={actingJobId === job.id}
                onConfirm={() => handleConfirmJob(job)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 图表区 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><BiBarChart /> 投递状态分布</CardTitle>
            <CardDescription>按 delivery_status 聚合</CardDescription>
          </CardHeader>
          <CardContent>
            {stats ? (
              <ChartCanvas type="pie" labels={stats.charts.byStatus.map((x) => x.name)} data={stats.charts.byStatus.map((x) => x.value)} colors={CATEGORY_COLORS} />
            ) : (
              <div className="text-muted-foreground">加载中...</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><BiBarChart /> 失败类型统计</CardTitle>
            <CardDescription>按 failure_type 聚合投递失败原因</CardDescription>
          </CardHeader>
          <CardContent>
            {stats ? (
              <ChartCanvas
                type="pie"
                labels={(stats.charts.byFailureType || []).map((x) => failureTypeLabel(x.name))}
                data={(stats.charts.byFailureType || []).map((x) => x.value)}
                colors={CATEGORY_COLORS}
              />
            ) : (
              <div className="text-muted-foreground">加载中...</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><BiBarChart /> 城市TOP10</CardTitle>
            <CardDescription>按地区聚合</CardDescription>
          </CardHeader>
          <CardContent>
            {stats ? (
              <ChartCanvas type="bar" labels={stats.charts.byCity.map((x) => x.name)} data={stats.charts.byCity.map((x) => x.value)} color="#3b82f6" />
            ) : (
              <div className="text-muted-foreground">加载中...</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><BiBarChart /> 公司岗位数TOP10</CardTitle>
            <CardDescription>按公司名称聚合</CardDescription>
          </CardHeader>
          <CardContent>
            {stats ? (
              <ChartCanvas type="bar" labels={stats.charts.byCompany.map((x) => x.name)} data={stats.charts.byCompany.map((x) => x.value)} color="#10b981" />
            ) : (
              <div className="text-muted-foreground">加载中...</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><BiBarChart /> 经验分布</CardTitle>
            <CardDescription>不同经验要求的岗位数</CardDescription>
          </CardHeader>
          <CardContent>
            {stats ? (
              <ChartCanvas type="bar" labels={stats.charts.byExperience.map((x) => x.name)} data={stats.charts.byExperience.map((x) => x.value)} color="#f59e0b" />
            ) : (
              <div className="text-muted-foreground">加载中...</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><BiBarChart /> 学历分布</CardTitle>
            <CardDescription>不同学历要求的岗位数</CardDescription>
          </CardHeader>
          <CardContent>
            {stats ? (
              <ChartCanvas type="bar" labels={stats.charts.byDegree.map((x) => x.name)} data={stats.charts.byDegree.map((x) => x.value)} color="#6366f1" />
            ) : (
              <div className="text-muted-foreground">加载中...</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><BiLineChart /> 薪资区间分布</CardTitle>
            <CardDescription>基于中位数K的桶聚合（后端或前端计算）</CardDescription>
          </CardHeader>
          <CardContent>
            {stats ? (
              <ChartCanvas
                type="line"
                labels={(computedSalaryBuckets.length ? computedSalaryBuckets : stats.charts.salaryBuckets).map((x: SalaryBucketLike) => salaryBucketLabel(x))}
                data={(computedSalaryBuckets.length ? computedSalaryBuckets : stats.charts.salaryBuckets).map((x) => x.value)}
                color="#ef4444"
              />
            ) : (
              <div className="text-muted-foreground">加载中...</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 列表区 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">岗位列表</CardTitle>
          <CardDescription>分页展示符合筛选条件的岗位</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-muted">
                  <th className="py-2 px-3 text-left">操作</th>
                  <th className="py-2 px-3 text-left">公司</th>
                  <th className="py-2 px-3 text-left">岗位</th>
                  <th className="py-2 px-3 text-left">薪资</th>
                  <th className="py-2 px-3 text-left">地点</th>
                  <th className="py-2 px-3 text-left">经验</th>
                  <th className="py-2 px-3 text-left">学历</th>
                  <th className="py-2 px-3 text-left">投递状态</th>
                  <th className="py-2 px-3 text-left">失败原因</th>
                  <th className="py-2 px-3 text-left">AI分</th>
                  <th className="py-2 px-3 text-left">AI决策</th>
                  <th className="py-2 px-3 text-left">优先</th>
                  <th className="py-2 px-3 text-left">AI原因</th>
                  <th className="py-2 px-3 text-left">链接</th>
                  <th className="py-2 px-3 text-left">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr
                    key={`${it.jobId}-${idx}`}
                    className={`border-t transition-colors ${
                      (it.deliveryStatus || "").trim() === "已投递"
                        ? "border-emerald-200 bg-emerald-50/80 hover:bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20"
                        : "hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
                    }`}
                  >
                    <td className="py-2 px-3 whitespace-nowrap">
                      {it.deliveryStatus === "待确认" ? (
                        <Button
                          size="sm"
                          disabled={actingJobId === it.id}
                          onClick={() => handleConfirmJob(it)}
                          className="h-7 rounded-lg px-3 text-xs"
                        >
                          Chrome投递
                        </Button>
                      ) : (it.deliveryStatus || "").trim() === "已投递" ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                          <BiCheckCircle className="h-3.5 w-3.5" />
                          已投递
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">{it.companyName || ""}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{it.jobTitle || ""}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{it.salary || ""}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{it.location || ""}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{it.experience || ""}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{it.degree || ""}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={badgeClass("delivery", it.deliveryStatus)}>
                        {(it.deliveryStatus || "").trim() === "已投递" ? (
                          <span className="inline-flex items-center gap-1">
                            <BiCheckCircle className="h-3.5 w-3.5" />
                            已投递
                          </span>
                        ) : (
                          it.deliveryStatus || ""
                        )}
                      </span>
                    </td>
                    <td className="py-2 px-3 max-w-[260px] truncate" title={failureReasonText(it)}>{failureReasonText(it)}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{it.aiScore ?? "-"}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={badgeClass("delivery", it.aiDecision)}>{it.aiDecision || "-"}</span>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">{it.priorityCompany ? "是" : "-"}</td>
                    <td className="py-2 px-3 max-w-[280px] truncate" title={it.aiReason || ""}>{it.aiReason || "-"}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {it.jobLink ? (
                        <a href={it.jobLink} target="_blank" rel="noreferrer" className="text-primary hover:underline">打开</a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">{formatDateOnly(it.createTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          <div className="mt-4 flex items-center gap-2">
            <Label className="text-sm">页码</Label>
            <Input
              className="w-20"
              value={inputPage}
              onChange={(e) => setInputPage(e.target.value)}
              onBlur={() => {
                const p = Number(inputPage)
                const s = Number(size)
                if (!isNaN(p) && p > 0) loadList(p, s)
              }}
            />
            <Label className="text-sm">每页条数</Label>
            <Input
              className="w-24"
              value={inputSize}
              onChange={(e) => setInputSize(e.target.value)}
              onBlur={() => {
                const p = Number(page)
                const s = Number(inputSize)
                if (!isNaN(s) && s > 0) loadList(p, s)
              }}
            />
            <Button variant="outline" onClick={() => loadList(Number(page), Number(size))}>
              跳转
            </Button>
            <div className="text-sm text-muted-foreground">共 {total} 条</div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
