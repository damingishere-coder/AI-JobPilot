import ZhilianResults from "./ZhilianResults"
import { WorkspaceEntryLink } from "@/app/discover/WorkspaceEntryLink"

export default function Page() { return <div className="space-y-4"><WorkspaceEntryLink platform="zhilian" view="results" /><ZhilianResults /></div> }
