'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import ProfileSwitcher from '@/app/components/ProfileSwitcher'
import { Button } from '@/components/ui/button'
import { interviewModes, interviewPreparation, interviewStatuses, interviewTime, loadInterviews, type Interview } from '@/lib/interviews'
import InterviewForm from './InterviewForm'

export default function InterviewsPage() {
  const [profileId, setProfileId] = useState<number | null>(null)
  const [items, setItems] = useState<Interview[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState<Interview | null>(null)
  const [error, setError] = useState('')
  const [observedAt, setObservedAt] = useState(0)
  const profileChanged = useCallback((profile: { id: number } | null) => { setProfileId(profile?.id ?? null); setItems(null); setEditing(null); setPage(1) }, [])
  useEffect(() => {
    if (!profileId) return
    const controller = new AbortController()
    loadInterviews(undefined, page, 20, controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (result.profileId !== profileId) throw new Error('档案已在其他窗口改变，请刷新档案列表')
      setItems(result.items); setTotal(result.total); setError(''); setObservedAt(Date.now())
    }).catch(e => { if (!controller.signal.aborted) { setError(e.message); setItems(null) } })
    return () => controller.abort()
  }, [profileId, page, revision])
  return <main className="mx-auto max-w-5xl space-y-5 p-6">
    <h1 className="text-2xl font-semibold">面试与准备</h1>
    <p className="text-sm text-muted-foreground">每轮独立记录，时间按记录的时区显示。请在对应求职机会中新增轮次；收到邀请仍需双方确认时间。</p>
    <ProfileSwitcher onProfileChange={profileChanged} />
    <div className="flex gap-3"><Button asChild variant="outline"><Link href="/opportunities">选择求职机会</Link></Button><Button variant="outline" onClick={() => { setEditing(null); setRevision(v => v + 1) }}>刷新面试</Button></div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {!items && !error && <p>正在读取面试记录…</p>}
    {items?.length === 0 && <p className="rounded border p-6 text-muted-foreground">当前档案尚无面试记录。</p>}
    {items?.map(item => <article key={item.id} className="space-y-3 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{item.job_name || '历史岗位'} · 第 {item.round_number} 轮</h2><p className="text-sm text-muted-foreground">{item.company_name} · {interviewModes[item.mode]} · {interviewStatuses[item.status]}</p></div><Button variant="outline" onClick={() => setEditing(item)}>编辑第 {item.round_number} 轮</Button></div>
      <p>{interviewTime(item)}</p>
      {item.status === 'SCHEDULED' && item.scheduled_at && new Date(item.scheduled_at).getTime() < observedAt && <p className="text-sm text-amber-700">时间已过，请核实是否完成或需要改期。</p>}
      <p className="text-sm text-muted-foreground">准备清单：{item.preparation.length} / {Object.keys(interviewPreparation).length} 项</p>
      <Link className="text-sm underline" href={`/opportunities?id=${item.opportunity_id}`}>查看岗位与时间线{item.archived ? '（已归档）' : ''}</Link>
      {editing?.id === item.id && <InterviewForm key={`${item.id}:${item.version}`} opportunityId={item.opportunity_id} opportunityVersion={item.opportunity_version} initial={item} onSaved={() => { setEditing(null); setRevision(v => v + 1) }} onClose={() => setEditing(null)} />}
    </article>)}
    {items && <div className="flex items-center gap-3"><Button variant="outline" disabled={page === 1} onClick={() => { setEditing(null); setPage(v => v - 1) }}>上一页</Button><span>第 {page} 页 · {total} 轮面试</span><Button variant="outline" disabled={page * 20 >= total} onClick={() => { setEditing(null); setPage(v => v + 1) }}>下一页</Button></div>}
  </main>
}
