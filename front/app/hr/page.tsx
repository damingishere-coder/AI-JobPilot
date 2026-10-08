'use client'

import PageHeader from '@/app/components/PageHeader'
import HrAssistantSettingsCard from '../env-config/HrAssistantSettingsCard'
import { MessageSquare } from 'lucide-react'

export default function HrPage() {
  return <div className="space-y-6"><PageHeader title="HR 沟通" subtitle="处理待办、核对后台托管与跟进会话结果" icon={<MessageSquare />} /><HrAssistantSettingsCard mode="workspace" /></div>
}
