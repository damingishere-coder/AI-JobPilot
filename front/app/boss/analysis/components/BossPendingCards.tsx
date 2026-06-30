"use client"

import { BiBlock, BiBriefcase, BiCheckCircle, BiChevronDown, BiChevronUp, BiFilterAlt, BiLinkExternal, BiX } from "react-icons/bi"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { BossJob } from "../types"
import { riskTextOf } from "../utils"

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

export function BossPendingCards({
  itemsLength,
  loadingList,
  pendingJobs,
  visiblePendingJobs,
  pendingCardsExpanded,
  actingJobId,
  blacklistingJobId,
  actingAiBatch,
  actingBatch,
  onToggleExpanded,
  onResetToPendingFilters,
  onConfirmAiRecommendedBatch,
  onOpenText,
  onConfirmJob,
  onSkipJob,
  onBlacklistCompany,
}: {
  itemsLength: number
  loadingList: boolean
  pendingJobs: BossJob[]
  visiblePendingJobs: BossJob[]
  pendingCardsExpanded: boolean
  actingJobId: number | null
  blacklistingJobId: number | null
  actingAiBatch: boolean
  actingBatch: boolean
  onToggleExpanded: () => void
  onResetToPendingFilters: () => void
  onConfirmAiRecommendedBatch: () => void
  onOpenText: (title: string, content?: string) => void
  onConfirmJob: (job: BossJob) => void
  onSkipJob: (job: BossJob) => void
  onBlacklistCompany: (job: BossJob) => void
}) {
  return (
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
            <Button size="sm" variant="outline" onClick={onToggleExpanded}>
              {pendingCardsExpanded ? <BiChevronUp className="mr-1" /> : <BiChevronDown className="mr-1" />}
              {pendingCardsExpanded ? "收起，只留 2 个" : `展开全部 ${pendingJobs.length} 个`}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onResetToPendingFilters}>
            <BiFilterAlt className="mr-1" /> 只看待确认
          </Button>
          <Button size="sm" variant="success" onClick={onConfirmAiRecommendedBatch} disabled={actingAiBatch || actingBatch}>
            <BiBriefcase className="mr-1" /> {actingAiBatch ? "投递中..." : "一键投递AI推荐"}
          </Button>
        </div>
      </div>

      {loadingList && itemsLength === 0 ? (
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
              onOpenText={onOpenText}
              onConfirm={() => onConfirmJob(job)}
              onSkip={() => onSkipJob(job)}
              onBlacklist={() => onBlacklistCompany(job)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
