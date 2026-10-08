'use client'

import EnvironmentSettings from '../env-config/EnvironmentSettings'
import HrAssistantSettingsCard from '../env-config/HrAssistantSettingsCard'

export default function SettingsPage() {
  return <div className="space-y-6"><EnvironmentSettings /><HrAssistantSettingsCard mode="connection" /></div>
}
