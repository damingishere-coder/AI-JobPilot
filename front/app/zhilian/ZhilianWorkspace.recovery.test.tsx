import { act,cleanup,fireEvent,render,screen } from '@testing-library/react'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import ZhilianWorkspace from './ZhilianWorkspace'
import { ScanRequestError } from '@/lib/scan-runs'

const mocks=vi.hoisted(()=>({bridge:vi.fn(),command:vi.fn(),register:vi.fn(),events:vi.fn()}))
vi.mock('@/lib/chromeBridge',()=>({sendChromeBridgeMessage:mocks.bridge,subscribeChromeBridgeEvents:mocks.events}))
vi.mock('@/lib/scan-runs',async original=>({...await original<typeof import('@/lib/scan-runs')>(),scanCommand:mocks.command,registerScan:mocks.register}))
vi.mock('@/lib/zhilian-page-status',()=>({getZhilianPageStatus:async()=>({connected:true,ready:true,message:'Chrome 智联可用'})}))
vi.mock('@/lib/setupChecklist',()=>({validateSetupForPlatform:vi.fn(async()=>({ready:true,missing:[]})),formatSetupMissingMessage:()=>''}))
vi.mock('@/lib/sse',()=>({createSSEWithBackoff:vi.fn(()=>({close:vi.fn()}))}))

let runs:Record<string,unknown>[]
const running={platform:'zhilian',profile_id:4,run_id:'zhilian-200',state:'RUNNING',desired:'RUNNING',historyComplete:true,accepted:0,commands:[]}
beforeEach(()=>{
  vi.useFakeTimers();localStorage.clear();sessionStorage.clear()
  runs=[{...running}]
  mocks.events.mockImplementation(()=>()=>{})
  mocks.bridge.mockResolvedValue({success:true,profileId:4,runId:'zhilian-200',isRunning:true,hasStoredTask:true,stage:'navigating'})
  mocks.command.mockResolvedValue({...running,desired:'STOPPED',commands:[{id:'stop',kind:'STOP',status:'PENDING'}]})
  mocks.register.mockResolvedValue({...running})
  vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
    const url=String(input)
    const body=url.includes('/scan-runs?')?runs:url.includes('/events')?[]
      :url.endsWith('/api/zhilian/config')?{success:true,hasProfile:true,currentProfile:{id:4,name:'测试档案'},config:{keywords:'["开发"]',cityCode:'489',searchJobLimit:30},options:{city:[],salary:[]}}
      :url.includes('/config/options/filters')?{success:true,version:'2026-09-08',cityCode:'489',options:{}}
      :url.includes('/local-auth/action-token')?{success:true,data:{token:'offline-test'}}:{success:true,data:{keywords:[]}}
    return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}})
  }))
})
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks()})

it('STOP constraint immediately releases the workspace and stale running replies cannot revive it',async()=>{
  await act(async()=>{render(<ZhilianWorkspace />)})
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'停止扫描'}))})
  expect(mocks.command).toHaveBeenCalledWith('zhilian',4,'zhilian-200','STOP')
  expect(screen.getByRole('button',{name:'开始扫描'})).toBeEnabled()
  runs=[{...running,state:'BLOCKED',desired:'STOPPED',commands:[{id:'stop',kind:'STOP',status:'PENDING'}]}]
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000);window.dispatchEvent(new Event('focus'))})
  expect(screen.getByRole('button',{name:'开始扫描'})).toBeEnabled()
  expect(screen.queryByText('扫描中')).not.toBeInTheDocument()
  expect(screen.getByText(/停止约束已保存/)).toBeInTheDocument()
})

it('backend pause survives stale bridge status and explicit resume uses the retained run',async()=>{
  let eventHandler:((event:{payload:Record<string,unknown>})=>void)|undefined
  mocks.events.mockImplementation(callback=>{eventHandler=callback;return()=>{}})
  runs=[{...running,state:'PAUSED',pageConnected:true}]
  await act(async()=>{render(<ZhilianWorkspace />)})
  await act(async()=>{window.dispatchEvent(new Event('focus'))})
  expect(screen.queryByText('扫描中')).not.toBeInTheDocument()
  await act(async()=>{eventHandler?.({payload:{platform:'zhilian',profileId:4,runId:'zhilian-200',operation:'scan',stage:'stopped',message:'late stop'}})})
  expect(screen.queryByText('扫描中')).not.toBeInTheDocument()
  expect(screen.getByRole('button',{name:'继续'})).toBeEnabled()
  mocks.command.mockResolvedValue({...running})
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'继续'}))})
  expect(mocks.command).toHaveBeenCalledWith('zhilian',4,'zhilian-200','RESUME')
  expect(mocks.register).not.toHaveBeenCalled()
  expect(mocks.bridge.mock.calls.some(([message])=>message.type==='ZHILIAN_SCAN_START')).toBe(false)
  expect(screen.getByRole('button',{name:'停止扫描'})).toBeInTheDocument()
})

it('a new Zhilian run explicitly starts with keyword zero instead of a prior global cursor',async()=>{
  runs=[]
  localStorage.setItem('__GET_JOBS_ZHILIAN_KEYWORD_CURSOR__',JSON.stringify({nextIndex:2,keywordTotal:8}))
  mocks.bridge.mockImplementation(async message=>message.type==='ZHILIAN_SCAN_START'
    ?{success:true,startAccepted:true,profileId:4,runId:message.runId,scanOwnerToken:'owner',isRunning:true,stage:'received'}
    :{success:true,profileId:4,isRunning:false,stage:'idle'})
  await act(async()=>{render(<ZhilianWorkspace />)})
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'开始扫描'}))})
  expect(mocks.register).toHaveBeenCalledTimes(1)
  const starts=mocks.bridge.mock.calls.filter(([message])=>message.type==='ZHILIAN_SCAN_START')
  expect(starts).toHaveLength(1)
  expect(starts[0][0]).toMatchObject({currentIndex:0,profileId:4,resumeIncomplete:false})
  expect(starts[0][0].runId).toMatch(/^zhilian-\d+$/)
  expect(mocks.command).not.toHaveBeenCalled()
})

it('continuing unfinished Zhilian keywords resumes the existing checkpoint without a new START or registration',async()=>{
  runs=[{...running,state:'PAUSED',desired:'PAUSED',pageConnected:true}]
  mocks.bridge.mockResolvedValue({success:true,profileId:4,runId:'zhilian-200',stage:'blocked',paused:true,resumable:true,
    isRunning:false,outcome:'paused',keywordResults:[{keywordIndex:3,keyword:'运营',collected:4,target:30,
      historyDuplicates:0,detailFailures:0,stopReason:'paused',outcome:'partial'}]})
  mocks.command.mockResolvedValue({...running,state:'PAUSED',desired:'RESUMING'})
  await act(async()=>{render(<ZhilianWorkspace />)})
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'继续未完成关键词'}))})
  expect(mocks.command).toHaveBeenCalledWith('zhilian',4,'zhilian-200','RESUME')
  expect(mocks.command).toHaveBeenCalledTimes(1)
  expect(mocks.register).not.toHaveBeenCalled()
  expect(mocks.bridge.mock.calls.some(([message])=>message.type==='ZHILIAN_SCAN_START')).toBe(false)
})

it('a pending stop on reload allows a new round while an unknown start prevents repeat dispatch',async()=>{
  runs=[{...running,state:'BLOCKED',desired:'STOPPED',commands:[{id:'stop',kind:'STOP',status:'PENDING'}]}]
  const first=await act(async()=>render(<ZhilianWorkspace />))
  expect(screen.getByRole('button',{name:'开始扫描'})).toBeEnabled()
  first.unmount()
  runs=[{...running,state:'BLOCKED',error_code:'SCAN_START_UNCONFIRMED',pageConnected:true}]
  await act(async()=>{render(<ZhilianWorkspace />)})
  expect(screen.getByRole('button',{name:'启动待核实'})).toBeDisabled()
  expect(screen.getByRole('button',{name:'继续'})).toBeDisabled()
  expect(mocks.register).not.toHaveBeenCalled()
})
it('unknown ordinary status retains identity while stale backend STARTING and paused replies cannot enable resume',async()=>{
  runs=[{...running,state:'STARTING'}]
  mocks.bridge.mockResolvedValue({success:true,profileId:4,runId:'zhilian-200',startUnconfirmed:true,errorCode:'SCAN_START_UNCONFIRMED',isRunning:false,paused:true,hasStoredTask:true,stage:'blocked'})
  await act(async()=>{render(<ZhilianWorkspace />);window.dispatchEvent(new Event('focus'))})
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000);window.dispatchEvent(new Event('focus'))})
  expect(screen.getByRole('button',{name:'启动待核实'})).toBeDisabled()
  expect(screen.queryByRole('button',{name:'停止扫描'})).not.toBeInTheDocument()
  mocks.bridge.mockResolvedValue({success:true,profileId:4,runId:'zhilian-200',paused:true,resumable:true,isRunning:false,stage:'blocked'})
  await act(async()=>{window.dispatchEvent(new Event('focus'))})
  expect(screen.getByRole('button',{name:'启动待核实'})).toBeDisabled()
  expect(mocks.register).not.toHaveBeenCalled()
  expect(mocks.command).not.toHaveBeenCalled()
})
for(const stage of ['complete','stopped','error'])it(`accepted reconciled ${stage} cannot leave the workspace running or paused`,async()=>{
  runs=[]
  mocks.bridge.mockImplementation(async message=>message.type==='ZHILIAN_SCAN_START'
    ?{success:true,startAccepted:true,reconciled:true,profileId:4,runId:message.runId,scanOwnerToken:'owner',stage,isRunning:false,paused:true,resumable:true}
    :{success:true,profileId:4,isRunning:false,stage:'idle'})
  await act(async()=>{render(<ZhilianWorkspace />)})
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'开始扫描'}))})
  expect(screen.getByRole('button',{name:'开始扫描'})).toBeEnabled()
  expect(screen.queryByRole('button',{name:'停止扫描'})).not.toBeInTheDocument()
  expect(screen.queryByText('已暂停',{selector:'span'})).not.toBeInTheDocument()
})

it('registration conflict is shown with the exact blocking run and keeps other profiles uncontrolled',async()=>{
  runs=[];mocks.bridge.mockResolvedValue({success:true,profileId:4,isRunning:false,stage:'idle'})
  mocks.register.mockImplementation(async()=>{
    runs=[{...running,run_id:'zhilian-blocking',state:'BLOCKED',error_code:'LOGIN_REQUIRED',pageConnected:true}]
    throw new ScanRequestError('PLATFORM_SCAN_ALREADY_ACTIVE',409,'PLATFORM_SCAN_ALREADY_ACTIVE')
  })
  await act(async()=>{render(<ZhilianWorkspace />)})
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'开始扫描'}))})
  expect(screen.getByText(/PLATFORM_SCAN_ALREADY_ACTIVE，HTTP 409/)).toBeInTheDocument()
  expect(screen.getByText(/已定位当前档案的扫描 zhilian-blocking/)).toBeInTheDocument()
  expect(screen.getByRole('combobox',{name:'选择扫描记录'})).toHaveValue('zhilian-blocking')
  expect(mocks.command).not.toHaveBeenCalled()
})
