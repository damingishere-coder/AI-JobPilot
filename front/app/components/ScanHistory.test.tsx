import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { afterEach,expect,it,vi } from 'vitest'
import ScanHistory from './ScanHistory'
import { scanCommand } from '@/lib/scan-runs'
vi.mock('@/lib/scan-runs',async importOriginal=>({...await importOriginal<typeof import('@/lib/scan-runs')>(),scanCommand:vi.fn()}))
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks()})
const run={run_id:'boss-test',state:'RUNNING',desired:'RUNNING',historyComplete:true,accepted:7,pageConnected:false,backgroundConnected:true,commands:[]}
it('backend counts and stale page state remain visible without Chrome Bridge',async()=>{
  vi.stubGlobal('fetch',vi.fn(async (url:string)=>({ok:true,json:async()=>url.includes('/events')?[]:[run]})))
  const first=render(<ScanHistory platform="boss" profileId={4}/> )
  await screen.findByText('7');expect(screen.getByText(/状态待核实/)).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'继续'})).toBeDisabled()
  vi.mocked(scanCommand).mockResolvedValue({...run,desired:'STOPPED',commands:[{id:'c1',kind:'STOP',status:'PENDING'}]})
  fireEvent.click(screen.getByRole('button',{name:'停止本轮'}))
  await screen.findByText(/请求已保存，等待扩展执行/)
  expect(screen.queryByText('已停止')).not.toBeInTheDocument()
  expect(scanCommand).toHaveBeenCalledWith('boss',4,'boss-test','STOP')
  first.unmount();render(<ScanHistory platform="boss" profileId={4}/>);await screen.findByText('7')
})
it('old or malformed server responses cannot crash the workbench',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({success:true})})))
  render(<ScanHistory platform="zhilian" profileId={4}/>)
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('接口版本不兼容'))
})
it('requested blocking run is selected and control response immediately updates its parent',async()=>{
  const onRuns=vi.fn()
  const old={...run,run_id:'boss-blocking',platform:'boss',profile_id:4,state:'BLOCKED',pageConnected:true,error_code:'LOGIN_REQUIRED'}
  vi.stubGlobal('fetch',vi.fn(async (url:string)=>({ok:true,json:async()=>url.includes('/events')?[]:[run,old]})))
  render(<ScanHistory platform="boss" profileId={4} requestedRunId="boss-blocking" onRuns={onRuns}/> )
  await waitFor(()=>expect(screen.getByRole('combobox')).toHaveValue('boss-blocking'))
  vi.mocked(scanCommand).mockResolvedValue({...old,desired:'STOPPED',commands:[{id:'c1',kind:'STOP',status:'PENDING'}]})
  fireEvent.click(screen.getByRole('button',{name:'停止本轮'}))
  await screen.findByText(/停止约束已保存/)
  expect(onRuns).toHaveBeenLastCalledWith('boss',4,[run,expect.objectContaining({run_id:'boss-blocking',desired:'STOPPED'})])
  expect(scanCommand).toHaveBeenCalledWith('boss',4,'boss-blocking','STOP')
})
it('unknown start cannot be resumed even if the page is connected',async()=>{
  vi.stubGlobal('fetch',vi.fn(async (url:string)=>({ok:true,json:async()=>url.includes('/events')?[]:[{...run,state:'BLOCKED',pageConnected:true,error_code:'SCAN_START_UNCONFIRMED'}]})))
  render(<ScanHistory platform="boss" profileId={4}/> )
  await screen.findByText(/启动回执未确认/)
  expect(screen.getByRole('button',{name:'继续'})).toBeDisabled()
  expect(screen.getByRole('button',{name:'停止本轮'})).toBeEnabled()
})
