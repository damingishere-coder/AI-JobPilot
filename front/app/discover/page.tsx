'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { readWorkspaceQuery } from './workspace-query'

function LegacyPlatformEntry() {
  const router = useRouter()
  const search = useSearchParams().toString()
  useEffect(() => {
    const params = new URLSearchParams(search)
    const { platform, view } = readWorkspaceQuery(params)
    params.delete('platform')
    params.delete('view')
    const path = `/${platform}${view === 'results' ? '/analysis' : ''}`
    router.replace(`${path}${params.size ? `?${params}` : ''}`)
  }, [router, search])
  return <p role="status">正在返回原平台页面…</p>
}

export default function DiscoverPage() {
  return <Suspense fallback={<p role="status">正在返回原平台页面…</p>}><LegacyPlatformEntry /></Suspense>
}
