'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { interviewStatuses, interviewTime, loadInterviews, type Interview } from '@/lib/interviews'
import InterviewForm from './InterviewForm'

export default function OpportunityInterviews({ opportunityId, version, onSaved }: { opportunityId: number; version: number; onSaved: () => void }) {
  const [items, setItems] = useState<Interview[] | null>(null)
  const [editing, setEditing] = useState<Interview | 'new' | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    loadInterviews(opportunityId, 1, 100, controller.signal).then(result => { if (!controller.signal.aborted) setItems(result.items) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [opportunityId])
  return <section className="space-y-3 border-t pt-4" aria-label="面试轮次">
    <h3 className="font-medium">面试轮次</h3>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {items === null && !error && <p className="text-sm">正在读取面试记录…</p>}
    {items?.length === 0 && <p className="text-sm text-muted-foreground">尚未安排面试，收到邀请后可以先记录为待安排。</p>}
    {items?.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"><p className="text-sm">第 {item.round_number} 轮 · {interviewStatuses[item.status]} · {interviewTime(item)}</p><Button variant="outline" onClick={() => setEditing(item)}>修改第 {item.round_number} 轮</Button></div>)}
    {items && items.length < 100 && <Button variant="outline" onClick={() => setEditing('new')}>新增面试轮次</Button>}
    {editing && <InterviewForm key={typeof editing === 'string' ? 'new' : `${editing.id}:${editing.version}`} opportunityId={opportunityId} opportunityVersion={version} initial={typeof editing === 'string' ? undefined : editing} nextRound={Array.from({ length: 100 }, (_, i) => i + 1).find(round => !items?.some(item => item.round_number === round)) || 1} onSaved={onSaved} onClose={() => setEditing(null)} />}
  </section>
}
