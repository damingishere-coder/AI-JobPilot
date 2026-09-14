'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import ProfileSwitcher from '@/app/components/ProfileSwitcher'
import { Button } from '@/components/ui/button'
import { opportunityApi, stages, applicationStatuses, type Opportunity, type OpportunityDetail } from '@/lib/opportunities'
import OpportunityEditor from './OpportunityEditor'

export default function OpportunitiesPage() {
  return <Suspense fallback={<p className="p-6">正在加载机会…</p>}><OpportunityWorkspace /></Suspense>
}

function OpportunityWorkspace() {
  const params = useSearchParams()
  const selectedId = Number(params.get('id')) || null
  const archived = params.get('archived') === 'true'
  const stage = params.get('stage') || ''
  const bucket = params.get('bucket') || ''
  const page = Math.max(1, Math.min(10001, Number(params.get('page')) || 1))
  const [profileId, setProfileId] = useState<number | null>(null)
  const [rows, setRows] = useState<Opportunity[]>([])
  const [total, setTotal] = useState(0)
  const [detail, setDetail] = useState<OpportunityDetail | null>(null)
  const [scopeLabel, setScopeLabel] = useState('')
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const changeProfile = useCallback((profile: { id: number } | null) => {
    setProfileId(profile?.id ?? null); setRows([]); setDetail(null)
  }, [])
  useEffect(() => {
    if (!profileId) return
    const controller = new AbortController()
    // The loading flag belongs to this abortable server request, not a derived render value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setError(''); setDetail(null)
    Promise.all([
      opportunityApi<{ items: Opportunity[]; total: number; scopeLabel?: string }>(`?archived=${archived}&stage=${encodeURIComponent(stage)}&page=${page}&bucket=${encodeURIComponent(bucket)}`, undefined, controller.signal),
      selectedId ? opportunityApi<OpportunityDetail>(`/${selectedId}`, undefined, controller.signal) : Promise.resolve(null),
    ]).then(([list, selected]) => {
      if (controller.signal.aborted) return
      setRows(list.items); setTotal(list.total); setDetail(selected); setScopeLabel(list.scopeLabel || '')
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [profileId, archived, stage, bucket, page, selectedId, revision])
  function navigate(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    Object.entries(changes).forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key) })
    window.history.pushState(null, '', `/opportunities${next.size ? `?${next}` : ''}`)
  }
  function select(id: number | null) {
    navigate({ id: id ? String(id) : null })
  }
  return <main className="mx-auto max-w-6xl space-y-6 p-6">
    <div><h1 className="text-2xl font-semibold">求职机会</h1><p className="mt-2 text-sm text-muted-foreground">保留岗位、投递记录与求职阶段。修改阶段仅记录事实，不会发送消息或执行投递。</p></div>
    <ProfileSwitcher onProfileChange={changeProfile} />
    <div className="flex flex-wrap items-center gap-3">
      <Button variant={archived ? 'outline' : 'default'} onClick={() => navigate({ archived: null, page: null, bucket: null })}>当前机会</Button>
      <Button variant={archived ? 'default' : 'outline'} onClick={() => navigate({ archived: 'true', page: null, bucket: null })}>已归档</Button>
      <select aria-label="求职阶段筛选" className="rounded border bg-background p-2" value={stage} onChange={e => navigate({ stage: e.target.value, page: null, bucket: null })}>
        <option value="">全部阶段</option>{Object.entries(stages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <Button variant="outline" onClick={() => setRevision(v => v + 1)}>刷新</Button>
      <span className="text-sm text-muted-foreground">当前档案 · {scopeLabel || '全部机会'} · {total} 个机会</span>
      {bucket && <Button variant="outline" onClick={() => navigate({ bucket: null, page: null })}>清除事项筛选</Button>}
    </div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {loading && <p role="status">正在加载…</p>}
    {detail && <OpportunityEditor key={`${detail.id}:${detail.version}`} detail={detail} onClose={() => select(null)} onSaved={() => setRevision(v => v + 1)} />}
    {!loading && !error && rows.length === 0 && <p className="rounded border p-6">此范围暂无机会。可前往 <Link className="underline" href="/boss">BOSS</Link> 或 <Link className="underline" href="/zhilian">智联</Link> 发现岗位。</p>}
    <div className="grid gap-3 md:grid-cols-2">{rows.map(row => <button key={row.id} className="space-y-2 rounded-xl border p-4 text-left hover:bg-muted" onClick={() => select(row.id)}>
      <p className="font-medium">{row.job_name || '历史岗位名称未知'}</p><p className="text-sm">{row.company_name || '公司未知'} · {row.platform}</p>
      <p className="text-sm">阶段：{stages[row.stage]} · 投递：{applicationStatuses[row.application_status || 'NOT_REQUESTED']}</p>
    </button>)}</div>
    <div className="flex items-center gap-3"><Button variant="outline" disabled={loading || page <= 1} onClick={() => navigate({ page: String(page - 1) })}>上一页</Button><span>第 {page} 页</span><Button variant="outline" disabled={loading || page * 20 >= total} onClick={() => navigate({ page: String(page + 1) })}>下一页</Button></div>
  </main>
}
