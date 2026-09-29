import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import HrVisualPanel from './HrVisualPanel'
import { localActionFetch } from '@/lib/api'

vi.mock('@/lib/api', async () => ({ ...await vi.importActual('@/lib/api'), localActionFetch: vi.fn() }))
const response = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { 'Content-Type': 'application/json' } })
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('starts exactly three chosen conversations in QQ review mode without an extension', async () => {
  const status = { installed: true, protocol: 'visual-test', running: false, status: 'IDLE', targets: [] }
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
  expect(request).toMatchObject({ profileId: 4, accountName: '测试本人', protocol: 'visual-test' })
  expect(request.targets).toHaveLength(3)
  expect(request.targets.every((t: { approved: boolean; sendResume: boolean }) => !t.approved && !t.sendResume)).toBe(true)
})

it('keeps successful text distinct from unknown resume and permits no resend', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ installed: true, protocol: 'p', running: false, status: 'COMPLETED', targets: [{ id: 't', hrName: 'HR', companyName: '公司', status: 'SEND_UNKNOWN', reason: '不得重试', steps: [{ id: 'a', action_type: 'TEXT', status: 'SENT_CONFIRMED' }, { id: 'b', action_type: 'RESUME_NATIVE', status: 'SEND_UNKNOWN' }] }] })))
  render(<HrVisualPanel profileId={4} profileName="本人" />)
  expect(await screen.findByText('文字回复：已确认发送')).toBeInTheDocument()
  expect(screen.getByText('BOSS 原生简历：发送结果未知')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /重新发送/ })).not.toBeInTheDocument()
})

it('reports incompatible status and cannot start without installed worker', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ installed: false, protocol: 'p', running: false, status: 'IDLE', targets: [] })))
  render(<HrVisualPanel profileId={4} profileName="本人" />)
  expect(await screen.findByText(/视觉环境尚未安装/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '选择三个已有会话' })).toBeDisabled()
})
