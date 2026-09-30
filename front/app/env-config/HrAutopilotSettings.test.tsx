import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import HrAutopilotSettings, { HR_BACKGROUND_PROTOCOL } from './HrAutopilotSettings'
import { getChromeBridgeStatus, sendChromeBridgeMessage } from '@/lib/chromeBridge'

vi.mock('@/lib/chromeBridge', () => ({ getChromeBridgeStatus: vi.fn(), sendChromeBridgeMessage: vi.fn() }))
vi.mock('./HrDutyActivity', () => ({ default: () => null }))

const defaultPolicy = { version: 2, enabled: false, paused: false, resumeName: '', resumeSha256: '', facts: '', rules: '按已确认事实回复', replyMode: 'REVIEW', historyMode: 'NEW_ONLY', historyDays: 30, sharePhone: false, shareResume: false, authorizationValid: false, communicationProfile: { expectedSalary: '20–25K' } }
const stoppedHost = { transport: 'CHROME_BACKGROUND', state: 'STOPPED', intentEnabled: false, paused: false }
const runtimeBinding = { watchSessionId: 'synthetic-watch', hostGeneration: 'synthetic-generation', pageDocumentId: 'synthetic-document' }

beforeEach(() => {
  vi.mocked(getChromeBridgeStatus).mockResolvedValue({ success: true, hrBackgroundProtocol: HR_BACKGROUND_PROTOCOL })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

function setup(options: { policy?: Record<string, unknown>; host?: Record<string, unknown>; watch?: Record<string, unknown>; startHost?: Record<string, unknown>; stopError?: boolean; invalidAuthorization?: boolean } = {}) {
  const policy = { ...defaultPolicy, ...options.policy }
  let host: Record<string, unknown> = { ...stoppedHost, ...runtimeBinding, ...options.host }
  let watch = { watching: false, transport: 'CHROME_BACKGROUND', ...runtimeBinding, ...options.watch }
  const requests: Record<string, unknown>[] = []
  const order: string[] = []
  vi.mocked(sendChromeBridgeMessage).mockImplementation(async payload => {
    const type = String(payload.type)
    if (type === 'BOSS_HR_HOST_STATUS') return { success: true, data: host }
    order.push(type)
    if (type === 'BOSS_HR_HOST_START') {
      host = { ...host, state: 'STARTING', intentEnabled: true, ...options.startHost }
      watch = { ...watch, watching: host.state === 'RUNNING' }
    } else if (type === 'BOSS_HR_HOST_PAUSE') host = { ...host, state: 'PAUSED', paused: true }
    else if (type === 'BOSS_HR_HOST_RESUME') host = { ...host, state: 'RECOVERING', paused: false, errorCode: '', needsAccountConfirmation: false }
    else if (type === 'BOSS_HR_HOST_STOP') {
      if (options.stopError) return { success: false, message: '扩展未响应' }
      host = { ...stoppedHost }
    }
    return { success: true, data: host }
  })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    let data: unknown = policy
    if (url.endsWith('/action-token')) data = { token: 'synthetic' }
    else if (url.endsWith('/status')) data = watch
    else if (url.endsWith('/deliveries')) data = {}
    else if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body))
      requests.push(body); order.push('SAVE_AUTHORIZATION')
      Object.assign(policy, body, { version: 3, authorizationValid: !options.invalidAuthorization })
      data = policy
    }
    return new Response(JSON.stringify({ success: true, data }), { headers: { 'Content-Type': 'application/json' } })
  }))
  return { requests, order }
}

async function confirmAndStart() {
  await screen.findByText(/20–25K/)
  fireEvent.click(screen.getByRole('checkbox', { name: /我已核对当前档案资料/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /我确认当前 Chrome 的 BOSS 求职者账号/ }))
  fireEvent.click(screen.getByRole('button', { name: '一键开启后台托管' }))
}

it('saves AUTO and recent 30 days authorization before starting the background host without a PDF or extra sharing', async () => {
  const { requests, order } = setup()
  render(<HrAutopilotSettings profileId={1} />)
  await screen.findByText(/20–25K/)
  expect(screen.getByLabelText('回复方式')).toHaveValue('AUTO')
  expect(screen.getByLabelText('已有消息处理')).toHaveValue('RECENT')
  expect(screen.getByRole('button', { name: '一键开启后台托管' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /我已核对当前档案资料/ }))
  expect(screen.getByRole('button', { name: '一键开启后台托管' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /我确认当前 Chrome 的 BOSS 求职者账号/ }))
  fireEvent.click(screen.getByRole('button', { name: '一键开启后台托管' }))
  expect(await screen.findByText(/已开始后台准备/)).toBeInTheDocument()
  expect(requests[0]).toMatchObject({ profileId: 1, replyMode: 'AUTO', enabled: true, rulesConfirmed: true, sharePhone: false, shareResume: false, resumeName: '', historyMode: 'RECENT', historyDays: 30 })
  expect(order).toEqual(['SAVE_AUTHORIZATION', 'BOSS_HR_HOST_START'])
  expect(sendChromeBridgeMessage).toHaveBeenCalledWith({ type: 'BOSS_HR_HOST_START', expectedProfileId: 1, hrBackgroundProtocol: HR_BACKGROUND_PROTOCOL, accountBindingConfirmed: true }, 30000)
  expect(screen.getByText('托管状态：正在后台核对账号与聊天页')).toBeInTheDocument()
})

it('blocks startup while communication or QQ settings are unsaved', async () => {
  const { requests } = setup()
  render(<HrAutopilotSettings profileId={1} settingsDirty />)
  await screen.findByText(/20–25K/)
  fireEvent.click(screen.getByRole('checkbox', { name: /我已核对当前档案资料/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /我确认当前 Chrome 的 BOSS 求职者账号/ }))
  expect(screen.getByRole('button', { name: '一键开启后台托管' })).toBeDisabled()
  expect(screen.getByText(/请先保存沟通资料与 QQ 设置/)).toBeInTheDocument()
  expect(requests).toHaveLength(0)
})

it('does not infer running from an enabled policy', async () => {
  setup({ policy: { enabled: true, authorizationValid: true, replyMode: 'AUTO' } })
  render(<HrAutopilotSettings profileId={1} />)
  expect(await screen.findByText('托管状态：已停止')).toBeInTheDocument()
  expect(screen.getByLabelText('回复方式')).toHaveValue('AUTO')
  expect(screen.queryByText('托管状态：后台托管中')).not.toBeInTheDocument()
})

it('requires the backend background connection to confirm an extension RUNNING state', async () => {
  setup({ policy: { enabled: true, authorizationValid: true }, host: { state: 'RUNNING', intentEnabled: true, accountName: '合成求职者' }, watch: { watching: true, transport: 'VISUAL' } })
  render(<HrAutopilotSettings profileId={1} />)
  expect(await screen.findByText('托管状态：后台连接待核验')).toBeInTheDocument()
  expect(screen.queryByText('托管状态：后台托管中')).not.toBeInTheDocument()
})

it.each(['watchSessionId', 'hostGeneration', 'pageDocumentId'])('does not show running when backend %s belongs to an older binding', async key => {
  setup({ policy: { enabled: true, authorizationValid: true }, host: { state: 'RUNNING', intentEnabled: true }, watch: { watching: true, [key]: 'old-binding' } })
  render(<HrAutopilotSettings profileId={1} />)
  expect(await screen.findByText('托管状态：后台连接待核验')).toBeInTheDocument()
  expect(screen.queryByText('托管状态：后台托管中')).not.toBeInTheDocument()
})

it('requires a nonempty page binding before confirming the running state', async () => {
  setup({ policy: { enabled: true, authorizationValid: true }, host: { state: 'RUNNING', intentEnabled: true, watchSessionId: undefined }, watch: { watching: true, watchSessionId: undefined } })
  render(<HrAutopilotSettings profileId={1} />)
  expect(await screen.findByText('托管状态：后台连接待核验')).toBeInTheDocument()
})

it('shows actual account and scan status and pauses without repeating authorization', async () => {
  const { requests } = setup({ policy: { enabled: true, authorizationValid: true }, host: { state: 'RUNNING', intentEnabled: true, accountName: '合成求职者', tabId: 71, lastScanAt: '2026-09-30T01:00:00Z' }, watch: { watching: true } })
  render(<HrAutopilotSettings profileId={1} />)
  expect(await screen.findByText('托管状态：后台托管中')).toBeInTheDocument()
  expect(screen.getByText('已核验 BOSS 账号：合成求职者')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '暂停后台托管' }))
  expect(await screen.findByText('托管状态：已暂停')).toBeInTheDocument()
  expect(requests).toHaveLength(0)
  expect(sendChromeBridgeMessage).toHaveBeenCalledWith({ type: 'BOSS_HR_HOST_PAUSE', expectedProfileId: 1, hrBackgroundProtocol: HR_BACKGROUND_PROTOCOL }, 30000)
})

it('resumes a paused host by revalidation without changing AUTO or sharing permissions', async () => {
  const { requests } = setup({ policy: { enabled: true, authorizationValid: true, replyMode: 'AUTO' }, host: { state: 'PAUSED', intentEnabled: true, paused: true } })
  render(<HrAutopilotSettings profileId={1} />)
  const resume = await screen.findByRole('button', { name: '恢复后台托管' })
  fireEvent.click(resume)
  expect(await screen.findByText('托管状态：正在校验并恢复连接')).toBeInTheDocument()
  expect(requests).toHaveLength(0)
  expect(sendChromeBridgeMessage).toHaveBeenCalledWith({ type: 'BOSS_HR_HOST_RESUME', expectedProfileId: 1, hrBackgroundProtocol: HR_BACKGROUND_PROTOCOL }, 30000)
})

it('requires renewed account confirmation when Chrome restarts without a stable account identifier', async () => {
  setup({ policy: { enabled: true, authorizationValid: true, replyMode: 'AUTO' }, host: { state: 'BLOCKED', intentEnabled: true, errorCode: 'ACCOUNT_RECONFIRM_REQUIRED' } })
  render(<HrAutopilotSettings profileId={1} />)
  const resume = await screen.findByRole('button', { name: '恢复后台托管' })
  expect(resume).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /我已重新核对当前 Chrome/ }))
  expect(resume).toBeEnabled()
  fireEvent.click(resume)
  expect(await screen.findByText('托管状态：正在校验并恢复连接')).toBeInTheDocument()
  expect(sendChromeBridgeMessage).toHaveBeenCalledWith({ type: 'BOSS_HR_HOST_RESUME', expectedProfileId: 1, hrBackgroundProtocol: HR_BACKGROUND_PROTOCOL, accountBindingConfirmed: true }, 30000)
})

it('offers account reconfirmation during recovery before the first blocked alarm', async () => {
  setup({ policy: { enabled: true, authorizationValid: true, replyMode: 'AUTO' }, host: { state: 'RECOVERING', intentEnabled: true, needsAccountConfirmation: true } })
  render(<HrAutopilotSettings profileId={1} />)
  expect(await screen.findByText('托管状态：等待重新核对 BOSS 账号')).toBeInTheDocument()
  const resume = screen.getByRole('button', { name: '恢复后台托管' })
  expect(resume).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /我已重新核对当前 Chrome/ }))
  expect(resume).toBeEnabled()
})

it('revokes backend authorization on stop even when the extension does not respond', async () => {
  const { requests } = setup({ policy: { enabled: true, authorizationValid: true }, host: { state: 'RUNNING', intentEnabled: true }, watch: { watching: true }, stopError: true })
  render(<HrAutopilotSettings profileId={1} />)
  await screen.findByText('托管状态：后台托管中')
  fireEvent.click(screen.getByRole('button', { name: '停止后台托管' }))
  expect(await screen.findByText(/已撤销自动托管授权。扩展未响应/)).toBeInTheDocument()
  expect(requests[0]).toMatchObject({ enabled: false, sharePhone: false, shareResume: false })
  expect(screen.queryByText('托管状态：后台托管中')).not.toBeInTheDocument()
})

it('shows an unknown account blocker rather than a successful running state', async () => {
  setup({ startHost: { state: 'BLOCKED', intentEnabled: true, accountName: '', errorCode: 'ACCOUNT_UNVERIFIED', message: '未能读取 BOSS 求职者账号，当前不会发送。' } })
  render(<HrAutopilotSettings profileId={1} />)
  await confirmAndStart()
  expect(await screen.findByText('托管状态：需要处理后恢复')).toBeInTheDocument()
  expect(screen.getAllByText('未能读取 BOSS 求职者账号，当前不会发送。')).not.toHaveLength(0)
  expect(screen.queryByText('托管状态：后台托管中')).not.toBeInTheDocument()
})

it('only displays the bound browser page after an explicit view click', async () => {
  setup({ host: { state: 'BLOCKED', intentEnabled: true, tabId: 71, errorCode: 'LOGIN_REQUIRED' } })
  render(<HrAutopilotSettings profileId={1} />)
  const view = await screen.findByRole('button', { name: '查看托管聊天页' })
  await waitFor(() => expect(view).toBeEnabled())
  expect(vi.mocked(sendChromeBridgeMessage).mock.calls.some(([payload]) => payload.type === 'BOSS_HR_HOST_VIEW')).toBe(false)
  fireEvent.click(view)
  expect(await screen.findByText(/已按你的点击显示托管聊天页/)).toBeInTheDocument()
  expect(sendChromeBridgeMessage).toHaveBeenCalledWith({ type: 'BOSS_HR_HOST_VIEW', expectedProfileId: 1, hrBackgroundProtocol: HR_BACKGROUND_PROTOCOL }, 5000)
})

it('refuses an old extension before saving authorization', async () => {
  const { requests } = setup()
  vi.mocked(getChromeBridgeStatus).mockResolvedValue({ success: true, hrBackgroundProtocol: 'old' })
  render(<HrAutopilotSettings profileId={1} />)
  await confirmAndStart()
  expect(await screen.findByText(/当前扩展尚不支持后台托管/)).toBeInTheDocument()
  expect(requests).toHaveLength(0)
})

it('preserves an existing authorized local resume rather than switching it to native sharing', async () => {
  const { requests } = setup({ policy: { enabled: true, authorizationValid: true, replyMode: 'REVIEW', shareResume: true, resumeName: 'synthetic-approved.pdf', resumeSha256: 'synthetic-hash', historyMode: 'NEW_ONLY' } })
  render(<HrAutopilotSettings profileId={1} />)
  await confirmAndStart()
  await waitFor(() => expect(requests).toHaveLength(1))
  expect(requests[0]).toMatchObject({ replyMode: 'REVIEW', shareResume: true, resumeName: 'synthetic-approved.pdf', resumeSha256: 'synthetic-hash', sharePhone: false, historyMode: 'NEW_ONLY' })
})

it('does not start a host when the saved authorization is still invalid and displays fact blockers', async () => {
  const { order } = setup({ policy: { blockers: ['到岗资料存在冲突，请补充确认'] }, invalidAuthorization: true })
  render(<HrAutopilotSettings profileId={1} />)
  expect(await screen.findByText('到岗资料存在冲突，请补充确认')).toBeInTheDocument()
  await confirmAndStart()
  await waitFor(() => expect(order).toEqual(['SAVE_AUTHORIZATION']))
  expect(screen.getAllByText('到岗资料存在冲突，请补充确认')).not.toHaveLength(0)
})

it('shows conflicting availability without rewriting the saved communication facts', async () => {
  const availability = '随时到岗，Offer 后两周入职'
  const { requests } = setup({ policy: { communicationProfile: { expectedSalary: '20–25K', availability } } })
  render(<HrAutopilotSettings profileId={1} />)
  expect(await screen.findByText(/到岗资料同时包含立即到岗和等待 Offer 后的时间/)).toBeInTheDocument()
  expect(screen.getByText(/随时到岗，Offer 后两周入职/)).toBeInTheDocument()
  expect(requests).toHaveLength(0)
})
