"use client"

import { useSyncExternalStore } from "react"
import AnalysisContent from "./AnalysisContent"
import { WorkspaceEntryLink } from "@/app/discover/WorkspaceEntryLink"

export default function BossAnalysisPage() {
  const search = useSyncExternalStore(subscribeLocation, () => window.location.search, () => "")
  const scanRunId = new URLSearchParams(search).get("scanRunId") || ""
  return <div className="space-y-4"><WorkspaceEntryLink platform="boss" view="results" /><AnalysisContent showHeader focusScanRunId={scanRunId} /></div>
}

function subscribeLocation(notify: () => void) { window.addEventListener("popstate", notify); return () => window.removeEventListener("popstate", notify) }
