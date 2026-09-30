import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import HrVisualPanel from './HrVisualPanel'
import { localActionFetch } from '@/lib/api'

vi.mock('@/lib/api', async () => ({ ...await vi.importActual('@/lib/api'), localActionFetch: vi.fn() }))
const response = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { 'Content-Type': 'application/json' } })
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('processes the entire existing batch with explicit direct-text consent without starting continuous duty', async () => {
  const status = { installed: true, protocol: '2026-09-29-hr-visual-v3', executing: false, running: false, status: 'IDLE', targets: [], batch: { id: 'batch', status: 'PAUSED', stage: 'DISCOVER', discovered: 333 } }
  vi.stubGlobal('fetch', vi.fn(async () => response(status)))
  vi.mocked(localActionFetch).mockResolvedValue(response(status))
  render(<HrVisualPanel profileId={4} profileName="本人" />)
  const button = await screen.findByRole('button', { name: '处理已发现的全部会话（333 人）' })
  fireEvent.click(screen.getByLabelText('本轮普通文字经审核后直接回复，无需 QQ 确认')); fireEvent.click(button)
  await waitFor(() => expect(localActionFetch).toHaveBeenCalledOnce())
  const [url, init] = vi.mocked(localActionFetch).mock.calls[0]
  expect(url).toContain('/visual/batches/batch/process')
  expect(JSON.parse(String(init?.body))).toEqual({ protocol: status.protocol, replyMode: 'AUTO', directRepliesConfirmed: true })
})

it('prioritizes only an existing paused batch contact without creating a new batch or text authorization', async () => {
  const status = { installed: true, protocol: '2026-09-29-hr-visual-v3', executing: false, running: false, status: 'IDLE', targets: [],
    batch: { id: 'batch', status: 'PAUSED', stage: 'DISCOVER', items: [
      { id: 'contact', kind: 'CONTACT', hrName: 'HR', companyName: '公司', status: 'PENDING', reason: '' },
      { id: 'unknown', kind: 'ANCHOR', hrName: '旧HR', companyName: '旧公司', status: 'PENDING', reason: '' },
      { id: 'sent', kind: 'CONTACT', hrName: '已发HR', companyName: '公司', status: 'SENT_CONFIRMED', reason: '' },
    ] } }
  vi.stubGlobal('fetch', vi.fn(async () => response(status)))
  vi.mocked(localActionFetch).mockImplementation(async () => response(status))
  render(<HrVisualPanel profileId={4} profileName="本人" />)
  fireEvent.click(await screen.findByText('本轮逐项结果'))
  const buttons = screen.getAllByRole('button', { name: '优先处理此会话，随后继续扫描' })
  expect(buttons).toHaveLength(1); fireEvent.click(buttons[0])
  await waitFor(() => expect(localActionFetch).toHaveBeenCalledOnce())
  expect(vi.mocked(localActionFetch).mock.calls[0]).toEqual([expect.stringContaining('/visual/batches/batch/items/contact/prioritize'), { method: 'POST' }])
})

it.each([['DISCOVER', false], ['PROCESS', true]])('offers a read recheck only before a send run has been created in %s', async (stage, processingDiscovered) => {
  const status = { installed: true, protocol: '2026-09-29-hr-visual-v3', executing: false, running: false, status: 'IDLE', targets: [],
    batch: { id: 'batch', status: 'PAUSED', stage, processingDiscovered, items: [
      { id: 'unread', kind: 'CONTACT', hrName: 'HR', companyName: '公司', status: 'BLOCKED', reason: '身份未核验', canRecheck: true },
      { id: 'attempted', kind: 'CONTACT', hrName: '已尝试HR', companyName: '公司', status: 'BLOCKED', reason: '发送已阻塞', runId: 'run' },
      { id: 'unknown', kind: 'CONTACT', hrName: '旧HR', companyName: '公司', status: 'SEND_UNKNOWN', reason: '未知', runId: 'old-run' },
    ] } }
  vi.stubGlobal('fetch', vi.fn(async () => response(status)))
  vi.mocked(localActionFetch).mockImplementation(async () => response(status))
  render(<HrVisualPanel profileId={4} profileName="本人" />)
  fireEvent.click(await screen.findByText('本轮逐项结果'))
  const buttons = screen.getAllByRole('button', { name: '重新核验未进入发送的会话' })
  expect(buttons).toHaveLength(1); fireEvent.click(buttons[0])
  await waitFor(() => expect(localActionFetch).toHaveBeenCalledOnce())
  expect(vi.mocked(localActionFetch).mock.calls[0][0]).toContain('/items/unread/recheck')
})

it('shows loaded list without selection separately from stale successful observations and coverage', async () => {
  const status = { installed: true, protocol: '2026-09-29-hr-visual-v3', running: false, status: 'IDLE', targets: [],
    batch: { id: 'b', status: 'INCOMPLETE', discovered: 12, checked: 9, pendingReview: 2, sent: 1, coverageComplete: false, reason: '列表未确认到底' },
    observation: { current: { stage: 'LIST_READY_NO_SELECTION', detail: '联系人可见，尚未选中 HR', observedAt: 2000 }, lastSuccess: { observedAt: 1000 } } }
  vi.stubGlobal('fetch', vi.fn(async () => response(status)))
  render(<HrVisualPanel profileId={4} profileName="本人" />)
  expect(await screen.findByText(/列表已加载，尚未选择 HR/)).toBeInTheDocument()
  expect(screen.getByText(/尚未确认完整覆盖/)).toBeInTheDocument()
  expect(screen.getByText(/历史观察，不代表当前页面仍然就绪/)).toBeInTheDocument()
  expect(screen.getByText(/已发现 12 人 · 正文已核验 9 人 · 待资料或审核 2 人/)).toBeInTheDocument()
  expect(screen.getByText(/当前尝试全部步骤已确认 1 人；文字和简历分别统计暂不可用/)).toBeInTheDocument()
  expect(screen.queryByText(/文字已确认发送 0 条/)).not.toBeInTheDocument()
})

it('shows confirmed actions independently of an unknown second step and preserves unresolved coverage', async () => {
  const status = { installed: true, protocol: '2026-09-29-hr-visual-v3', executing: false, running: false, status: 'IDLE', targets: [],
    batch: { id: 'b', status: 'PAUSED', discovered: 8, checked: 4, pendingReview: 1, sent: 0,
      textSentConfirmed: 1, resumeSentConfirmed: 0, pending: 2, noReply: 1, excluded: 1, unknown: 1, unknownSteps: 1, blocked: 1, readFailed: 1, dateUnknown: 0, stale: 0,
      statusCounts: { PENDING: 2, SKIPPED: 1, EXCLUDED: 1, SEND_UNKNOWN: 1, BLOCKED: 1, READ_FAILED: 1, REVIEW_REQUIRED: 1 }, coverageComplete: false },
    observation: { current: { stage: 'OBSERVATION_FAILED', errorCode: 'FOCUS_CHANGED', detail: '窗口焦点变化，停止操作；前台进程：ChatGPT.exe；物理输入：未检测到', observedAt: 2000 } } }
  vi.stubGlobal('fetch', vi.fn(async () => response(status)))
  render(<HrVisualPanel profileId={4} profileName="本人" />)
  expect(await screen.findByText('文字已确认发送 1 条 · 简历已确认发送 0 份 · 当前尝试全部步骤已确认 0 人')).toBeInTheDocument()
  expect(screen.getByText('尚待读取或执行 2 人 · 已跳过/无需回复 1 人 · 本轮排除 1 人')).toBeInTheDocument()
  expect(screen.getByText(/发送结果未知 1 人 · 读取失败 1 人 · 已阻塞 1 人/)).toBeInTheDocument()
  expect(screen.getByText('观察结果代码：FOCUS_CHANGED')).toBeInTheDocument()
  expect(screen.getByText(/前台进程：ChatGPT.exe；物理输入：未检测到/)).toBeInTheDocument()
  expect(screen.getByText(/尚未确认完整覆盖/)).toBeInTheDocument()
  expect(localActionFetch).not.toHaveBeenCalled()
})

it('keeps an earlier unknown attempt visible after a later explicitly reconfirmed attempt succeeds', async () => {
  const status = { installed: true, protocol: '2026-09-29-hr-visual-v3', executing: false, running: false, status: 'IDLE', targets: [],
    batch: { id: 'b', status: 'INCOMPLETE', sent: 1, textSentConfirmed: 1, resumeSentConfirmed: 0, unknown: 0, unknownSteps: 1,
      statusCounts: { SENT_CONFIRMED: 1 }, coverageComplete: false } }
  vi.stubGlobal('fetch', vi.fn(async () => response(status)))
  render(<HrVisualPanel profileId={4} profileName="本人" />)
  expect(await screen.findByText(/当前尝试全部步骤已确认 1 人/)).toBeInTheDocument()
  expect(screen.getByText('保留未知发送记录 1 条（含之前尝试）；未知步骤不自动重试')).toBeInTheDocument()
  expect(screen.getByText(/尚未确认完整覆盖/)).toBeInTheDocument()
  expect(localActionFetch).not.toHaveBeenCalled()
})

it('starts a finite batch with separate resume consent and no automatic text setting', async () => {
  const status = { installed: true, protocol: '2026-09-29-hr-visual-v3', running: false, status: 'IDLE', targets: [] }
  vi.stubGlobal('fetch', vi.fn(async () => response(status)))
  vi.mocked(localActionFetch).mockImplementation(async () => response(status))
  render(<HrVisualPanel profileId={4} profileName="本人" />)
  const button = await screen.findByRole('button', { name: '检查一轮其他 HR' })
  expect(button).toBeDisabled()
  fireEvent.click(screen.getByLabelText('允许向明确索要简历的 HR 直接分享当前 BOSS 简历'))
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  await waitFor(() => expect(localActionFetch).toHaveBeenCalledOnce())
  const [url, init] = vi.mocked(localActionFetch).mock.calls[0]
  expect(url).toContain('/visual/batches')
  expect(JSON.parse(String(init?.body))).toMatchObject({ profileId: 4, resumeSharingConfirmed: true, protocol: status.protocol, requestKey: expect.any(String) })
  expect(String(init?.body)).not.toContain('replyMode')
})

it('requires separate resume consent and sends no automatic text policy setting', async () => {
  const status = { installed: true, protocol: '2026-09-29-hr-visual-v3', running: false, status: 'IDLE', targets: [], resumeRule: { enabled: false, state: 'STOPPED' } }
  vi.stubGlobal('fetch', vi.fn(async () => response(status)))
  vi.mocked(localActionFetch).mockResolvedValue(response(status))
  render(<HrVisualPanel profileId={4} profileName="本人" />)
  const button = await screen.findByRole('button', { name: '启用自动简历规则' })
  expect(button).toBeDisabled()
  fireEvent.click(screen.getByLabelText('允许向明确索要简历的 HR 直接分享当前 BOSS 简历'))
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  await waitFor(() => expect(localActionFetch).toHaveBeenCalledOnce())
  const request = JSON.parse(String(vi.mocked(localActionFetch).mock.calls[0][1]?.body))
  expect(request).toMatchObject({ enabled: true, confirmed: true, profileId: 4 })
  expect(request.replyMode).toBeUndefined()
})

it('starts exactly three chosen conversations in QQ review mode without an extension', async () => {
  const status = { installed: true, protocol: '2026-09-29-hr-visual-v3', running: false, status: 'IDLE', targets: [] }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('/proposals') ? [1, 2, 3, 4].map(id => ({ id, conversationId: id, version: 2, status: 'EXPIRED', hrName: `HR${id}`, companyName: `公司${id}`, draft: '原建议' })) : status)))
  vi.mocked(localActionFetch).mockResolvedValue(response(status))
  render(<HrVisualPanel profileId={4} profileName="测试本人" />)
  const choose = await screen.findByRole('button', { name: '选择三个已有会话' })
  await waitFor(() => expect(choose).toBeEnabled()); fireEvent.click(choose)
  fireEvent.click(await screen.findByLabelText('HR1 · 公司1'))
  fireEvent.click(screen.getByLabelText('HR2 · 公司2'))
  fireEvent.click(screen.getByLabelText('HR3 · 公司3'))
  expect(screen.getByLabelText('HR4 · 公司4')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '读取并发送 QQ 建议卡（3/3）' }))
  await waitFor(() => expect(localActionFetch).toHaveBeenCalledOnce())
  const request = JSON.parse(String(vi.mocked(localActionFetch).mock.calls[0][1]?.body))
  expect(request).toMatchObject({ profileId: 4, accountName: '测试本人', protocol: '2026-09-29-hr-visual-v3' })
  expect(request.targets).toHaveLength(3)
  expect(request.targets.every((t: { approved: boolean; sendResume: boolean }) => !t.approved && !t.sendResume)).toBe(true)
})

it('keeps successful text distinct from unknown resume and permits no resend', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ installed: true, protocol: '2026-09-29-hr-visual-v3', running: false, status: 'COMPLETED', targets: [{ id: 't', hrName: 'HR', companyName: '公司', status: 'SEND_UNKNOWN', reason: '不得重试', steps: [{ id: 'a', action_type: 'TEXT', status: 'SENT_CONFIRMED' }, { id: 'b', action_type: 'RESUME_NATIVE', status: 'SEND_UNKNOWN' }] }] })))
  render(<HrVisualPanel profileId={4} profileName="本人" />)
  expect(await screen.findByText('文字回复：已确认发送')).toBeInTheDocument()
  expect(screen.getByText('BOSS 原生简历：发送结果未知')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /重新发送/ })).not.toBeInTheDocument()
})

it('reports incompatible status and cannot start without installed worker', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ installed: false, protocol: '2026-09-29-hr-visual-v3', running: false, status: 'IDLE', targets: [] })))
  render(<HrVisualPanel profileId={4} profileName="本人" />)
  expect(await screen.findByText(/视觉环境尚未安装/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '选择三个已有会话' })).toBeDisabled()
})
