'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { workspaceHref, type DiscoverPlatform, type DiscoverView } from './workspace-query'

export function WorkspaceEntryLink({ platform, view }: { platform: DiscoverPlatform; view: DiscoverView }) {
  const search = useSyncExternalStore(subscribeLocation, () => window.location.search, () => '')
  const href = workspaceHref(new URLSearchParams(search), platform, view)
  return <p className="text-sm text-muted-foreground"><Link className="font-medium text-primary hover:underline" href={href}>进入统一岗位工作区</Link><span className="ml-2">原入口保留，可继续查看任务与历史结果。</span></p>
}

function subscribeLocation(notify: () => void) { window.addEventListener('popstate', notify); return () => window.removeEventListener('popstate', notify) }
