'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { confirmNavigation, rememberNavigation } from '@/lib/use-unsaved-changes'
import { useProfileScope } from './ProfileScope'
import Sidebar from './Sidebar'
import ContentArea from './ContentArea'

/** Original platform navigation and layout, with the existing profile/draft guards. */
export default function AppShell({ children }: { children: ReactNode }) {
  const scope = useProfileScope()
  const pathname = usePathname()
  const [resolved, setResolved] = useState(!scope || !scope.loading)
  useEffect(() => {
    let active = true
    if (!scope?.loading) queueMicrotask(() => { if (active) setResolved(true) })
    return () => { active = false }
  }, [scope?.loading])
  useEffect(() => { rememberNavigation() }, [pathname])
  return <div className="flex min-h-screen">
    <Sidebar />
    <ContentArea>
      {scope?.error && <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950 dark:text-amber-100">{scope.error}{scope.conflicted && <><p>已暂停本页编辑和保存，避免将草稿写入其他档案。</p><button type="button" className="mt-2 rounded border border-current px-3 py-2" onClick={() => { if (confirmNavigation()) void scope.refresh(true).catch(() => {}) }}>放弃草稿并读取当前档案</button></>}</div>}
      {scope?.switching && <p role="status" className="mb-4">正在切换档案，暂时暂停页面编辑…</p>}
      {!resolved ? <p role="status">正在读取当前档案，稍后即可编辑…</p> : <div inert={scope?.conflicted || scope?.switching ? true : undefined} aria-hidden={scope?.conflicted ? true : undefined} key={`${pathname}:${scope?.current?.id || 'none'}`}>{children}</div>}
    </ContentArea>
  </div>
}
