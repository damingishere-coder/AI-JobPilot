import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import BossWorkspace from './BossWorkspace'

const mocks = vi.hoisted(() => ({ bridge: vi.fn(), command: vi.fn() }))
vi.mock('@/lib/chromeBridge', () => ({
  sendChromeBridgeMessage: mocks.bridge,
  getChromeBridgeStatus: vi.fn(async () => ({ success: true })),
  subscribeChromeBridgeEvents: vi.fn(() => () => {}),
}))
vi.mock('@/lib/scan-runs', async original => ({
  ...await original<typeof import('@/lib/scan-runs')>(), scanCommand: mocks.command,
}))
vi.mock('@/lib/sse', () => ({ createSSEWithBackoff: vi.fn(() => ({ close: vi.fn() })) }))
vi.mock('@/app/boss/analysis/AnalysisContent', () => ({ default: () => null }))

let runs: Record<string, unknown>[]
const running = { platform: 'boss', profile_id: 4, run_id: 'boss-current', state: 'RUNNING', desired: 'RUNNING', historyComplete: true, accepted: 0, commands: [] }
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  runs = [{ ...running }]
  mocks.bridge.mockResolvedValue({ success: true, profileId: 4, runId: 'boss-current', isRunning: true, hasStoredTask: true, stage: 'searching' })
  mocks.command.mockResolvedValue({ ...running, desired: 'STOPPED' })
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input)
    const body = url.includes('/scan-runs?') ? runs
      : url.includes('/events') ? []
      : url.endsWith('/api/boss/config') ? { success: true, hasProfile: true, currentProfile: { id: 4, name: '测试档案' }, config: { keywords: '["AI产品运营"]', cityCode: '101280600', searchJobLimit: 30, autoDeliver: 0 }, options: { city: [], industry: [], experience: [], jobType: [], salary: [], degree: [], scale: [], stage: [] }, blacklist: [] }
      : { success: true, data: { keywords: [] } }
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  }))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })

async function openRunningWorkbench() {
  await act(async () => { render(<BossWorkspace />) })
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(screen.getByRole('button', { name: '停止扫描' })).toBeInTheDocument()
}

it('clears the stop button after a real STOP acknowledgment even when the extension has lost its session', async () => {
  await openRunningWorkbench()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '停止扫描' })) })
  expect(mocks.command).toHaveBeenCalledWith('boss', 4, 'boss-current', 'STOP')
  runs = [{ ...running, desired: 'STOPPED', commands: [{ id: 'stop', kind: 'STOP', status: 'PENDING' }] }]
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(screen.getAllByRole('button', { name: '停止中...' })[0]).toBeDisabled()
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(screen.getAllByRole('button', { name: '停止中...' })[0]).toBeDisabled()
  expect(mocks.command).toHaveBeenCalledTimes(1)
  runs = [{ ...running, state: 'STOPPED', desired: 'STOPPED', commands: [{ id: 'stop', kind: 'STOP', status: 'ACKNOWLEDGED' }] }]
  mocks.bridge.mockResolvedValue({ success: true, isRunning: false, stage: 'idle' })
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(screen.queryByRole('button', { name: '停止扫描' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始扫描' })).toBeInTheDocument()
})

it('backend blocked state wins over a stale navigating extension reply; continue targets the same run', async () => {
  runs = [{ ...running, state: 'BLOCKED', error_code: 'LOGIN_REQUIRED' }]
  mocks.bridge.mockResolvedValue({success:true,profileId:4,runId:'boss-current',isRunning:true,hasStoredTask:true,stage:'navigating'})
  await act(async () => { render(<BossWorkspace />) })
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(screen.queryByRole('button',{name:'停止扫描'})).not.toBeInTheDocument()
  expect(screen.getByRole('button',{name:'继续扫描'})).toBeInTheDocument()
  mocks.command.mockResolvedValue({...running})
  await act(async () => { fireEvent.click(screen.getByRole('button',{name:'继续扫描'})) })
  expect(mocks.command).toHaveBeenCalledWith('boss',4,'boss-current','RESUME')
})

it('a workbench reload restores a pending STOP and cannot show scanning or submit it twice', async () => {
  runs = [{...running,state:'BLOCKED',desired:'STOPPED',commands:[{id:'stop',kind:'STOP',status:'PENDING'}]}]
  await act(async () => { render(<BossWorkspace />) })
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(screen.getAllByRole('button',{name:'停止中...'})[0]).toBeDisabled()
  expect(screen.queryByText('扫描中',{selector:'span'})).not.toBeInTheDocument()
  expect(screen.queryByRole('button',{name:'继续扫描'})).not.toBeInTheDocument()
})

it('a completed latest scan cannot resurrect an older historical pending STOP on reload', async () => {
  runs = [{...running,state:'STOPPED',desired:'STOPPED'},
    {...running,run_id:'boss-historical',state:'BLOCKED',desired:'STOPPED',commands:[{id:'old-stop',kind:'STOP',status:'PENDING'}]}]
  mocks.bridge.mockResolvedValue({success:true,profileId:4,isRunning:false,stage:'idle'})
  await act(async () => { render(<BossWorkspace />) })
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(screen.queryByRole('button',{name:'停止中...'})).not.toBeInTheDocument()
  expect(screen.getByRole('button',{name:'开始扫描'})).toBeInTheDocument()
})

it('a stale running extension reply cannot restart the stopped UI; another run or profile cannot stop the current UI', async () => {
  await openRunningWorkbench()
  runs = [
    { ...running, run_id: 'boss-old', state: 'STOPPED' },
    { ...running, profile_id: 3, state: 'STOPPED' },
  ]
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(screen.getByRole('button', { name: '停止扫描' })).toBeInTheDocument()
  runs = [{ ...running, state: 'STOPPED', desired: 'STOPPED' }]
  await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
  expect(screen.queryByRole('button', { name: '停止扫描' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始扫描' })).toBeInTheDocument()
})

it('terminal extension status wins over leftover paused and stored-task flags', async () => {
  await openRunningWorkbench()
  mocks.bridge.mockResolvedValue({ success: true, profileId: 4, runId: 'boss-current', stage: 'stopped', paused: true, resumable: true, hasStoredTask: true })
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(screen.queryByRole('button', { name: '停止扫描' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始扫描' })).toBeInTheDocument()
  mocks.bridge.mockResolvedValue({ success: true, profileId: 4, runId: 'boss-current', isRunning: true, hasStoredTask: true, stage: 'searching' })
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(screen.queryByRole('button', { name: '停止扫描' })).not.toBeInTheDocument()
})
