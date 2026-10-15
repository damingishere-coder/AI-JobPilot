'use client'

import { useEffect, useState } from 'react'
import { BiRefresh, BiUserCircle } from 'react-icons/bi'
import { Button } from '@/components/ui/button'
import { API_BASE } from '@/lib/api'

export type CurrentProfile = {
  id: number
  name: string
  isActive?: number
}

type CurrentProfileBadgeProps = {
  profile?: CurrentProfile | null
  onRefresh?: () => void
  className?: string
}

export default function CurrentProfileBadge({ profile, onRefresh, className = '' }: CurrentProfileBadgeProps) {
  const [current, setCurrent] = useState<CurrentProfile | null>(profile || null)
  const [loading, setLoading] = useState(false)

  const loadCurrent = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/profiles/current`)
      const result = await response.json()
      setCurrent(result?.data || null)
      onRefresh?.()
    } catch {
      setCurrent(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setCurrent(profile || null)
  }, [profile])

  useEffect(() => {
    if (!profile) {
      loadCurrent()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/80 bg-white/80 p-3 text-sm dark:border-white/10 dark:bg-white/5 ${className}`}>
      <div className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
        <BiUserCircle className="text-lg text-blue-500" />
        <span>当前档案</span>
      </div>
      <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
        {current?.name || '未新建档案'}
      </span>
      <Button type="button" size="sm" variant="ghost" onClick={loadCurrent} disabled={loading} title="刷新当前档案">
        <BiRefresh className="mr-1" /> 刷新
      </Button>
    </div>
  )
}
