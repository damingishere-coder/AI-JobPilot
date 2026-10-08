'use client'

import { useCallback, useState } from 'react'
import { BiBarChart } from 'react-icons/bi'
import ProfileSwitcher from '@/app/components/ProfileSwitcher'
import PageHeader from '@/app/components/PageHeader'
import RankingWorkspace from './RankingWorkspace'

export default function RankingPage() {
  const [profileId, setProfileId] = useState<number | null>(null)
  const changeProfile = useCallback((profile: { id: number } | null) => setProfileId(profile?.id ?? null), [])
  return <section className="space-y-5"><PageHeader title="推荐机会" subtitle="分别查看能力匹配、个人偏好和真实反馈，决定下一步关注的岗位" icon={<BiBarChart />} /><ProfileSwitcher onProfileChange={changeProfile} /><RankingWorkspace key={profileId} profileId={profileId} /></section>
}
