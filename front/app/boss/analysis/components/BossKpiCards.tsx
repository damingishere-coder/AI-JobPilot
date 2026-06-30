"use client"

import type { ReactNode } from "react"
import { BiBarChart } from "react-icons/bi"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { StatsResponse } from "../types"
import { formatDateOnlyValue } from "../utils"

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

function OverviewPanel({ stats, loading }: { stats: StatsResponse | null; loading: boolean }) {
  const k = stats?.kpi
  const overview = stats?.overview
  const statusCount = (name: string) => stats?.charts.byStatus.find((item) => item.name === name)?.value ?? 0
  const total = k?.total ?? 0
  const delivered = k?.delivered ?? 0
  const waitingConfirm = k?.waitingConfirm ?? 0
  const listCollected = k?.listCollected ?? 0
  const filtered = k?.filtered ?? 0
  const failed = k?.failed ?? 0
  const skipped = statusCount("已跳过")
  const remainder = Math.max(0, total - delivered - waitingConfirm - listCollected - filtered - failed - skipped)
  const segments = [
    { label: "已投递", value: delivered, className: "bg-emerald-500" },
    { label: "待确认", value: waitingConfirm, className: "bg-cyan-500" },
    { label: "已采集", value: listCollected, className: "bg-teal-500" },
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
                <OverviewMetric label="已采集" value={listCollected} />
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

export function BossKpiCards({
  stats,
  loading,
}: {
  stats: StatsResponse | null
  loading: boolean
}) {
  const k = stats?.kpi
  const cards = [
    { title: "总岗位数", value: k?.total ?? 0 },
    { title: "已投递", value: k?.delivered ?? 0 },
    { title: "待确认", value: k?.waitingConfirm ?? 0 },
    { title: "已采集", value: k?.listCollected ?? 0 },
    { title: "采集不足", value: k?.insufficient ?? 0 },
    { title: "未投递", value: k?.pending ?? 0 },
    { title: "已过滤", value: k?.filtered ?? 0 },
    { title: "投递失败", value: k?.failed ?? 0 },
    { title: "平均月薪(K)", value: k?.avgMonthlyK ?? 0 },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-9">
        {cards.map((card) => (
          <Card key={card.title} className="border">
            <CardHeader>
              <CardTitle className="text-sm">{card.title}</CardTitle>
              <CardDescription className="text-xl font-semibold">{card.value}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <OverviewPanel stats={stats} loading={loading} />
    </div>
  )
}
