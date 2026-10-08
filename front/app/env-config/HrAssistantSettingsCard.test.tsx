import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HrAssistantSettingsCard from './HrAssistantSettingsCard'
import { hasUnsavedChanges } from '@/lib/use-unsaved-changes'

vi.mock('@/lib/chromeBridge', () => ({ getChromeBridgeStatus: vi.fn(), sendChromeBridgeMessage: vi.fn(async () => ({ success: false, message: '合成扩展未连接' })) }))

vi.mock('@/app/components/ProfileSwitcher', () => ({
  default: ({ onProfileChange }: { onProfileChange: (profile: { id: number; name: string }) => void }) => (
    <button type="button" onClick={() => onProfileChange({ id: 1, name: '默认档案' })}>选择默认档案</button>
  ),
}))

const communicationProfile = {
  expectedSalary: '20-25K',
  workLocation: '深圳',
  availability: '两周内',
  interviewAvailability: '工作日下午',
  contactPreference: '先在 BOSS 沟通',
  tone: '简洁、礼貌、积极',
  forbiddenClaims: '不得编造经历或承诺未知事实',
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function settings(overrides: Record<string, unknown> = {}) {
  return {
    profileId: 1,
    communicationProfile,
    qqEnabled: false,
    napcatWsUrl: 'ws://127.0.0.1:3001',
    qqTargetType: 'PRIVATE',
    qqTargetMasked: '12***56',
    qqOperatorMasked: '',
    qqOperatorConfigured: false,
    napcatTokenConfigured: true,
    retentionDays: 30,
    fullAutoLocked: true,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BOSS HR settings in environment config', () => {
  it.each(['communication', 'connection'] as const)('freezes the %s fields until a deferred save finishes', async mode => {
    let resolveSave!: (response: Response) => void
    const pending = new Promise<Response>(resolve => { resolveSave = resolve })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/action-token')) return jsonResponse({ success: true, data: { token: 'local-action-token' } })
      if (init?.method === 'PUT') return pending
      return jsonResponse({ success: true, data: settings() })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<HrAssistantSettingsCard mode={mode} />)
    fireEvent.click(screen.getByRole('button', { name: '选择默认档案' }))
    const field = await screen.findByLabelText(mode === 'communication' ? '期望薪资' : 'NapCat WebSocket')
    const draft = mode === 'communication' ? '30-35K' : 'ws://127.0.0.1:4567'
    fireEvent.change(field, { target: { value: draft } })
    fireEvent.click(screen.getByRole('button', { name: '保存 BOSS HR 设置' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true))
    expect(field).toBeDisabled()
    expect(screen.getByRole('group', { name: mode === 'communication' ? 'HR 沟通资料' : 'QQ 通知连接设置' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()
    resolveSave(jsonResponse({ success: true, data: settings(mode === 'communication' ? { communicationProfile: { ...communicationProfile, expectedSalary: draft } } : { napcatWsUrl: draft }) }))
    await screen.findByText('BOSS HR 设置已加密保存。')
    expect(field).toBeEnabled()
    expect(field).toHaveValue(draft)
  })

  it.each(['connection', 'communication'] as const)('其他窗口切档后拒绝保存 %s 并保留当前输入', async mode => {
    let reads = 0
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _init
      reads += 1
      return jsonResponse({ success: true, data: settings({ profileId: reads > 1 ? 2 : 1 }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<HrAssistantSettingsCard mode={mode} />)
    fireEvent.click(screen.getByRole('button', { name: '选择默认档案' }))
    const field = await screen.findByLabelText(mode === 'connection' ? 'NapCat WebSocket' : '期望薪资')
    const draft = mode === 'connection' ? 'ws://127.0.0.1:4567' : '30-35K'
    fireEvent.change(field, { target: { value: draft } })
    fireEvent.click(screen.getByRole('button', { name: '保存 BOSS HR 设置' }))
    expect(await screen.findByText('当前档案已变化，请重新加载后再保存')).toBeInTheDocument()
    expect(field).toHaveValue(draft)
    expect(hasUnsavedChanges()).toBe(true)
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('saves communication without replacing the latest notification connection from another section', async () => {
    let settingsReads = 0
    const writes: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/action-token')) return jsonResponse({ success: true, data: { token: 'local-action-token' } })
      if (init?.method === 'PUT') { writes.push(JSON.parse(String(init.body))); return jsonResponse({ success: true, data: settings() }) }
      settingsReads += 1
      return jsonResponse({ success: true, data: settings(settingsReads > 1 ? { qqEnabled: true, napcatWsUrl: 'ws://127.0.0.1:4002', qqTargetType: 'GROUP' } : {}) })
    }))
    render(<HrAssistantSettingsCard mode="communication" />)
    fireEvent.click(screen.getByRole('button', { name: '选择默认档案' }))
    fireEvent.change(await screen.findByLabelText('期望薪资'), { target: { value: '25-30K' } })
    fireEvent.click(screen.getByRole('button', { name: '保存 BOSS HR 设置' }))
    await screen.findByText('BOSS HR 设置已加密保存。')
    expect(writes[0]).toMatchObject({ communicationProfile: { expectedSalary: '25-30K' }, qqEnabled: true, napcatWsUrl: 'ws://127.0.0.1:4002', qqTargetType: 'GROUP', napcatToken: '', qqTarget: '', qqOperator: null })
  })

  it('opens the HR workspace on human decisions without exposing connection or sharing fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => jsonResponse({ success: true, data: String(input).endsWith('/settings') ? settings() : String(input).includes('/proposals/page') ? { profileId: 1, view: 'pending', status: 'ALL', q: '', page: 1, size: 10, total: 0, totalPages: 1, items: [] } : { profileId: 1 } })))
    render(<HrAssistantSettingsCard mode="workspace" />)
    fireEvent.click(screen.getByRole('button', { name: '选择默认档案' }))
    expect(await screen.findByRole('tab', { name: '待我处理' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByLabelText('NapCat Token')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存 BOSS HR 设置' })).not.toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'hr-tab-pending')
  })

  it('keeps rule drafts and navigation protection after saving the parent communication settings', async () => {
    const policy = { version: 2, enabled: false, paused: false, resumeName: '', resumeSha256: '', facts: '', rules: '合成规则', replyMode: 'AUTO', historyMode: 'RECENT', historyDays: 15, sharePhone: false, shareResume: false, communicationProfile, authorizationValid: false }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const data = url.endsWith('/action-token') ? { token: 'local-action-token' } : url.endsWith('/settings') ? settings()
        : url.endsWith('/status') ? { watching: false } : url.includes('/proposals') ? [] : url.endsWith('/deliveries') ? {} : policy
      return jsonResponse({ success: true, data })
    }))
    render(<HrAssistantSettingsCard />)
    fireEvent.click(screen.getByRole('button', { name: '选择默认档案' }))
    await screen.findByLabelText('回复方式')
    fireEvent.change(screen.getByLabelText('回复方式'), { target: { value: 'REVIEW' } })
    fireEvent.change(screen.getByLabelText('已有消息处理'), { target: { value: 'NEW_ONLY' } })
    fireEvent.change(screen.getByLabelText('期望薪资'), { target: { value: '25-30K' } })
    fireEvent.click(screen.getByRole('button', { name: '保存 BOSS HR 设置' }))
    await screen.findByText('BOSS HR 设置已加密保存。')
    expect(screen.getByLabelText('回复方式')).toHaveValue('REVIEW')
    expect(screen.getByLabelText('已有消息处理')).toHaveValue('NEW_ONLY')
    expect(hasUnsavedChanges()).toBe(true)
    expect(screen.getByText(/规则有未保存修改/)).toBeInTheDocument()
  })

  it('does not mount visual or three-conversation tools before their disclosure is opened', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); requests.push(url)
      return jsonResponse({ success: true, data: url.endsWith('/settings') ? settings() : url.includes('/proposals') ? [] : {} })
    }))
    render(<HrAssistantSettingsCard />)
    fireEvent.click(screen.getByRole('button', { name: '选择默认档案' }))
    await screen.findByDisplayValue('20-25K')
    expect(requests.some(url => url.includes('/visual/'))).toBe(false)
    expect(screen.queryByRole('button', { name: '开始三个会话测试' })).not.toBeInTheDocument()
  })

  it('loads the active profile and saves group settings with the local action token', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/local-auth/action-token')) {
        return Promise.resolve(jsonResponse({ success: true, data: { token: 'local-action-token' } }))
      }
      if (url.endsWith('/api/hr-assistant/settings') && init?.method === 'PUT') {
        return Promise.resolve(jsonResponse({
          success: true,
          data: settings({
            qqEnabled: true,
            qqTargetType: 'GROUP',
            qqTargetMasked: '98***21',
            qqOperatorMasked: '65***21',
            qqOperatorConfigured: true,
          }),
        }))
      }
      if (url.endsWith('/api/hr-assistant/settings')) {
        return Promise.resolve(jsonResponse({ success: true, data: settings() }))
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<HrAssistantSettingsCard />)
    fireEvent.click(screen.getByRole('button', { name: '选择默认档案' }))

    expect(await screen.findByDisplayValue('20-25K')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('已配置：12***56；留空不修改')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('已配置；留空不修改')).toHaveAttribute('type', 'password')

    fireEvent.change(screen.getByLabelText('QQ 通知方式'), { target: { value: 'GROUP' } })
    fireEvent.change(screen.getByLabelText('目标群号'), { target: { value: '987654321' } })
    fireEvent.change(screen.getByLabelText('群内操作人 QQ（完全托管必填）'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '仅将需要人工决策或处理的事项通知到上述 QQ 目标' }))
    fireEvent.click(screen.getByRole('button', { name: '保存 BOSS HR 设置' }))

    expect(await screen.findByText('BOSS HR 设置已加密保存。')).toBeInTheDocument()
    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(([url, init]) =>
        String(url).endsWith('/api/hr-assistant/settings') && (init as RequestInit | undefined)?.method === 'PUT')
      expect(saveCall).toBeTruthy()
      const body = JSON.parse(String((saveCall?.[1] as RequestInit).body))
      expect(body).toMatchObject({
        expectedProfileId: 1,
        qqEnabled: true,
        qqTargetType: 'GROUP',
        qqTarget: '987654321',
        qqOperator: '654321',
        napcatToken: '',
        retentionDays: 30,
      })
      const headers = (saveCall?.[1] as RequestInit).headers as Headers
      expect(headers.get('X-Local-Action-Token')).toBe('local-action-token')
    })
  })

  it('rejects a response belonging to a different active profile', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({
      success: true,
      data: settings({ profileId: 2 }),
    }))))

    render(<HrAssistantSettingsCard />)
    fireEvent.click(screen.getByRole('button', { name: '选择默认档案' }))

    expect(await screen.findByText('当前档案已变化，请重新加载后再编辑')).toBeInTheDocument()
    expect(screen.queryByLabelText('NapCat Token')).not.toBeInTheDocument()
  })
})
