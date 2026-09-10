import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const require=createRequire(import.meta.url)
const script=readFileSync(require.resolve('../../chrome-extension/boss-hr-bridge.js'),'utf8')
function harness(storage:Map<string,string>, valid=true) {
  const events=new Map<string,(event?:unknown)=>void>()
  let listener:(message:object,sender:object,respond:(value:Record<string,unknown>)=>void)=>unknown=()=>{}
  const pageSafety=vi.fn(()=>({safe:false,errorCode:'TEST_STOP'}))
  const same={}
  runInNewContext(script,{
    window:{top:same,self:same,addEventListener:(name:string,fn:(event?:unknown)=>void)=>events.set(name,fn)},
    document:{},location:{href:'https://www.zhipin.com/web/geek/chat?getjobs-autopilot=1'},
    sessionStorage:{getItem:(key:string)=>storage.get(key),setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)},
    GetJobsBossHrSupport:{pageSafety},
    chrome:{runtime:{onMessage:{addListener:(fn:typeof listener)=>{listener=fn}},
      sendMessage:(message:{operation:string},respond:(value:object)=>void)=>respond(message.operation==='hr-pause'?{success:false}:
        {success:true,data:{data:{enabled:true,paused:false,watchActive:true,authorizationValid:valid,version:2}}})}}
  })
  const scan=()=>new Promise<Record<string,unknown>>(resolve=>listener({source:'GET_JOBS_BACKGROUND',type:'BOSS_HR_SCAN_V2',managed:true},{},resolve))
  return {scan,events,pageSafety}
}
describe('managed tab authorization guard',()=>{
  it('rejects stale settings before reading or operating the page',async()=>{
    const h=harness(new Map(),false)
    const result=await h.scan()
    expect(result.success).toBe(false)
    expect(h.pageSafety).not.toHaveBeenCalled()
  })
  it('keeps a manual pause across reload even when backend pause fails',async()=>{
    const storage=new Map<string,string>()
    const first=harness(storage)
    await first.scan()
    first.events.get('pointerdown')!({isTrusted:true,composedPath:()=>[]})
    expect(storage.get('getjobs-hr-paused')).toBe('1')
    const reloaded=harness(storage)
    await reloaded.scan()
    expect(reloaded.pageSafety).not.toHaveBeenCalled()
    await new Promise(resolve=>setTimeout(resolve,0))
    reloaded.events.get('getjobs:hr:resume')!()
    await reloaded.scan()
    expect(reloaded.pageSafety).toHaveBeenCalledTimes(1)
  })
})
