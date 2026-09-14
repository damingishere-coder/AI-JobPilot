'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ProfileSwitcher from '@/app/components/ProfileSwitcher'
import { Button } from '@/components/ui/button'
import { strategyApi, type StrategySnapshot } from '@/lib/strategy'
import StrategyReport from './StrategyReport'

type SnapshotList = { profileId: number; items: { id: number; window_days: number; cutoff: string }[] }
export default function StrategyPage() {
  const [profileId, setProfileId] = useState<number | null>(null)
  const [snapshots, setSnapshots] = useState<SnapshotList['items']>([])
  const [snapshot, setSnapshot] = useState<StrategySnapshot | null>(null)
  const [windowDays, setWindowDays] = useState(90)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState<{ days: number; key: string } | null>(null)
  const activeProfile = useRef<number | null>(null)
  const profileChanged = useCallback((profile: { id: number } | null) => { activeProfile.current = profile?.id ?? null; setProfileId(profile?.id ?? null); setSnapshot(null); setSnapshots([]); setPending(null); setBusy(false) }, [])
  useEffect(() => {
    if (!profileId) return
    const controller = new AbortController()
    strategyApi<SnapshotList>('/snapshots', undefined, controller.signal).then(async list => {
      if (controller.signal.aborted) return
      if (list.profileId !== profileId) throw new Error('档案已在其他窗口改变，请刷新档案列表')
      setSnapshots(list.items)
      const first = list.items[0]
      const selected = first ? await strategyApi<StrategySnapshot>(`/snapshots/${first.id}`, undefined, controller.signal) : null
      if (selected && selected.profile_id !== profileId) throw new Error('快照与当前档案不一致，请刷新')
      if (!controller.signal.aborted) { setSnapshot(selected); setError('') }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [profileId, revision])
  async function run(action: () => Promise<StrategySnapshot>) {
    const owner = activeProfile.current
    setBusy(true); setError('')
    try { const value = await action(); if (activeProfile.current !== owner) return; if (value.profile_id !== owner) throw new Error('返回数据的档案已改变，请刷新'); setSnapshot(value) }
    catch (e) { if (activeProfile.current === owner) setError(e instanceof Error ? e.message : '策略操作失败') }
    finally { if (activeProfile.current === owner) setBusy(false) }
  }
  async function create() {
    const command = pending?.days === windowDays ? pending : { days: windowDays, key: crypto.randomUUID() }
    setPending(command)
    await run(async () => { const value = await strategyApi<StrategySnapshot>('/snapshots', { windowDays, requestKey: command.key }); if (activeProfile.current === value.profile_id) { setPending(null); setSnapshots(items => [{ id: value.id, window_days: value.window_days, cutoff: value.cutoff }, ...items.filter(i => i.id !== value.id)].slice(0, 20)) } return value })
  }
  return <main className="mx-auto max-w-6xl space-y-5 p-6">
    <h1 className="text-2xl font-semibold">求职策略</h1><p className="text-sm text-muted-foreground">根据真实反馈复盘下一步方向。统计在本机完成，生成快照不会调用 AI。</p>
    <ProfileSwitcher onProfileChange={profileChanged} />
    <div className="flex flex-wrap gap-3"><label>统计窗口<select disabled={busy} className="ml-2 rounded border bg-background p-2" value={windowDays} onChange={e => setWindowDays(Number(e.target.value))}><option value={90}>最近 90 天</option><option value={30}>最近 30 天</option></select></label><Button disabled={busy || !profileId} onClick={create}>生成本地统计快照</Button><Button variant="outline" disabled={busy} onClick={() => setRevision(v => v + 1)}>刷新已有快照</Button></div>
    {snapshots.length > 0 && <label className="block">查看快照<select disabled={busy} className="ml-2 rounded border bg-background p-2" value={snapshot?.id || ''} onChange={e => run(() => strategyApi<StrategySnapshot>(`/snapshots/${e.target.value}`))}><option value="" disabled>选择快照</option>{snapshots.map(item => <option key={item.id} value={item.id}>#{item.id} · {item.window_days} 天 · {new Date(item.cutoff).toLocaleString('zh-CN')}</option>)}</select></label>}
    {busy && <p role="status">正在处理统计…</p>}{error && <p role="alert" className="text-red-600">{error}</p>}
    {!snapshot && !error && <p className="rounded border p-5 text-muted-foreground">尚未展示统计快照。新数据不会自动改写旧结论，可主动生成一次本地统计。</p>}
    {snapshot && <StrategyReport key={snapshot.id} snapshot={snapshot} busy={busy} onDecide={(insightId, decision) => run(() => strategyApi(`/snapshots/${snapshot.id}/decision`, { version: snapshot.version, insightId, decision }))} />}
  </main>
}
