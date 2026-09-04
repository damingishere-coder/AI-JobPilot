import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HrAssistantSettingsCard from './HrAssistantSettingsCard'

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
    fireEvent.change(screen.getByLabelText('群内操作人 QQ（可选）'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '仅将高价值 HR 消息通知到上述 QQ 目标' }))
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
