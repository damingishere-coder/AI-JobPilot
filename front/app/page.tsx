"use client"

import Link from "next/link"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import PageHeader from "@/app/components/PageHeader"
import SetupChecklist from "@/app/components/SetupChecklist"
import { API_BASE } from "@/lib/api"
import {
  BiBarChart,
  BiBrain,
  BiCheckCircle,
  BiErrorCircle,
  BiHomeAlt,
  BiLinkExternal,
  BiLoaderAlt,
  BiRefresh,
  BiSearch,
} from "react-icons/bi"

type PlatformStats = {
  pendingConfirm: number
  delivered: number
  failed: number
}

type DashboardState = {
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

const initialDashboard: DashboardState = {
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
    const [bossStats, zhilianStats] = await Promise.all([
      loadPlatformStats("boss"),
      loadPlatformStats("zhilian"),
    ])
    setDashboard({
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

      <SetupChecklist />

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
