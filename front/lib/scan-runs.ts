import { API_BASE, localActionFetch } from './api'

export type ScanPlatform = 'boss' | 'zhilian'
export const scanUrl = (platform: ScanPlatform, profileId: number, runId?: string, suffix = '') =>
  `${API_BASE}/api/scan-runs${runId ? `/${encodeURIComponent(runId)}${suffix}` : ''}?platform=${platform}&profileId=${profileId}`
async function write(url: string, body: unknown) {
  const response = await localActionFetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  if(!response.ok) {
    const data=await response.json().catch(()=>({}))
    const reasons:Record<string,string>={RESUME_REQUIRES_LIVE_CHECKPOINT:'继续失败：扫描页尚未响应或没有可恢复的暂停状态。',PLATFORM_SCAN_ALREADY_ACTIVE:'该平台还有未结束的扫描，请先查看已有任务并停止。',SCAN_TERMINAL:'本轮已经结束或正在停止，不能继续。',PROFILE_CHANGED:'当前档案已切换，请刷新后操作。',LOCAL_ACTION_TOKEN_REQUIRED:'本地操作令牌失效，请刷新工作台。'}
    throw new Error(reasons[String(data.message)]||`扫描记录操作失败（HTTP ${response.status}），请查看任务状态后重试。`)
  }
  return response.json()
}
export async function registerScan(platform: ScanPlatform, profileId: number, runId: string) {
  return write(scanUrl(platform,profileId),{runId})
}
export async function scanCommand(platform: ScanPlatform, profileId: number, runId: string, kind: 'PAUSE'|'RESUME'|'STOP') {
  return write(scanUrl(platform,profileId,runId,'/commands'),{kind,id:crypto.randomUUID()})
}
export async function scanStartFailed(platform: ScanPlatform, profileId: number, runId: string, errorCode: string) {
  return write(scanUrl(platform,profileId,runId,'/sync'),{epoch:1,events:[{eventId:crypto.randomUUID(),epoch:1,seq:1,kind:'startFailure',stage:'startFailed',state:errorCode==='START_FAILED'?'BLOCKED':'FAILED',errorCode}]})
}
