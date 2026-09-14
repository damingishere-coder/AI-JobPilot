import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

const root = resolve(process.cwd(), '../chrome-extension')
function fixture(file: string) { return readFileSync(resolve(root, 'tests/fixtures/zhilian', file), 'utf8') }
function harness(html: string, permit = false) {
  const doc = document.implementation.createHTMLDocument('synthetic')
  doc.body.innerHTML = html
  Object.defineProperty(doc, 'readyState', { value: 'complete' })
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent } })
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.closest('[hidden],[style*="display:none"]') ? null : this.parentElement } })
  for (const node of doc.querySelectorAll('*')) node.getBoundingClientRect = () => ({ width:100,height:20 }) as DOMRect
  const scope: Record<string, any> = { location: new URL('https://www.zhaopin.com/jobdetail/CC100J200.htm'),
    getComputedStyle: (node: Element) => window.getComputedStyle(node), setTimeout: () => 0 }
  const requests: any[] = [], clicks: unknown[] = []
  const context = { window:scope,document:doc,URL,URLSearchParams,Element,console,clearTimeout,clicks,sessionStorage:{getItem:()=>null},
    chrome:{runtime:{onMessage:{addListener:()=>{}},sendMessage:async(request: unknown)=>{requests.push(request);return {success:true,data:{success:true,permitted:permit}}}},storage:{local:{get:async()=>({})}}} }
  for (const file of ['zhilian-scan-support.js','zhilian-page-evidence.js','browser-application-runtime.js']) runInNewContext(readFileSync(resolve(root,file),'utf8'),context)
  const source=readFileSync(resolve(root,'zhilian-content.js'),'utf8').replace(/\}\)\(\);\s*$/, `
    window.testObserve = () => window.GetJobsZhilianPageEvidence.observe({document,href:window.location.href,signals:buildPageBlockDiagnostics()});
    waitForPage=async()=>{};sleep=async()=>{};postProgress=()=>{};
    clickElement=element=>{clicks.push(element);throw new Error('SYNTHETIC_CLICK_BOUNDARY')};
    window.testDelivery=deliverOnCurrentPage;
  })();`)
  runInNewContext(source,context)
  return {doc,scope,api:scope.GetJobsZhilianPageEvidence,observe:scope.testObserve,requests,clicks}
}
it('replays the real Zhilian security detector against external synthetic structure', () => {
  const h=harness(fixture('detail/split.html')+fixture('states/blocked.html'))
  expect(h.observe()).toMatchObject({pageType:'JOB_DETAIL',blocker:'VERIFICATION_REQUIRED',jobKey:'CC100J200'})
  expect(h.api.evaluateEvidence(h.doc,h.observe())).toMatchObject({outcome:'UNKNOWN',newApplication:false})
})
it('keeps delivery proof exact, visible and separate from existing applications', () => {
  const h=harness(fixture('detail/split.html')+'<button>已申请</button>')
  expect(h.api.evaluateEvidence(h.doc,h.observe(),false)).toMatchObject({outcome:'CONFIRMED',effect:'ALREADY_APPLIED',newApplication:false})
  h.doc.querySelector('button')!.textContent='已申请职位的处理方法'
  expect(h.api.evaluateEvidence(h.doc,h.observe())).toMatchObject({outcome:'UNKNOWN'})
  h.doc.querySelector('button')!.textContent='已申请'
  h.doc.querySelector('button')!.setAttribute('style','display:none')
  expect(h.api.evaluateEvidence(h.doc,h.observe())).toMatchObject({outcome:'UNKNOWN'})
})
it('exhausted delivery quota overrides stale success and observation contains no content', () => {
  const h=harness(fixture('detail/split.html')+'<div role="dialog">今日投递次数已用完</div><button>已申请</button>')
  expect(h.observe()).toMatchObject({blocker:'QUOTA_LIMIT'})
  expect(h.api.evaluateEvidence(h.doc,h.observe())).toMatchObject({outcome:'UNKNOWN'})
  expect(JSON.stringify(h.observe())).not.toMatch(/公司介绍|岗位职责|jobdetail|示例招聘/)
})
it('login overlays cannot be confirmed by a stale already-applied button',async()=>{
  const h=harness(fixture('detail/split.html')+fixture('states/login-required.html')+'<button>已申请</button>')
  expect(h.observe().blocker).toBe('LOGIN_REQUIRED')
  const result=await h.scope.testDelivery({id:20,requestKey:'fixture',url:h.scope.location.href},{})
  expect(result.outcome).toBe('FAILED');expect(h.clicks).toHaveLength(0)
})
it('the actual Zhilian entry calls the shared permit before its first favorite click',async()=>{
  for(const permit of [false,true]) {
    const h=harness(fixture('detail/split.html')+'<button>收藏</button><button>申请职位</button>',permit)
    const action=h.scope.testDelivery({id:20,profileId:1,requestKey:'fixture',url:h.scope.location.href,runtime:{runtimeSessionId:'session',claimVersion:1}},{pageTabId:99})
    if(permit) await expect(action).rejects.toThrow('SYNTHETIC_CLICK_BOUNDARY')
    else expect(await action).toMatchObject({outcome:'UNKNOWN',actionStarted:false})
    expect(h.requests.filter(request=>request.operation==='runtime-begin')).toHaveLength(1)
    expect(h.clicks).toHaveLength(permit?1:0)
  }
})
