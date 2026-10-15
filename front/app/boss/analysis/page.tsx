"use client"

import { useSyncExternalStore } from "react"
import AnalysisContent from "./AnalysisContent"

export default function BossAnalysisPage() {
  const search = useSyncExternalStore(subscribeLocation, () => window.location.search, () => "")
  const scanRunId = new URLSearchParams(search).get("scanRunId") || ""
  return <AnalysisContent showHeader focusScanRunId={scanRunId} />
}

function subscribeLocation(notify: () => void) { window.addEventListener("popstate", notify); return () => window.removeEventListener("popstate", notify) }
