'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import BossPage from '@/app/boss/BossWorkspace'
import ZhilianPage from '@/app/zhilian/ZhilianWorkspace'
import ZhilianAnalysisPage from '@/app/zhilian/analysis/ZhilianResults'
import { confirmNavigation } from '@/lib/use-unsaved-changes'
import { readWorkspaceQuery, workspaceHref, type DiscoverPlatform, type DiscoverView } from './workspace-query'

const views: Array<{ value: DiscoverView; title: string; description: string }> = [
  { value: 'setup', title: '搜索条件', description: '设置关键词与平台筛选' },
  { value: 'task', title: '采集任务', description: '查看进度、暂停与继续' },
  { value: 'results', title: '岗位结果', description: '审核匹配并确认投递' },
]

function DiscoverWorkspace() {
  const router = useRouter()
  const search = useSearchParams()
  const params = new URLSearchParams(search.toString())
  const { platform, view, scanRunId } = readWorkspaceQuery(params)
  const navigate = (nextPlatform: DiscoverPlatform, nextView: DiscoverView) => {
    if (nextPlatform === platform && nextView === view) return
    if (nextPlatform === platform || confirmNavigation()) router.push(workspaceHref(params, nextPlatform, nextView))
  }
  const changeScope = (runId: string, profileId?: number, nextView: DiscoverView = 'results') => {
    const next = new URLSearchParams(params)
    if (runId) next.set('scanRunId', runId)
    else next.delete('scanRunId')
    if (profileId) next.set('profileId', String(profileId))
    router.replace(workspaceHref(next, platform, nextView))
  }
  const changeView = (nextView: DiscoverView) => router.replace(workspaceHref(params, platform, nextView))

  return <div className="min-w-0 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-1 text-sm text-muted-foreground">寻找下一份机会</p><h1 className="text-2xl font-semibold tracking-tight">岗位发现</h1><p className="mt-2 text-sm text-muted-foreground">先设置搜索条件，再采集岗位；岗位结果与历史记录随时可查看。</p></div>
      <div className="flex rounded-lg border bg-background p-1" aria-label="选择招聘平台">
        <Button variant={platform === 'boss' ? 'default' : 'ghost'} onClick={() => navigate('boss', view)}>BOSS 直聘</Button>
        <Button variant={platform === 'zhilian' ? 'default' : 'ghost'} onClick={() => navigate('zhilian', view)}>智联招聘</Button>
      </div>
    </header>
    <nav className="grid grid-cols-3 gap-2 rounded-xl border bg-background p-2" aria-label="岗位工作区">
      {views.map(item => <button key={item.value} type="button" aria-current={view === item.value ? 'page' : undefined} onClick={() => navigate(platform, item.value)} className={`rounded-lg px-3 py-3 text-left transition-colors ${view === item.value ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}>
        <span className="block text-sm font-semibold">{item.title}</span><span className="mt-1 hidden text-xs md:block">{item.description}</span>
      </button>)}
    </nav>
    {platform === 'boss' ? <BossPage workspaceView={view} onWorkspaceViewChange={changeView} requestedScanRunId={scanRunId} onWorkspaceScopeChange={changeScope} /> : <>
      <div hidden={view === 'results'}><ZhilianPage workspaceView={view === 'results' ? 'task' : view} onWorkspaceViewChange={changeView} onWorkspaceScopeChange={changeScope} /></div>
      {view === 'results' && <ZhilianAnalysisPage workspace />}
    </>}
  </div>
}

export default function DiscoverPage() {
  return <Suspense fallback={<p role="status">正在加载岗位工作区…</p>}><DiscoverWorkspace /></Suspense>
}
