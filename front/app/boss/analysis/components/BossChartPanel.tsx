"use client"

import { useEffect, useRef } from "react"
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
import { BiBarChart, BiChevronDown, BiChevronUp, BiLineChart, BiPieChart } from "react-icons/bi"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CATEGORY_COLORS, type StatsResponse } from "../types"
import { deliveryStatusLabel, failureTypeLabel } from "../utils"

type ChartRef = { destroy: () => void }

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
        return (colors && colors.length ? colors : pieColorsBase).slice(0, labels.length)
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

function EmptyChart() {
  return (
    <div className="h-44 md:h-48 flex items-center justify-center border-2 border-dashed rounded-lg text-muted-foreground">
      加载中...
    </div>
  )
}

export function BossChartPanel({
  stats,
  analyticsOpen,
  onToggleOpen,
}: {
  stats: StatsResponse | null
  analyticsOpen: boolean
  onToggleOpen: () => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-base flex items-center gap-2"><BiBarChart /> 统计分析</CardTitle>
          <CardDescription>岗位库概览和图表保留在下方，默认收起，不影响待确认投递。</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={onToggleOpen}>
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
                    labels={stats.charts.byStatus.map((x) => deliveryStatusLabel(x.name))}
                    data={stats.charts.byStatus.map((x) => x.value)}
                  />
                ) : (
                  <EmptyChart />
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
                  <EmptyChart />
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
                  <EmptyChart />
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
                  <EmptyChart />
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
                  <EmptyChart />
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
                  <EmptyChart />
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
                  <EmptyChart />
                )}
              </CardContent>
            </Card>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
