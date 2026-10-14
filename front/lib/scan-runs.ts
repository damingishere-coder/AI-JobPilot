import { API_BASE, localActionFetch } from './api'
import type { ChromeBridgeResponse } from './chromeBridge'

export type ScanPlatform = 'boss' | 'zhilian'
export const scanUrl = (platform: ScanPlatform, profileId: number, runId?: string, suffix = '') =>
  `${API_BASE}/api/scan-runs${runId ? `/${encodeURIComponent(runId)}${suffix}` : ''}?platform=${platform}&profileId=${profileId}`
const reasons: Record<string, string> = {
  RESUME_REQUIRES_LIVE_CHECKPOINT: '继续失败：扫描页尚未响应或没有可恢复的暂停状态。',
  PLATFORM_SCAN_ALREADY_ACTIVE: '该平台还有未结束的扫描，请先查看已有任务并停止或继续。',
  SCAN_TERMINAL: '本轮已经结束或停止约束已保存，不能继续。',
  PROFILE_CHANGED: '当前档案已切换，请刷新后操作。',
  LOCAL_ACTION_TOKEN_REQUIRED: '本地操作令牌失效，请刷新工作台。',
}
const businessCodes = new Set([...Object.keys(reasons), 'INVALID_SCAN_KEY', 'SCAN_NOT_FOUND', 'INVALID_COMMAND', 'COMMAND_ID_CONFLICT', 'EVENT_BATCH_TOO_LARGE', 'INVALID_EVENT_ID'])
export class ScanRequestError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly serverMessage: string) {
    super(`${reasons[code] || serverMessage || '扫描记录操作失败，请查看任务状态后重试。'}（${code}，HTTP ${status}）`)
    this.name = 'ScanRequestError'
  }
}
async function write(url: string, body: unknown) {
  const response = await localActionFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const code = typeof data.message === 'string' && businessCodes.has(data.message)
      ? data.message : String(data.errorCode || data.code || data.message || `HTTP_${response.status}`)
    throw new ScanRequestError(code, response.status, String(data.message || data.error || ''))
  }
  return response.json()
}
export async function registerScan(platform: ScanPlatform, profileId: number, runId: string) {
  return write(scanUrl(platform, profileId), { runId })
}
export async function scanCommand(platform: ScanPlatform, profileId: number, runId: string, kind: 'PAUSE' | 'RESUME' | 'STOP') {
  return write(scanUrl(platform, profileId, runId, '/commands'), { kind, id: crypto.randomUUID() })
}
export async function readScanRuns<T>(platform: ScanPlatform, profileId: number): Promise<T[]> {
  const response = await fetch(scanUrl(platform, profileId), { cache: 'no-store' })
  if (!response.ok) throw new ScanRequestError(`HTTP_${response.status}`, response.status, '暂时无法读取后端扫描记录。')
  const data: unknown = await response.json()
  if (!Array.isArray(data)) throw new Error('后端扫描记录接口版本不兼容。')
  return data as T[]
}
export const scanIsTerminal = (state: string) => ['COMPLETE', 'PARTIAL', 'FAILED', 'STOPPED'].includes(state)
export const scanStartIsUnconfirmed = (response: ChromeBridgeResponse) => response.startUnconfirmed === true || response.startNotDispatched !== true
export const scanHasUnconfirmedStart = (errorCode?: string) => ['START_FAILED', 'SCAN_START_UNCONFIRMED', 'BRIDGE_RESPONSE_TIMEOUT', 'BRIDGE_EMPTY_RESPONSE'].includes(errorCode || '')
export function verifyScanStart(response: ChromeBridgeResponse, runId: string, profileId: number): ChromeBridgeResponse {
  if (!response.success) return scanStartIsUnconfirmed(response) && !scanHasUnconfirmedStart(response.errorCode)
    ? { ...response, startUnconfirmed: true, errorCode: 'SCAN_START_UNCONFIRMED', message: `${response.message || '扩展未明确确认启动结果。'}${response.errorCode ? `（${response.errorCode}）` : ''}` } : response
  if (response.startAccepted === true && response.runId === runId && response.profileId === profileId
      && typeof response.scanOwnerToken === 'string' && response.scanOwnerToken.trim()) return response
  return { ...response, success: false, startUnconfirmed: true, errorCode: 'SCAN_START_UNCONFIRMED', message: '扫描启动回执缺少匹配的任务、档案或执行器身份。结果待核实，请查看扫描记录；不要重复启动。' }
}
export const scanFailureMessage = (response: ChromeBridgeResponse, platformName: string) =>
  `${platformName}扫描启动${scanStartIsUnconfirmed(response) ? '结果待核实' : '失败'}：${response.message || '扩展没有返回明确的启动结果。'}（${String(response.errorCode || 'SCAN_START_UNCONFIRMED')}）`
export async function scanStartFailed(platform: ScanPlatform, profileId: number, runId: string, errorCode: string, unconfirmed = errorCode === 'START_FAILED' || errorCode === 'SCAN_START_UNCONFIRMED', message = '') {
  return write(scanUrl(platform, profileId, runId, '/sync'), { epoch: 1, events: [{ eventId: crypto.randomUUID(), epoch: 1, seq: 1, kind: 'startFailure', stage: 'startFailed', state: unconfirmed ? 'BLOCKED' : 'FAILED', errorCode, message }] })
}
