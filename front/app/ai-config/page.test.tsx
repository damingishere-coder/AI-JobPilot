import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import AiConfigPage from './page'

vi.mock('@/app/components/ProfileSwitcher', () => ({
  default: ({ onProfileChange, disabled }: { onProfileChange: (profile: { id: number; name: string } | null) => void; disabled?: boolean }) => (
    <div>
      <button onClick={() => onProfileChange({ id: 1, name: 'A' })}>切换A</button>
      <button onClick={() => onProfileChange({ id: 2, name: 'B' })}>切换B</button>
      <button disabled={disabled}>新建档案</button>
      <button onClick={() => onProfileChange(null)}>清空档案</button>
    </div>
  ),
}))

type Deferred = { promise: Promise<Response>; resolve: (response: Response) => void }

function deferred(): Deferred {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function readyResponse() {
  return jsonResponse({ ready: true, status: 'UP' })
}

function profileResponse(url: string, id: number, name: string) {
  const profile = { id, name }
  const payload = url.includes('/api/boss/config')
    ? { success: true, currentProfile: profile, hasProfile: true, config: { enableAi: 1, sayHi: `${name} hi`, nativeGreetingDisabledConfirmed: 1 } }
    : url.includes('/api/ai/resume')
      ? { success: true, currentProfile: profile, hasProfile: true, data: { resumeText: `${name} resume` } }
      : url.includes('/api/ai/companies/priority')
        ? { success: true, currentProfile: profile, hasProfile: true, data: [{ companyName: `${name} company` }] }
        : { success: true, currentProfile: profile, hasProfile: true, data: { introduce: `${name} intro`, prompt: `${name} prompt` } }
  return jsonResponse(payload)
}

describe('AI config profile snapshot', () => {
  it('后端就绪后才显示档案入口', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/ready')) return Promise.resolve(readyResponse())
      return Promise.reject(new Error('不应发起其他请求'))
    }))
    render(<AiConfigPage />)
    expect(await screen.findByRole('button', { name: '新建档案' })).toBeEnabled()
  })

  it('A 的迟到响应不能覆盖已完成的 B 快照', async () => {
    const pendingA = Array.from({ length: 4 }, deferred)
    let profileCallCount = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/ready')) return Promise.resolve(readyResponse())
      const index = profileCallCount++
      if (index < 4) return pendingA[index].promise
      return Promise.resolve(profileResponse(url, 2, 'B'))
    }))

    render(<AiConfigPage />)
    fireEvent.click(await screen.findByRole('button', { name: '切换A' }))
    fireEvent.click(screen.getByRole('button', { name: '切换B' }))

    await screen.findByText('当前正在编辑：B')
    expect(screen.getByDisplayValue('B intro')).toBeInTheDocument()

    const aUrls = ['/api/ai/config', '/api/boss/config', '/api/ai/resume', '/api/ai/companies/priority']
    pendingA.forEach((item, index) => item.resolve(profileResponse(aUrls[index], 1, 'A')))
    await waitFor(() => expect(screen.getByText('当前正在编辑：B')).toBeInTheDocument())
    expect(screen.queryByDisplayValue('A intro')).not.toBeInTheDocument()
  })

  it('档案存在但快照失败时不误报无档案，且禁用保存', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/ready')) return Promise.resolve(readyResponse())
      if (url.includes('/api/boss/config')) {
        return Promise.resolve(new Response('数据库忙', { status: 500, headers: { 'Content-Type': 'text/plain' } }))
      }
      return Promise.resolve(profileResponse(url, 1, 'A'))
    }))

    render(<AiConfigPage />)
    fireEvent.click(await screen.findByRole('button', { name: '切换A' }))

    await screen.findByText(/Boss配置加载失败|后端服务暂不可用/)
    expect(screen.queryByText(/请先在上方新建档案/)).not.toBeInTheDocument()
    expect(screen.getByText(/当前档案已存在，但配置快照尚未完整加载/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /保存配置/ })).toBeDisabled()
  })

  it('删除最后一个档案后清空旧快照', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/ready')) return Promise.resolve(readyResponse())
      return Promise.resolve(profileResponse(url, 1, 'A'))
    }))

    render(<AiConfigPage />)
    fireEvent.click(await screen.findByRole('button', { name: '切换A' }))
    await screen.findByText('当前正在编辑：A')
    fireEvent.click(screen.getByRole('button', { name: '清空档案' }))

    await screen.findByText(/请先在上方新建档案/)
    expect(screen.queryByText('当前正在编辑：A')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /保存配置/ })).toBeDisabled()
  })

  it('加载并保存关闭 BOSS 平台默认话术确认', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/ready')) return Promise.resolve(readyResponse())
      return Promise.resolve(profileResponse(url, 1, 'A'))
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('alert', vi.fn())

    render(<AiConfigPage />)
    fireEvent.click(await screen.findByRole('button', { name: '切换A' }))
    await screen.findByText('当前正在编辑：A')

    const confirmation = screen.getByRole('checkbox', { name: /我已关闭 BOSS 平台自带打招呼语/ })
    expect(confirmation).toBeChecked()
    fireEvent.click(confirmation)
    fireEvent.click(screen.getByRole('button', { name: /保存配置/ }))

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes('/api/boss/config') && (init as RequestInit | undefined)?.method === 'PUT')
      expect(saveCall).toBeTruthy()
      const body = JSON.parse(String((saveCall?.[1] as RequestInit).body))
      expect(body).toMatchObject({ nativeGreetingDisabledConfirmed: 0 })
    })
  })

  it('文件先本地识别为可编辑预览，不会直接保存', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/ready')) return Promise.resolve(readyResponse())
      if (url.includes('/api/ai/resume/parse')) {
        const mode = (init?.body as FormData).get('mode')
        return Promise.resolve(jsonResponse({
          success: true,
          data: {
            text: mode === 'ai_review' ? 'AI 复核简历' : '本地识别简历',
            localText: '本地识别简历',
            sourceFilename: 'resume.jpg',
            method: mode === 'ai_review' ? 'ai-reviewed' : 'local-docling-rapidocr',
            qualityScore: mode === 'ai_review' ? 92 : 70,
            warnings: mode === 'ai_review' ? [] : ['请核对'],
          },
        }))
      }
      return Promise.resolve(profileResponse(url, 1, 'A'))
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))

    render(<AiConfigPage />)
    fireEvent.click(await screen.findByRole('button', { name: '切换A' }))
    await screen.findByText('当前正在编辑：A')
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0])], 'resume.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('上传简历文件'), { target: { files: [file] } })

    await screen.findByText('本地识别')
    expect(screen.getByDisplayValue('本地识别简历')).toBeInTheDocument()
    expect(screen.getByText(/低置信度 70/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).endsWith('/api/ai/resume') && (init as RequestInit | undefined)?.method === 'POST')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '使用AI强制复核' }))
    await screen.findByText('AI已复核')
    expect(screen.getByDisplayValue('AI 复核简历')).toBeInTheDocument()
  })
})
