'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { BossJob, JobAnalysisTask } from '../types'
import { badgeClass, canManualDeliverAiNotMatch, deliveryStatusLabel, failureReasonText, formatAiReasonDetail, parseAiReason } from '../utils'

export function BossCompactRows({ items, loaded = true, loading = false, error = '', actingJobId, actingManualBatch, selectedManualJobIds, analysisTaskByJobId, retryingAnalysisTaskId, onOpenText, onConfirmJob, onReconcileJob, onRetryJob, onRetryAnalysisJob, onSkipJob, onToggleManualJob }: {
  loaded?: boolean; loading?: boolean; error?: string;
  items: BossJob[]; actingJobId: number | null; actingManualBatch: boolean; selectedManualJobIds: ReadonlySet<number>; analysisTaskByJobId: ReadonlyMap<number, JobAnalysisTask>; retryingAnalysisTaskId: number | null;
  onOpenText: (title: string, content?: string) => void; onConfirmJob: (job: BossJob) => void; onReconcileJob: (job: BossJob) => void; onRetryJob: (job: BossJob) => void; onRetryAnalysisJob: (job: BossJob) => void; onSkipJob: (job: BossJob) => void; onToggleManualJob: (id: number, checked: boolean) => void;
}) {
  const [detail, setDetail] = useState<BossJob | null>(null)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!detail) return
    const previous = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetail(null)
      if (event.key !== 'Tab') return
      const controls = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]')
      if (!controls?.length) return
      const first = controls[0]; const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [detail])

  return <>
    <div className="hidden grid-cols-[2fr_1.2fr_1.4fr_1fr_1.3fr] gap-4 border-b px-4 py-3 text-xs font-medium text-muted-foreground xl:grid" aria-hidden="true"><span>岗位与公司</span><span>薪资与地点</span><span>AI 匹配</span><span>处理状态</span><span>操作</span></div>
    <div className="divide-y rounded-xl border" aria-label="BOSS 岗位列表">
      {items.length === 0 ? <p role={loading || (!loaded && !error) ? 'status' : undefined} className="px-4 py-12 text-center text-sm text-muted-foreground">{loading ? '正在读取岗位…' : error ? '岗位读取失败，请重新加载。' : !loaded ? '正在读取岗位…' : '当前范围没有岗位。可调整筛选、查看全部岗位，或到采集任务检查进度。'}</p> : items.map(job => {
        const task = analysisTaskByJobId.get(job.id)
        const reason = parseAiReason(job.aiReason)
        return <article key={job.id} className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-[2fr_1.2fr_1.4fr_1fr_1.3fr]">
          <div className="min-w-0"><div className="flex items-start gap-3">
            {job.deliveryStatus === 'AI不匹配' && <input type="checkbox" className="mt-1 shrink-0" aria-label={`选择 ${job.companyName || ''} ${job.jobName || ''}`} checked={canManualDeliverAiNotMatch(job) && selectedManualJobIds.has(job.id)} disabled={!canManualDeliverAiNotMatch(job) || actingManualBatch} onChange={event => onToggleManualJob(job.id, event.target.checked)} />}
            <div className="min-w-0"><button type="button" className="text-left font-semibold text-foreground hover:text-primary" onClick={() => setDetail(job)}>{job.jobName || '未命名岗位'}</button><p className="mt-1 break-words text-sm text-muted-foreground">{job.companyName || '公司未提供'}</p>{job.scanResultSource === 'HISTORICAL_REUSED' && <span className="mt-2 inline-block text-xs text-amber-700">历史结果</span>}</div>
          </div></div>
          <div className="text-sm"><p className="font-semibold">{job.salary || '薪资待核实'}</p><p className="mt-1 text-muted-foreground">{[job.location, job.experience, job.degree].filter(Boolean).join(' · ') || '要求待核实'}</p></div>
          <div className="min-w-0 text-sm"><p className="font-medium">{job.aiScore == null ? '尚未分析' : `${job.aiScore} 分`} <span className="font-normal text-muted-foreground">{job.aiDecision || ''}</span></p><button type="button" className="mt-1 line-clamp-3 text-left text-xs leading-5 text-muted-foreground hover:text-primary" onClick={() => onOpenText('AI分析详情', formatAiReasonDetail(job.aiReason))}>{reason.summary || '查看匹配依据'}</button></div>
          <div><span className={badgeClass('delivery', job.deliveryStatus)}>{deliveryStatusLabel(job.deliveryStatus)}</span>{failureReasonText(job) && failureReasonText(job) !== '-' && <p className="mt-2 line-clamp-3 text-xs text-destructive">{failureReasonText(job)}</p>}</div>
          <div className="flex flex-wrap items-start gap-2">
            {['待确认', '投递确认中'].includes(job.deliveryStatus || '') && <Button size="sm" disabled={actingJobId === job.id} onClick={() => onConfirmJob(job)}>{job.deliveryStatus === '投递确认中' ? '恢复' : '审核并发送'}</Button>}
            {job.deliveryStatus === '待确认' && <Button size="sm" variant="outline" disabled={actingJobId === job.id} onClick={() => onSkipJob(job)}>跳过</Button>}
            {job.deliveryStatus === '投递结果待确认' && <Button size="sm" variant="outline" disabled={actingJobId === job.id} onClick={() => onReconcileJob(job)}>对账</Button>}
            {['投递结果待确认', '投递失败'].includes(job.deliveryStatus || '') && <Button size="sm" variant="outline" disabled={actingJobId === job.id} onClick={() => onRetryJob(job)}>显式重试</Button>}
            {job.deliveryStatus === 'AI分析失败' && <Button size="sm" variant="outline" disabled={!task || !['FAILED', 'UNKNOWN'].includes(task.status) || retryingAnalysisTaskId === task.id} onClick={() => onRetryAnalysisJob(job)}>重试分析</Button>}
            <Button size="sm" variant="ghost" onClick={() => setDetail(job)}>详情</Button>
          </div>
        </article>
      })}
    </div>
    {detail && <div className="fixed inset-0 z-50 bg-black/40" onMouseDown={event => { if (event.target === event.currentTarget) setDetail(null) }}>
      <aside ref={panel} role="dialog" aria-modal="true" aria-label="岗位详情" className="absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto border-l bg-background p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">{detail.jobName || '岗位详情'}</h2><p className="mt-2 text-sm text-muted-foreground">{detail.companyName}</p></div><Button variant="outline" onClick={() => setDetail(null)}>关闭</Button></div>
        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">{[['薪资', detail.salary], ['地点', detail.location], ['经验 / 学历', [detail.experience, detail.degree].filter(Boolean).join(' / ')], ['HR', [detail.hrName, detail.hrPosition].filter(Boolean).join(' · ')], ['公司规模', detail.companyScale], ['行业', detail.industry], ['公司地址', detail.companyAddress], ['融资阶段', detail.financingStage]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{value || '未提供'}</dd></div>)}</dl>
        {detail.jobUrl && <a href={detail.jobUrl} target="_blank" rel="noreferrer" className="mt-6 inline-block text-sm font-medium text-primary">打开平台原岗位 ↗</a>}
        <section className="mt-6"><h3 className="font-semibold">完整匹配依据</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-7">{formatAiReasonDetail(detail.aiReason)}</p></section>
        <section className="mt-6"><h3 className="font-semibold">岗位描述</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-7">{detail.jobDescription || '暂无完整描述，请查看平台原岗位。'}</p></section>
        <section className="mt-6"><h3 className="font-semibold">公司介绍</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-7">{detail.introduce || '未提供'}</p></section>
      </aside>
    </div>}
  </>
}
