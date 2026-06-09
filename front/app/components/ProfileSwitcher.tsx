'use client'

import { useEffect, useState } from 'react'
import { BiPlus, BiRefresh, BiTrash, BiUserCircle } from 'react-icons/bi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { API_BASE } from '@/lib/api'

type ApiResponse = {
  success?: boolean
  data?: unknown
  current?: unknown
  message?: string
  impactCounts?: Record<string, number>
  totalRelatedCount?: number
  forceRequired?: boolean
}

const parseApiResponse = async (response: Response, fallback: string): Promise<ApiResponse> => {
  let result: ApiResponse | null = null
  try {
    result = await response.json()
  } catch {
    result = null
  }
  if (response.status === 404) {
    throw new Error('档案接口暂不可用，请重启后端服务后再试')
  }
  if (!response.ok || result?.success === false) {
    throw new Error(result?.message || fallback)
  }
  return result || {}
}

const parseDeleteResponse = async (response: Response, fallback: string): Promise<ApiResponse> => {
  let result: ApiResponse | null = null
  try {
    result = await response.json()
  } catch {
    result = null
  }
  if (response.status === 404) {
    throw new Error('档案接口暂不可用，请重启后端服务后再试')
  }
  if (!response.ok) {
    throw new Error(result?.message || fallback)
  }
  return result || {}
}

export type Profile = {
  id: number
  name: string
  isActive?: number
}

const impactLabels: Record<string, string> = {
  ai: 'AI配置',
  resume_profile: '简历',
  boss_config: 'Boss配置',
  zhilian_config: '智联配置',
  boss_data: 'Boss岗位',
  zhilian_data: '智联岗位',
  job_ai_analysis: 'AI分析记录',
  priority_company: '重点公司',
}

type ProfileSwitcherProps = {
  onProfileChange?: (profile: Profile) => void
  beforeSwitch?: () => boolean
  compact?: boolean
}

export default function ProfileSwitcher({ onProfileChange, beforeSwitch, compact = false }: ProfileSwitcherProps) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [currentId, setCurrentId] = useState('')
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(false)

  const loadProfiles = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/profiles`)
      const result = await parseApiResponse(response, '档案加载失败')
      const list = Array.isArray(result.data) ? result.data as Profile[] : []
      setProfiles(list)
      const current = result.current as Profile | undefined || list.find((item: Profile) => item.isActive === 1) || list[0]
      if (current?.id) {
        setCurrentId(String(current.id))
        onProfileChange?.(current)
      } else {
        setCurrentId('')
      }
    } catch (error) {
      console.error('加载档案失败:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfiles()
  }, [])

  const activateProfile = async (id: string, skipBeforeSwitch = false) => {
    if (!id || id === currentId) return
    if (!skipBeforeSwitch && beforeSwitch && !beforeSwitch()) return
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/profiles/${id}/activate`, { method: 'POST' })
      const result = await parseApiResponse(response, '档案切换失败')
      setCurrentId(id)
      await loadProfiles()
      if (result.data) {
        onProfileChange?.(result.data as Profile)
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '档案切换失败')
    } finally {
      setLoading(false)
    }
  }

  const createProfile = async () => {
    const name = newName.trim()
    if (!name) return
    if (beforeSwitch && !beforeSwitch()) return
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const result = await parseApiResponse(response, '档案创建失败')
      setNewName('')
      const created = result.data as Profile | undefined
      if (!created?.id) {
        throw new Error('档案创建成功但未返回ID，请刷新后重试')
      }
      await activateProfile(String(created.id), true)
    } catch (error) {
      alert(error instanceof Error ? error.message : '档案创建失败')
    } finally {
      setLoading(false)
    }
  }

  const formatImpactMessage = (counts?: Record<string, number>) => {
    const entries = Object.entries(counts || {}).filter(([, count]) => Number(count) > 0)
    if (entries.length === 0) return '未发现关联数据。'
    return entries
      .map(([table, count]) => `${impactLabels[table] || table}：${count}`)
      .join('\n')
  }

  const deleteProfile = async () => {
    if (!currentId || loading) return
    const current = profiles.find((profile) => String(profile.id) === currentId)
    if (!current) return
    const firstConfirm = window.confirm(`确认删除档案「${current.name}」？系统会先检查关联数据，不会静默删除已有配置或岗位。`)
    if (!firstConfirm) return

    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/profiles/${current.id}`, { method: 'DELETE' })
      const result = await parseDeleteResponse(response, '档案删除失败')
      if (result.success === false && result.forceRequired) {
        const impactMessage = formatImpactMessage(result.impactCounts)
        const confirmed = window.confirm(
          `${result.message || '该档案下还有关联数据，已阻止直接删除。'}\n\n将删除的数据：\n${impactMessage}\n\n确认强制删除该档案及以上关联数据？`
        )
        if (!confirmed) return
        const forceResponse = await fetch(`${API_BASE}/api/profiles/${current.id}?force=true`, { method: 'DELETE' })
        const forceResult = await parseApiResponse(forceResponse, '档案强制删除失败')
        alert(forceResult.message || '档案及关联数据已删除')
      } else if (result.success === false) {
        alert(result.message || '档案删除被阻止')
      } else {
        alert(result.message || '档案已删除')
      }
      await loadProfiles()
    } catch (error) {
      alert(error instanceof Error ? error.message : '档案删除失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'rounded-lg border border-slate-200/80 bg-white/80 p-3 dark:border-white/10 dark:bg-white/5'}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
        <BiUserCircle className="text-lg text-blue-500" />
        <span>当前档案</span>
      </div>
      <Select
        value={currentId}
        onChange={(event) => activateProfile(event.target.value)}
        disabled={loading}
        className="min-w-[150px]"
      >
        {profiles.map((profile) => (
          <option key={profile.id} value={String(profile.id)}>
            {profile.name}
          </option>
        ))}
      </Select>
      <Input
        value={newName}
        onChange={(event) => setNewName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            createProfile()
          }
        }}
        placeholder="新档案名称"
        className="h-9 w-[150px]"
        disabled={loading}
      />
      <Button type="button" size="sm" variant="outline" onClick={createProfile} disabled={loading || !newName.trim()}>
        <BiPlus className="mr-1" /> 新建
      </Button>
      <Button type="button" size="sm" variant="destructive" onClick={deleteProfile} disabled={loading || !currentId} title="删除当前档案">
        <BiTrash className="mr-1" /> 删除
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={loadProfiles} disabled={loading} title="刷新档案列表">
        <BiRefresh className="mr-1" /> 刷新
      </Button>
    </div>
  )
}
