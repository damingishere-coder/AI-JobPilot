import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import BossWorkspace from './BossWorkspace'
import { ScanRequestError } from '@/lib/scan-runs'

const mocks = vi.hoisted(() => ({ bridge: vi.fn(), command: vi.fn(), register:vi.fn(),events:vi.fn() }))
vi.mock('@/lib/chromeBridge', () => ({
  sendChromeBridgeMessage: mocks.bridge,
  getChromeBridgeStatus: vi.fn(async () => ({ success: true })),
  subscribeChromeBridgeEvents: mocks.events,
}))
vi.mock('@/lib/scan-runs', async original => ({
  ...await original<typeof import('@/lib/scan-runs')>(), scanCommand: mocks.command,registerScan:mocks.register,
}))
vi.mock('@/lib/sse', () => ({ createSSEWithBackoff: vi.fn(() => ({ close: vi.fn() })) }))
vi.mock('@/app/boss/analysis/AnalysisContent', () => ({ default: () => null }))
vi.mock('@/lib/setupChecklist',()=>({validateSetupForPlatform:vi.fn(async()=>({ready:true,missing:[]})),formatSetupMissingMessage:()=>''}))

let runs: Record<string, unknown>[]
const running = { platform: 'boss', profile_id: 4, run_id: 'boss-current', state: 'RUNNING', desired: 'RUNNING', historyComplete: true, accepted: 0, commands: [] }
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  runs = [{ ...running }]
  mocks.bridge.mockResolvedValue({ success: true, profileId: 4, runId: 'boss-current', isRunning: true, hasStoredTask: true, stage: 'searching' })
  mocks.command.mockResolvedValue({ ...running, desired: 'STOPPED' })
  mocks.register.mockResolvedValue({...running})
  mocks.events.mockImplementation(()=>()=>{})
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

it('saved STOP releases the primary action while history preserves the pending acknowledgment', async () => {
  await openRunningWorkbench()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '停止扫描' })) })
  expect(mocks.command).toHaveBeenCalledWith('boss', 4, 'boss-current', 'STOP')
  runs = [{ ...running, desired: 'STOPPED', commands: [{ id: 'stop', kind: 'STOP', status: 'PENDING' }] }]
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(screen.getByRole('button', { name: '开始扫描' })).toBeInTheDocument()
  expect(screen.getByText(/停止约束已保存/)).toBeInTheDocument()
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(screen.queryByRole('button', { name: '停止中...' })).not.toBeInTheDocument()
  expect(mocks.command).toHaveBeenCalledTimes(1)
  runs = [{ ...running, state: 'STOPPED', desired: 'STOPPED', commands: [{ id: 'stop', kind: 'STOP', status: 'ACKNOWLEDGED' }] }]
  mocks.bridge.mockResolvedValue({ success: true, isRunning: false, stage: 'idle' })
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(screen.queryByRole('button', { name: '停止扫描' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始扫描' })).toBeInTheDocument()
})

it('backend blocked state wins over a stale navigating extension reply; continue targets the same run', async () => {
  let eventHandler:((event:{payload:Record<string,unknown>})=>void)|undefined
  mocks.events.mockImplementation(callback=>{eventHandler=callback;return()=>{}})
  runs = [{ ...running, state: 'BLOCKED', error_code: 'LOGIN_REQUIRED' }]
  mocks.bridge.mockResolvedValue({success:true,profileId:4,runId:'boss-current',isRunning:true,hasStoredTask:true,stage:'navigating'})
  await act(async () => { render(<BossWorkspace />) })
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(screen.queryByRole('button',{name:'停止扫描'})).not.toBeInTheDocument()
  expect(screen.getByRole('button',{name:'继续扫描'})).toBeInTheDocument()
  await act(async()=>{eventHandler?.({payload:{platform:'boss',profileId:4,runId:'boss-current',operation:'scan',type:'error',stage:'error',message:'stale error'}})})
  expect(screen.getByRole('button',{name:'继续扫描'})).toBeInTheDocument()
  mocks.command.mockResolvedValue({...running})
  await act(async () => { fireEvent.click(screen.getByRole('button',{name:'继续扫描'})) })
  expect(mocks.command).toHaveBeenCalledWith('boss',4,'boss-current','RESUME')
})

it('a workbench reload preserves pending STOP history without blocking a new round or submitting STOP twice', async () => {
  runs = [{...running,state:'BLOCKED',desired:'STOPPED',commands:[{id:'stop',kind:'STOP',status:'PENDING'}]}]
  await act(async () => { render(<BossWorkspace />) })
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(screen.getByText(/停止约束已保存/)).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'开始扫描'})).toBeEnabled()
  expect(screen.queryByText('扫描中',{selector:'span'})).not.toBeInTheDocument()
  expect(screen.queryByRole('button',{name:'继续扫描'})).not.toBeInTheDocument()
  expect(mocks.command).not.toHaveBeenCalled()
})
it('unknown start remains blocked and cannot automatically resume or restart', async () => {
  runs = [{...running,state:'BLOCKED',error_code:'SCAN_START_UNCONFIRMED',pageConnected:true}]
  await act(async () => {render(<BossWorkspace />)})
  await act(async () => {window.dispatchEvent(new Event('focus'))})
  expect(screen.getByRole('button',{name:'启动待核实'})).toBeDisabled()
  expect(screen.getByRole('button',{name:'继续'})).toBeDisabled()
  expect(mocks.command).not.toHaveBeenCalled()
})
it('unknown ordinary status survives stale backend STARTING and does not offer resume or redispatch',async()=>{
  runs=[{...running,state:'STARTING'}]
  mocks.bridge.mockResolvedValue({success:true,profileId:4,runId:'boss-current',startUnconfirmed:true,errorCode:'SCAN_START_UNCONFIRMED',isRunning:false,stage:'startUnconfirmed'})
  await act(async()=>{render(<BossWorkspace />);window.dispatchEvent(new Event('focus'))})
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000);window.dispatchEvent(new Event('focus'))})
  expect(screen.getByRole('button',{name:'启动待核实'})).toBeDisabled()
  expect(screen.queryByRole('button',{name:'继续扫描'})).not.toBeInTheDocument()
  expect(screen.queryByRole('button',{name:'停止扫描'})).not.toBeInTheDocument()
  mocks.bridge.mockResolvedValue({success:true,profileId:4,runId:'boss-current',paused:true,resumable:true,isRunning:false,stage:'blocked'})
  await act(async()=>{window.dispatchEvent(new Event('focus'))})
  expect(screen.getByRole('button',{name:'启动待核实'})).toBeDisabled()
  expect(mocks.register).not.toHaveBeenCalled()
  expect(mocks.command).not.toHaveBeenCalled()
})
for(const stage of ['complete','stopped','error'])it(`accepted reconciled ${stage} cannot leave the workspace running or paused`,async()=>{
  runs=[]
  mocks.bridge.mockImplementation(async message=>message.type==='BOSS_SCAN_START'
    ?{success:true,startAccepted:true,reconciled:true,profileId:4,runId:message.runId,scanOwnerToken:'owner',stage,isRunning:false,paused:true,resumable:true}
    :{success:true,profileId:4,isRunning:false,stage:'idle'})
  await act(async()=>{render(<BossWorkspace />)})
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'开始扫描'}))})
  expect(screen.getByRole('button',{name:'开始扫描'})).toBeEnabled()
  expect(screen.queryByRole('button',{name:'继续扫描'})).not.toBeInTheDocument()
  expect(screen.queryByRole('button',{name:'停止扫描'})).not.toBeInTheDocument()
})
it('a registration conflict preserves its code and targets the exact current profile run', async () => {
  runs=[]
  mocks.bridge.mockResolvedValue({success:true,profileId:4,isRunning:false,stage:'idle'})
  mocks.register.mockImplementation(async()=>{
    runs=[{...running,run_id:'boss-blocking',state:'BLOCKED',error_code:'LOGIN_REQUIRED',pageConnected:true}]
    throw new ScanRequestError('PLATFORM_SCAN_ALREADY_ACTIVE',409,'PLATFORM_SCAN_ALREADY_ACTIVE')
  })
  await act(async()=>{render(<BossWorkspace />)})
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'开始扫描'}))})
  expect(screen.getByText(/已定位当前档案的扫描 boss-blocking/)).toBeInTheDocument()
  expect(screen.getByRole('combobox',{name:'选择扫描记录'})).toHaveValue('boss-blocking')
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'继续扫描'}))})
  expect(mocks.command).toHaveBeenCalledWith('boss',4,'boss-blocking','RESUME')
})
it('conflict without a verified run in this profile cannot control another profile',async()=>{
  runs=[]
  mocks.bridge.mockResolvedValue({success:true,profileId:4,isRunning:false,stage:'idle'})
  mocks.register.mockImplementation(async()=>{
    runs=[{...running,profile_id:3,state:'BLOCKED'}]
    throw new ScanRequestError('PLATFORM_SCAN_ALREADY_ACTIVE',409,'PLATFORM_SCAN_ALREADY_ACTIVE')
  })
  await act(async()=>{render(<BossWorkspace />)})
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'开始扫描'}))})
  expect(screen.getByText(/当前档案没有可核实的占用任务/)).toBeInTheDocument()
  expect(mocks.command).not.toHaveBeenCalled()
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
