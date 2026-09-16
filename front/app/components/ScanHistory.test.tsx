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
