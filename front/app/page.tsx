"use client"

import LegacyDeliveryOverview from "./components/LegacyDeliveryOverview"
import CrmWorkbench from "./components/CrmWorkbench"
import { useState } from "react"

export default function HomePage() {
  const [legacyOpen, setLegacyOpen] = useState(false)
  return <div className="space-y-6">
    <CrmWorkbench />
    <details onToggle={event => setLegacyOpen(event.currentTarget.open)} className="rounded-xl border p-4">
      <summary className="cursor-pointer font-medium">原平台概览与连接检查</summary>
      {legacyOpen && <div className="mt-4"><LegacyDeliveryOverview /></div>}
    </details>
  </div>
}
