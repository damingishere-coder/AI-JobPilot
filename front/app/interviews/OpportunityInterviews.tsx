'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { interviewStatuses, interviewTime, loadInterviews, type Interview } from '@/lib/interviews'
import InterviewForm from './InterviewForm'
import { confirmNavigation } from '@/lib/use-unsaved-changes'

export default function OpportunityInterviews({ opportunityId, version, onSaved }: { opportunityId: number; version: number; onSaved: () => void | Promise<void> }) {
  const [items, setItems] = useState<Interview[] | null>(null)
  const [editing, setEditing] = useState<Interview | 'new' | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    loadInterviews(opportunityId, 1, 100, controller.signal).then(result => { if (!controller.signal.aborted) { setItems(result.items); setError('') } })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [opportunityId, version, revision])
  return <section className="space-y-3 border-t pt-4" aria-label="面试轮次">
    <h3 className="font-medium">面试轮次</h3>
    {error && <div role="alert" className="text-red-600">{error}<Button className="ml-3" variant="outline" onClick={() => setRevision(value => value + 1)}>重试读取面试</Button></div>}
    {items === null && !error && <p className="text-sm">正在读取面试记录…</p>}
    {items?.length === 0 && <p className="text-sm text-muted-foreground">尚未安排面试，收到邀请后可以先记录为待安排。</p>}
    {items?.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"><p className="text-sm">第 {item.round_number} 轮 · {interviewStatuses[item.status]} · {interviewTime(item)}</p><Button variant="outline" onClick={() => { if (!editing || confirmNavigation()) setEditing(item) }}>修改第 {item.round_number} 轮</Button></div>)}
    {items && items.length < 100 && <Button variant="outline" onClick={() => { if (!editing || confirmNavigation()) setEditing('new') }}>新增面试轮次</Button>}
    {editing && <InterviewForm key={typeof editing === 'string' ? 'new' : String(editing.id)} opportunityId={opportunityId} opportunityVersion={version} initial={typeof editing === 'string' ? undefined : editing} nextRound={Array.from({ length: 100 }, (_, i) => i + 1).find(round => !items?.some(item => item.round_number === round)) || 1} onSaved={async () => { await onSaved(); setEditing(null) }} onClose={() => { if (confirmNavigation()) setEditing(null) }} />}
  </section>
}
