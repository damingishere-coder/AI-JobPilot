"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { loadSetupChecklist, type SetupCheckItem, type SetupChecklistResult } from "@/lib/setupChecklist"
import { BiCheckCircle, BiErrorCircle, BiLoaderAlt, BiRefresh, BiRightArrowAlt } from "react-icons/bi"

function stateClass(item: SetupCheckItem) {
  if (item.state === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
  if (item.state === "error") return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
  return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
}

function ChecklistItem({ item }: { item: SetupCheckItem }) {
  return (
    <div className="flex min-h-[104px] flex-col justify-between rounded-lg border border-slate-200/80 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {item.done ? <BiCheckCircle className="text-emerald-500" /> : <BiErrorCircle className="text-amber-500" />}
            <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{item.title}</p>
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground" title={item.detail}>{item.detail}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${stateClass(item)}`}>
          {item.done ? "完成" : "待处理"}
        </span>
      </div>
      {!item.done ? (
        <Button asChild variant="outline" size="sm" className="mt-3 self-start">
          <Link href={item.href}>
            {item.actionLabel}
            <BiRightArrowAlt />
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

export default function SetupChecklist() {
  const [result, setResult] = useState<SetupChecklistResult | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setResult(await loadSetupChecklist())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const completedCount = useMemo(() => result?.items.filter((item) => item.done).length ?? 0, [result])
  const totalCount = result?.items.length ?? 6

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg">投递前配置完整度</CardTitle>
          <CardDescription>{loading ? "正在检查投递前准备项" : `已完成 ${completedCount}/${totalCount} 项`}</CardDescription>
        </div>
        <Button onClick={load} size="sm" variant="outline" disabled={loading}>
          {loading ? <BiLoaderAlt className="animate-spin" /> : <BiRefresh />}
          刷新
        </Button>
      </CardHeader>
      <CardContent>
        {loading && !result ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-[104px] animate-pulse rounded-lg bg-slate-100 dark:bg-white/5" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(result?.items || []).map((item) => (
              <ChecklistItem key={item.key} item={item} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
