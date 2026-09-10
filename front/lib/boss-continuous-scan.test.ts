import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {runInNewContext} from 'node:vm'
import {expect, it, vi} from 'vitest'

const supportScope: Record<string, unknown> = {}
runInNewContext(readFileSync(resolve(process.cwd(), '../chrome-extension/continuous-scan-support.js'),'utf8'), supportScope)
const source = readFileSync(resolve(process.cwd(), '../chrome-extension/boss-content.js'),'utf8')
const collectorSource = source.slice(source.indexOf('  async function collectFreshJobsForKeyword('),source.indexOf('  function addUniqueJobs('))

function harness(onlyHistorical = false) {
  let page = 0
  const wheels: number[] = []
  const jobs = () => Array.from({length:30},(_,i)=>({id:`${page}-${i}`,title:'岗位',company:'公司',url:`https://www.zhipin.com/job_detail/${page}-${i}.html`}))
  document.body.innerHTML = '<div id="jobs"><article></article></div>'
  const container = document.querySelector('#jobs') as HTMLElement
  container.style.overflowY='auto'
  Object.defineProperties(container,{clientHeight:{value:400},scrollHeight:{value:1200}})
  container.scrollTop=800
  container.addEventListener('wheel',event=>{
    wheels.push((event as WheelEvent).deltaY)
    if (page < 2 && wheels.at(-2)! < 0 && (event as WheelEvent).deltaY > 0) page++
  })
  const task = {keywords:['kw'],config:{searchJobLimit:30},continuousScan:{credited:{},receipts:{},keywords:{kw:{attempted:[],observed:[],elapsedMs:0,historyDuplicates:0,detailFailures:0,recoveryAttempts:0}}}}
  const checkpoints: unknown[]=[]
  const context={window:{GetJobsContinuousScan:supportScope.GetJobsContinuousScan,location:{href:'https://www.zhipin.com/web/geek/job'}},document,Date,
    collectJobs:()=>({jobs:jobs()}),collectJobNodes:()=>[container.firstElementChild],isStopRequested:()=>false,
    isJobAllowedByDegree:()=>true,isDetailQueueJob:()=>true,handleBlockingState:()=>null,buildPageBlockDiagnostics:()=>({}),
    filterDuplicateJobs:vi.fn(async(list:Array<{id:string}>)=>({items:list.map(job=>({...job,duplicate:onlyHistorical || !job.id.startsWith('2-'),action:!onlyHistorical && job.id.startsWith('2-')?'NEW':'SKIP'}))})),
    bossPlatformExhausted:()=>false,storeScanTask:(t:unknown)=>checkpoints.push(structuredClone(t)),postProgress:()=>{},sleep:async()=>{}}
  const collect=runInNewContext(`${collectorSource}\ncollectFreshJobsForKeyword`,context)
  return {run:()=>collect('kw',task,{},30),task,wheels,checkpoints}
}
it('Boss crosses two historical batches in a fixed-size virtual list before filling the target',async()=>{
  const h=harness();const result=await h.run()
  expect(result.jobs).toHaveLength(30)
  expect(result.jobs.every((job:{id:string})=>job.id.startsWith('2-'))).toBe(true)
  expect(result.stopReason).toBe('target_reached')
  expect(h.task.continuousScan.keywords.kw.historyDuplicates).toBe(60)
  expect(h.wheels.filter(delta=>delta<0).length).toBeGreaterThan(0)
})
it('historical new card IDs reset stagnation, followed by exactly three unsuccessful recovery cycles',async()=>{
  const h=harness(true);const result=await h.run()
  expect(result.jobs).toHaveLength(0)
  expect(result.stopReason).toBe('stagnation_safety_cap')
  expect(h.task.continuousScan.keywords.kw.historyDuplicates).toBe(90)
  // One successful recovery reaches the second batch; another reaches the third.
  expect(h.wheels.filter(delta=>delta<0)).toHaveLength(5)
})
