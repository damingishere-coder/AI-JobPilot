"use client"

import Link from "next/link"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import PageHeader from "@/app/components/PageHeader"
import { getChromeBridgeStatus } from "@/lib/chromeBridge"
import {
  BiBarChart,
  BiBrain,
  BiBriefcase,
  BiCheckCircle,
  BiErrorCircle,
  BiHomeAlt,
  BiLinkExternal,
  BiLoaderAlt,
  BiRefresh,
  BiSearch,
  BiServer,
  BiShieldQuarter,
  BiUserCircle,
} from "react-icons/bi"

const API_BASE = process.env.API_BASE_URL || "http://localhost:8888"

type ServiceState = "ok" | "warning" | "error" | "loading"

type StatusCardState = {
  title: string
  state: ServiceState
  value: string
  detail: string
}

type PlatformStats = {
  pendingConfirm: number
  delivered: number
  failed: number
}

type DashboardState = {
  backend: StatusCardState
  chromeBridge: StatusCardState
  aiConfig: StatusCardState
  bossLogin: StatusCardState
  zhilianLogin: StatusCardState
  bossStats: PlatformStats
  zhilianStats: PlatformStats
  lastUpdated: string
}

type StatsResponse = {
  kpi?: {
    waitingConfirm?: number
    delivered?: number
    failed?: number
  }
}

type LoginStatusResponse = {
  success?: boolean
  isLoggedIn?: boolean
  searchReady?: boolean
  homeLoggedIn?: boolean
  message?: string
  failureReason?: string
}

type AiConfigResponse = {
  success?: boolean
  data?: {
    introduce?: string | null
    prompt?: string | null
  } | null
}

const loadingStatus = (title: string): StatusCardState => ({
  title,
  state: "loading",
  value: "检查中",
  detail: "正在读取本地服务状态",
})

const initialDashboard: DashboardState = {
  backend: loadingStatus("后端连接"),
  chromeBridge: loadingStatus("Chrome Bridge"),
  aiConfig: loadingStatus("AI 配置"),
  bossLogin: loadingStatus("Boss 登录"),
  zhilianLogin: loadingStatus("智联登录"),
  bossStats: { pendingConfirm: 0, delivered: 0, failed: 0 },
  zhilianStats: { pendingConfirm: 0, delivered: 0, failed: 0 },
  lastUpdated: "",
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

async function fetchJson<T>(url: string, timeoutMs = 3000): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`status ${res.status}`)
    return (await res.json()) as T
  } finally {
    window.clearTimeout(timeout)
  }
}

async function loadBackendStatus(): Promise<StatusCardState> {
  try {
    let data: { status?: string; state?: string; service?: string }
    try {
      data = await fetchJson<{ status?: string; state?: string; service?: string }>(`${API_BASE}/api/health`)
      const raw = String(data.status || data.state || "").toUpperCase()
      if (!raw) {
        data = await fetchJson<{ status?: string; state?: string; service?: string }>(`${API_BASE}/actuator/health`)
      }
    } catch {
      data = await fetchJson<{ status?: string; state?: string; service?: string }>(`${API_BASE}/actuator/health`)
    }
    const status = String(data.status || data.state || "").toUpperCase()
    if (status === "UP" || status === "HEALTHY") {
      return {
        title: "后端连接",
        state: "ok",
        value: "已连接",
        detail: data.service ? `${data.service} 服务运行正常` : "本地后端服务运行正常",
      }
    }
    if (status === "DEGRADED" || status === "WARN") {
      return {
        title: "后端连接",
        state: "warning",
        value: "服务降级",
        detail: "后端可访问，但健康状态不是完全正常",
      }
    }
    return {
      title: "后端连接",
      state: "error",
      value: "状态异常",
      detail: status ? `健康检查返回 ${status}` : "健康检查返回内容异常",
    }
  } catch {
    return {
      title: "后端连接",
      state: "error",
      value: "未连接",
      detail: "未检测到 localhost:8888 后端服务",
    }
  }
}

async function loadChromeBridgeStatus(): Promise<StatusCardState> {
  try {
    const status = await getChromeBridgeStatus()
    if (status.success) {
      return {
        title: "Chrome Bridge",
        state: "ok",
        value: "已连接",
        detail: status.version ? `扩展版本 ${status.version}` : "Chrome 扩展可正常响应",
      }
    }
    return {
      title: "Chrome Bridge",
      state: "warning",
      value: "未连接",
      detail: status.message || "请确认已加载投递牛马 Chrome Bridge",
    }
  } catch {
    return {
      title: "Chrome Bridge",
      state: "warning",
      value: "未连接",
      detail: "Chrome 扩展未响应",
    }
  }
}

async function loadAiConfigStatus(): Promise<StatusCardState> {
  try {
    const data = await fetchJson<AiConfigResponse>(`${API_BASE}/api/ai/config`)
    const introduce = data.data?.introduce?.trim()
    const prompt = data.data?.prompt?.trim()
    if (data.success && (introduce || prompt)) {
      return {
        title: "AI 配置",
        state: "ok",
        value: "已配置",
        detail: "已保存求职资料和 AI 分析配置",
      }
    }
    return {
      title: "AI 配置",
      state: "warning",
      value: "待完善",
      detail: "建议先配置简历摘要和岗位分析提示词",
    }
  } catch {
    return {
      title: "AI 配置",
      state: "error",
      value: "无法读取",
      detail: "后端不可用或 AI 配置接口异常",
    }
  }
}

async function loadLoginStatus(platform: "boss" | "zhilian"): Promise<StatusCardState> {
  const title = platform === "boss" ? "Boss 登录" : "智联登录"
  try {
    const data = await fetchJson<LoginStatusResponse>(`${API_BASE}/api/${platform}/login-status`, 5000)
    const isReady = platform === "boss" ? !!data.searchReady || !!data.isLoggedIn : !!data.isLoggedIn
    if (data.success && isReady) {
      return {
        title,
        state: "ok",
        value: "已登录",
        detail: platform === "boss" ? "Boss 搜索页已就绪，可以扫描" : "智联登录态可用",
      }
    }
    return {
      title,
      state: "warning",
      value: "未就绪",
      detail: data.message || data.failureReason || "请先在 Chrome 中完成登录",
    }
  } catch {
    return {
      title,
      state: "error",
      value: "无法检测",
      detail: "登录状态接口暂不可用",
    }
  }
}

async function loadPlatformStats(platform: "boss" | "zhilian"): Promise<PlatformStats> {
  try {
    const data = await fetchJson<StatsResponse>(`${API_BASE}/api/${platform}/stats`, 5000)
    return {
      pendingConfirm: numberOrZero(data.kpi?.waitingConfirm),
      delivered: numberOrZero(data.kpi?.delivered),
      failed: numberOrZero(data.kpi?.failed),
    }
  } catch {
    return { pendingConfirm: 0, delivered: 0, failed: 0 }
  }
}

function stateStyles(state: ServiceState) {
  if (state === "ok") {
    return {
      dot: "bg-emerald-500",
      icon: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-300",
      text: "text-emerald-700 dark:text-emerald-300",
    }
  }
  if (state === "warning") {
    return {
      dot: "bg-amber-500",
      icon: "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300",
      text: "text-amber-700 dark:text-amber-300",
    }
  }
  if (state === "loading") {
    return {
      dot: "bg-slate-400",
      icon: "text-slate-500 bg-slate-100 dark:bg-white/5 dark:text-slate-300",
      text: "text-slate-500 dark:text-slate-300",
    }
  }
  return {
    dot: "bg-rose-500",
    icon: "text-rose-600 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-300",
    text: "text-rose-700 dark:text-rose-300",
  }
}

function StatusCard({ status, icon }: { status: StatusCardState; icon: ReactNode }) {
  const styles = stateStyles(status.state)
  return (
    <Card className="min-h-[156px]">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${styles.icon}`}>{icon}</div>
          <div className="flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500 dark:bg-white/5 dark:text-manatee">
            <span className={`h-2 w-2 rounded-full ${styles.dot}`} />
            {status.state === "loading" ? "检查中" : status.value}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm font-medium text-slate-500 dark:text-manatee">{status.title}</p>
        <p className={`mt-2 text-2xl font-bold tracking-normal ${styles.text}`}>{status.value}</p>
        <p className="mt-2 min-h-[40px] text-sm leading-5 text-muted-foreground">{status.detail}</p>
      </CardContent>
    </Card>
  )
}

function PlatformStatsCard({
  name,
  description,
  stats,
  href,
  icon,
  accent,
}: {
  name: string
  description: string
  stats: PlatformStats
  href: string
  icon: ReactNode
  accent: string
}) {
  const items = [
    { label: "待确认", value: stats.pendingConfirm },
    { label: "已投递", value: stats.delivered },
    { label: "失败", value: stats.failed },
  ]

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${accent}`}>{icon}</div>
            <div>
              <CardTitle className="text-lg">{name}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={href}>
              <BiBarChart />
              分析
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          {items.map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs font-medium text-slate-500 dark:text-manatee">{item.label}</p>
              <p className="mt-2 text-3xl font-bold tracking-normal text-slate-950 dark:text-white">{item.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export default function DeliveryWorkbenchPage() {
  const [dashboard, setDashboard] = useState<DashboardState>(initialDashboard)
  const [refreshing, setRefreshing] = useState(false)

  const loadDashboard = useCallback(async () => {
    setRefreshing(true)
    const [backend, chromeBridge, aiConfig, bossLogin, zhilianLogin, bossStats, zhilianStats] = await Promise.all([
      loadBackendStatus(),
      loadChromeBridgeStatus(),
      loadAiConfigStatus(),
      loadLoginStatus("boss"),
      loadLoginStatus("zhilian"),
      loadPlatformStats("boss"),
      loadPlatformStats("zhilian"),
    ])
    setDashboard({
      backend,
      chromeBridge,
      aiConfig,
      bossLogin,
      zhilianLogin,
      bossStats,
      zhilianStats,
      lastUpdated: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    })
    setRefreshing(false)
  }, [])

  useEffect(() => {
    const run = () => {
      void loadDashboard()
    }
    const startup = window.setTimeout(run, 0)
    const interval = window.setInterval(run, 30000)
    return () => {
      window.clearTimeout(startup)
      window.clearInterval(interval)
    }
  }, [loadDashboard])

  const totalStats = useMemo(() => {
    const boss = dashboard.bossStats
    const zhilian = dashboard.zhilianStats
    return {
      pendingConfirm: boss.pendingConfirm + zhilian.pendingConfirm,
      delivered: boss.delivered + zhilian.delivered,
      failed: boss.failed + zhilian.failed,
    }
  }, [dashboard.bossStats, dashboard.zhilianStats])

  return (
    <div className="space-y-5">
      <PageHeader
        title="投递工作台"
        subtitle="连接状态、待确认岗位与投递进度集中看板"
        icon={<BiHomeAlt size={28} />}
        iconClass="text-blue-600"
        accentBgClass="bg-blue-50 dark:bg-blue-500/15"
        actions={
          <Button onClick={loadDashboard} variant="outline" size="sm" disabled={refreshing}>
            {refreshing ? <BiLoaderAlt className="animate-spin" /> : <BiRefresh />}
            刷新
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">今日投递概览</CardTitle>
            <CardDescription>
              {dashboard.lastUpdated ? `最后刷新 ${dashboard.lastUpdated}` : "正在读取投递状态"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-cyan-200/80 bg-cyan-50/80 p-5 dark:border-cyan-500/20 dark:bg-cyan-500/10">
                <p className="text-sm font-medium text-cyan-700 dark:text-cyan-300">待确认</p>
                <p className="mt-3 text-4xl font-bold tracking-normal text-slate-950 dark:text-white">{totalStats.pendingConfirm}</p>
              </div>
              <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/80 p-5 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">已投递</p>
                <p className="mt-3 text-4xl font-bold tracking-normal text-slate-950 dark:text-white">{totalStats.delivered}</p>
              </div>
              <div className="rounded-lg border border-rose-200/80 bg-rose-50/80 p-5 dark:border-rose-500/20 dark:bg-rose-500/10">
                <p className="text-sm font-medium text-rose-700 dark:text-rose-300">失败</p>
                <p className="mt-3 text-4xl font-bold tracking-normal text-slate-950 dark:text-white">{totalStats.failed}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">快捷入口</CardTitle>
            <CardDescription>扫描、待确认和 AI 配置入口</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button asChild>
              <Link href="/boss">
                <BiSearch />
                去Boss扫描
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/zhilian">
                <BiSearch />
                去智联扫描
              </Link>
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/boss/analysis">
                  <BiLinkExternal />
                  Boss待确认
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/zhilian/analysis">
                  <BiLinkExternal />
                  智联待确认
                </Link>
              </Button>
            </div>
            <Button asChild variant="success">
              <Link href="/ai-config">
                <BiBrain />
                去AI配置
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatusCard status={dashboard.backend} icon={<BiServer size={22} />} />
        <StatusCard status={dashboard.chromeBridge} icon={<BiShieldQuarter size={22} />} />
        <StatusCard status={dashboard.aiConfig} icon={<BiBrain size={22} />} />
        <StatusCard status={dashboard.bossLogin} icon={<BiBriefcase size={22} />} />
        <StatusCard status={dashboard.zhilianLogin} icon={<BiUserCircle size={22} />} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PlatformStatsCard
          name="Boss直聘"
          description="Boss 岗位库中的待确认、已投递与失败"
          stats={dashboard.bossStats}
          href="/boss/analysis"
          icon={<BiCheckCircle size={24} />}
          accent="bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-200"
        />
        <PlatformStatsCard
          name="智联招聘"
          description="智联岗位库中的待确认、已投递与失败"
          stats={dashboard.zhilianStats}
          href="/zhilian/analysis"
          icon={<BiErrorCircle size={24} />}
          accent="bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-200"
        />
      </div>
    </div>
  )
}
