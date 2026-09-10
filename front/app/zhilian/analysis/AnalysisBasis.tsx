"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { API_BASE } from "@/lib/api"
import { Button } from "@/components/ui/button"

type Basis = { sourceFilename: string; resumeUpdatedAt: string; resumeText: string; keywords: string; introduce: string; introduceUpdatedAt: string; applyThreshold: number }

export default function AnalysisBasis({ profileId }: { profileId: number }) {
  const [basis, setBasis] = useState<Basis | null>(null)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => { setBasis(null); setError(""); setRevision(value => value + 1) }, [])
  useEffect(() => {
    let active = true
    const read = async () => {
      const response = await fetch(`${API_BASE}/api/zhilian/analysis-basis?profileId=${profileId}`, { cache: "no-store" })
      const value = await response.json()
      if (!response.ok || value.success === false) throw new Error(value.message || "匹配依据暂时读取失败，请重试。")
      if (value.profileId !== profileId) throw new Error("档案已变化，请刷新后核对匹配依据。")
      return value as Basis
    }
    void read().then(value => { if (active) setBasis(value) })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "读取匹配依据失败。") })
    return () => { active = false }
  }, [profileId, revision])
  useEffect(() => {
    window.addEventListener("focus", refresh)
    return () => window.removeEventListener("focus", refresh)
  }, [refresh])

  return <section aria-label="匹配依据" className="rounded-xl border bg-muted/20 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">匹配依据</h2>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={refresh}>刷新依据</Button><Button asChild size="sm" variant="outline"><Link href="/ai-config">检查简历与求职意向</Link></Button><Button asChild size="sm" variant="outline"><Link href="/zhilian">调整扫描关键词</Link></Button></div>
    </div>
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : !basis ? <p className="mt-3 text-sm">正在读取当前档案的匹配依据…</p> : <>
      <div className="mt-4 grid gap-4 text-sm lg:grid-cols-2">
        <div><p className="text-muted-foreground">当前保存的简历</p><p className="mt-1 break-words font-medium">{basis.resumeText ? (basis.sourceFilename || "手动保存的简历") : "尚未保存简历"}</p><p className="mt-1 text-muted-foreground">{basis.resumeText.length} 字{basis.resumeUpdatedAt ? ` · 更新于 ${basis.resumeUpdatedAt.replace("T", " ")}` : ""}</p></div>
        <div><p className="text-muted-foreground">下次扫描使用的关键词</p><p className="mt-1 break-words leading-6">{basis.keywords || "尚未配置，请先设置目标岗位关键词。"}</p></div>
      </div>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">官网按关键词返回候选岗位，AI 再结合本地保存的完整简历和技能介绍分析。匹配分是能力证据评分，不等于求职意愿；请在简历中写明目标方向及不考虑的岗位。修改简历、技能介绍或关键词不会自动重算历史岗位分数，历史记录也未保存可核验的简历版本。</p>
      <p className="mt-2 text-sm text-muted-foreground">当前普通公司确认阈值：{basis.applyThreshold} 分。未知信息仍按该维度的 60% 计分；是否愿意投递请结合方向和风险核对。</p>
      <details className="mt-3 text-sm"><summary className="cursor-pointer text-primary">查看当前技能介绍{basis.introduceUpdatedAt ? `（${basis.introduceUpdatedAt.replace("T", " ")} 更新）` : ""}</summary><p className="mt-3 whitespace-pre-wrap leading-7">{basis.introduce || "尚未填写技能介绍"}</p></details>
      {basis.resumeText && <details className="mt-3 text-sm"><summary className="cursor-pointer text-primary">查看当前保存的简历文本</summary><div className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border bg-background p-4 leading-7">{basis.resumeText}</div></details>}
    </>}
  </section>
}
