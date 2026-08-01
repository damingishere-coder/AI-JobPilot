"use client"

import { BiBriefcase, BiCheckCircle, BiLinkExternal } from "react-icons/bi"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import type { BossJob } from "../types"
import { badgeClass, canManualDeliverAiNotMatch, deliveryStatusLabel, failureReasonText, formatDateOnly } from "../utils"

export function BossJobTable({
  items,
  total,
  page,
  size,
  inputPage,
  inputSize,
  showDetailColumns,
  loadingList,
  actingJobId,
  actingManualBatch,
  selectedManualJobIds,
  onOpenText,
  onConfirmJob,
  onSkipJob,
  onLoadList,
  onInputPageChange,
  onInputSizeChange,
  onToggleManualJob,
  onToggleAllManualJobs,
  onConfirmManualBatch,
}: {
  items: BossJob[]
  total: number
  page: number
  size: number
  inputPage: number | string
  inputSize: number | string
  showDetailColumns: boolean
  loadingList: boolean
  actingJobId: number | null
  actingManualBatch: boolean
  selectedManualJobIds: ReadonlySet<number>
  onOpenText: (title: string, content?: string) => void
  onConfirmJob: (job: BossJob) => void
  onSkipJob: (job: BossJob) => void
  onLoadList: (page: number, size: number) => void
  onInputPageChange: (value: number | string) => void
  onInputSizeChange: (value: number | string) => void
  onToggleManualJob: (id: number, checked: boolean) => void
  onToggleAllManualJobs: (ids: number[], checked: boolean) => void
  onConfirmManualBatch: () => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / size))
  const manualSelectableJobs = items.filter(canManualDeliverAiNotMatch)
  const selectedManualCount = manualSelectableJobs.filter((job) => selectedManualJobIds.has(job.id)).length
  const allManualSelected = manualSelectableJobs.length > 0 && selectedManualCount === manualSelectableJobs.length
  const someManualSelected = selectedManualCount > 0 && !allManualSelected

  return (
    <>
      {manualSelectableJobs.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2 dark:border-violet-900/60 dark:bg-violet-950/20">
          <div className="text-sm">
            <span className="font-medium text-violet-800 dark:text-violet-200">人工投递 AI不匹配岗位</span>
            <span className="ml-2 text-muted-foreground">
              本页可选 {manualSelectableJobs.length} 条，已选 {selectedManualCount} 条
            </span>
          </div>
          <Button
            size="sm"
            variant="destructive"
            disabled={selectedManualCount === 0 || actingManualBatch}
            onClick={onConfirmManualBatch}
          >
            <BiBriefcase className="mr-1" />
            {actingManualBatch ? "投递中..." : `投递已选岗位${selectedManualCount > 0 ? `（${selectedManualCount}）` : ""}`}
          </Button>
        </div>
      )}

      <div className="w-full overflow-x-auto rounded-lg border border-stroke/30 dark:border-strokedark/30 shadow-sm">
        <table className={`${showDetailColumns ? "min-w-[2060px]" : "min-w-[1460px]"} w-full table-fixed bg-white dark:bg-blacksection`}>
          <thead>
            <tr className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-b-2 border-blue-200 dark:border-blue-800">
              <th className="w-[60px] px-2 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">
                <div className="inline-flex flex-col items-center gap-1" title="全选本页可人工投递的AI不匹配岗位">
                  <button
                    type="button"
                    role="checkbox"
                    aria-label="全选本页可人工投递岗位"
                    aria-checked={someManualSelected ? "mixed" : allManualSelected}
                    disabled={manualSelectableJobs.length === 0 || actingManualBatch}
                    onClick={() => onToggleAllManualJobs(
                      manualSelectableJobs.map((job) => job.id),
                      !allManualSelected,
                    )}
                    className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] leading-none transition-colors ${
                      allManualSelected || someManualSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-slate-400 bg-background text-transparent"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {allManualSelected ? "✓" : someManualSelected ? "−" : ""}
                  </button>
                  <span>选择</span>
                </div>
              </th>
              <th className="w-[72px] px-3 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">序号</th>
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
                <td colSpan={showDetailColumns ? 25 : 19} className="px-4 py-12 text-center text-muted-foreground bg-gray-50 dark:bg-gray-900/20">
                  <div className="flex flex-col items-center gap-3">
                    <BiBriefcase className="text-4xl text-gray-300 dark:text-gray-600" />
                    <p className="text-sm">当前还没有入库岗位；请查看 Boss 页进度日志里的采集数量、详情缺失和提交结果。</p>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((job, idx) => {
                const manualSelectable = canManualDeliverAiNotMatch(job)
                const aiNotMatchWithoutUrl = job.deliveryStatus === "AI不匹配" && !job.jobUrl?.trim()
                return (
                  <tr
                  key={job.id}
                  className={`group transition-colors border-b last:border-b-0 ${
                    (job.deliveryStatus || "").includes("已投递")
                      ? "border-emerald-200 bg-emerald-50/80 hover:bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30"
                      : `border-gray-200 dark:border-gray-700 ${
                          idx % 2 === 0
                            ? "bg-white dark:bg-blacksection hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
                            : "bg-gray-50/50 dark:bg-gray-900/20 hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
                        }`
                  }`}
                  >
                  <td className="px-2 py-3 text-center text-xs leading-6 align-top border-r border-gray-200 dark:border-gray-700">
                    {job.deliveryStatus === "AI不匹配" ? (
                      <button
                        type="button"
                        role="checkbox"
                        aria-label={`选择 ${job.companyName || ""} ${job.jobName || ""}`}
                        aria-checked={manualSelectable && selectedManualJobIds.has(job.id)}
                        title={aiNotMatchWithoutUrl ? "该岗位缺少详情链接，无法投递" : "选择该AI不匹配岗位进行人工投递"}
                        disabled={!manualSelectable || actingManualBatch}
                        onClick={() => onToggleManualJob(job.id, !selectedManualJobIds.has(job.id))}
                        className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] leading-none transition-colors ${
                          manualSelectable && selectedManualJobIds.has(job.id)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-slate-400 bg-background text-transparent"
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        {manualSelectable && selectedManualJobIds.has(job.id) ? "✓" : ""}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center text-xs font-medium leading-6 text-muted-foreground align-top border-r border-gray-200 dark:border-gray-700">
                    {(page - 1) * size + idx + 1}
                  </td>
                  <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                    {job.deliveryStatus === "待确认" ? (
                      <div className="flex flex-col gap-2">
                        <Button size="sm" disabled={actingJobId === job.id} onClick={() => onConfirmJob(job)} className="h-7 w-full rounded px-2 text-xs leading-none">
                          发送
                        </Button>
                        <Button size="sm" variant="outline" disabled={actingJobId === job.id} onClick={() => onSkipJob(job)} className="h-7 w-full rounded px-2 text-xs leading-none">
                          跳过
                        </Button>
                      </div>
                    ) : (job.deliveryStatus || "").includes("已投递") ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                        <BiCheckCircle className="h-3.5 w-3.5" />
                        已投递
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <TextCell title="公司名称" value={job.companyName} onOpenText={onOpenText} />
                  <TextCell title="岗位名称" value={job.jobName} onOpenText={onOpenText} />
                  <TextCell title="薪资" value={job.salary} onOpenText={onOpenText} nowrap />
                  <TextCell title="地点" value={job.location} onOpenText={onOpenText} nowrap />
                  <TextCell title="经验" value={job.experience} onOpenText={onOpenText} nowrap />
                  <TextCell title="学历" value={job.degree} onOpenText={onOpenText} nowrap />
                  <TextCell title="HR" value={job.hrName} onOpenText={onOpenText} />
                  <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                    <button className={badgeClass("delivery", job.deliveryStatus)} title={deliveryStatusLabel(job.deliveryStatus)} onClick={() => onOpenText("投递状态", deliveryStatusLabel(job.deliveryStatus))}>
                      {(job.deliveryStatus || "").includes("已投递") ? (
                        <span className="inline-flex items-center gap-1">
                          <BiCheckCircle className="h-3.5 w-3.5" />
                          已投递
                        </span>
                      ) : (
                        deliveryStatusLabel(job.deliveryStatus)
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                    <div className="line-clamp-2 cursor-pointer hover:text-primary transition-colors" title={failureReasonText(job)} onClick={() => onOpenText("失败原因", failureReasonText(job))}>{failureReasonText(job)}</div>
                  </td>
                  <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                    {job.aiScore ?? "-"}
                  </td>
                  <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                    <button className={badgeClass("delivery", job.aiDecision)} title={job.aiDecision} onClick={() => onOpenText("AI决策", job.aiDecision)}>{job.aiDecision || "-"}</button>
                  </td>
                  <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                    <div className="line-clamp-2 cursor-pointer hover:text-primary transition-colors" title={job.aiReason || "-"} onClick={() => onOpenText("AI原因", job.aiReason)}>{job.aiReason || "-"}</div>
                  </td>
                  <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                    {job.priorityCompany ? "是" : "-"}
                  </td>
                  <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                    <button className={badgeClass("recruitment", job.recruitmentStatus)} title={job.recruitmentStatus} onClick={() => onOpenText("招聘状态", job.recruitmentStatus)}>{job.recruitmentStatus || "-"}</button>
                  </td>
                  <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top border-r border-gray-200 dark:border-gray-700">
                    {job.jobUrl ? (
                      <a href={job.jobUrl} className="inline-flex items-center gap-1 text-primary underline hover:text-primary/80 transition-colors" target="_blank" rel="noreferrer">链接 <BiLinkExternal /></a>
                    ) : (
                      "-"
                    )}
                  </td>
                  {showDetailColumns && (
                    <>
                      <TextCell title="公司地址" value={job.companyAddress} onOpenText={onOpenText} />
                      <TextCell title="行业" value={job.industry} onOpenText={onOpenText} />
                      <TextCell title="公司规模" value={job.companyScale} onOpenText={onOpenText} />
                      <TextCell title="融资阶段" value={job.financingStage} onOpenText={onOpenText} />
                      <TextCell title="公司介绍" value={job.introduce} onOpenText={onOpenText} />
                      <td className="px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700">
                        <div className="line-clamp-2 cursor-pointer hover:text-primary transition-colors" title={job.jobDescription || "-"} onClick={() => onOpenText("岗位描述", job.jobDescription)}>{job.jobDescription || "-"}</div>
                      </td>
                    </>
                  )}
                  <td className="px-3 py-3 text-xs leading-6 overflow-hidden whitespace-nowrap align-top">
                    <div className="truncate cursor-pointer hover:text-primary transition-colors" title={formatDateOnly(job.createdAt) || "-"} onClick={() => onOpenText("创建时间", formatDateOnly(job.createdAt))}>{formatDateOnly(job.createdAt) || "-"}</div>
                  </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button variant="outline" onClick={() => onLoadList(Math.max(1, page - 1), size)} disabled={loadingList || page <= 1}>上一页</Button>
        <div className="text-sm">第 {page} 页 / 共 {totalPages} 页</div>
        <Button variant="outline" onClick={() => onLoadList(page + 1, size)} disabled={loadingList || page >= totalPages}>下一页</Button>
        <div className="flex items-center gap-2 ml-4">
          <Label className="text-sm">页码</Label>
          <Input
            type="number"
            value={inputPage}
            onChange={(e) => onInputPageChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const toPage = Math.max(1, Number(inputPage) || 1)
                onLoadList(toPage, size)
              }
            }}
            className="h-8 w-20"
          />
          <Label className="text-sm">每页</Label>
          <Select
            value={String(inputSize)}
            onChange={(e) => {
              const value = Number(e.target.value)
              onInputSizeChange(value)
              onLoadList(1, Math.max(1, value))
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
    </>
  )
}

function TextCell({
  title,
  value,
  nowrap,
  onOpenText,
}: {
  title: string
  value?: string
  nowrap?: boolean
  onOpenText: (title: string, content?: string) => void
}) {
  return (
    <td className={`px-3 py-3 text-xs leading-6 overflow-hidden align-top border-r border-gray-200 dark:border-gray-700 ${nowrap ? "whitespace-nowrap" : ""}`}>
      <div className="truncate cursor-pointer hover:text-primary transition-colors" title={value || "-"} onClick={() => onOpenText(title, value)}>{value || "-"}</div>
    </td>
  )
}
