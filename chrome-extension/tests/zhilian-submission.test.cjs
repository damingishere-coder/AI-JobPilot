const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../zhilian-content.js'), 'utf8');
function harness(respond) {
  const calls = [], stored = [], logs = [], listeners = [];
  const window = {};
  const hooks = { request: async (op, args) => { calls.push(args.body.jobs.map(j => j.id)); return respond(calls.length, args.body.jobs); },
    store: async task => stored.push(JSON.parse(JSON.stringify(task))), log: (...args) => logs.push(args),
    pause: async (message, jobs, totalSaved, error) => ({paused:true, message:error.message, receipts:message.submissionReceipts}) };
  const code = source.replace('resumeStoredScanTaskIfActive().catch', 'Promise.resolve().catch').replace(/\}\)\(\);\s*$/, `
    window.api = { submit: continueZhilianDetailScan, owned: hasStopRequested, setOwner:token=>expectedScanOwnerToken=token };
    requestZhilianLocalApi = hooks.request; storeScanTask = hooks.store; postProgress = hooks.log;
    pauseZhilianSubmission = hooks.pause; advanceKeywordCursor = () => {}; sleep = async () => {};
    hasStopRequested = async () => window.__GET_JOBS_ZHILIAN_CONTENT_INSTANCE_ID__ !== CONTENT_INSTANCE_ID;
  })();`);
  const context = vm.createContext({window, hooks, sessionStorage:{getItem:()=>null}, chrome:{runtime:{sendMessage:async()=>({success:true,isOwner:false,ownerToken:'other'}),onMessage:{addListener:f=>listeners.push(f)}}}, console, URL, URLSearchParams, Date, Math, setTimeout, clearTimeout});
  vm.runInContext(code, context);
  const jobs = ['A','B','C'].map(id=>({id,url:`https://www.zhaopin.com/jobdetail/${id}.htm`}));
  return {calls,stored,logs,listeners,window,inject:()=>vm.runInContext(code,context), run: (extra={})=>window.api.submit({jobs,detailIndex:3,profileId:4,...extra}, 'AI', 'run', {})};
}
const receipt = (jobKey,status='QUEUED',retryable=false)=>({jobKey,status,retryable,message:'test',errorCode:retryable?'QUEUE_FULL':''});
test('queue pressure retries only unconfirmed jobs and checkpoints receipts', async()=>{
  const h=harness(n=>({items:n===1?[receipt('A'),receipt('B','REJECTED',true),receipt('C')]:[receipt('B')]}));
  assert.equal((await h.run()).success,true);
  assert.deepEqual(h.calls,[['A','B','C'],['B']]);
  assert.equal(h.stored[0].submissionReceipts.A.status,'QUEUED');
});
test('lost response is idempotently resubmitted; refresh retains confirmed progress', async()=>{
  const h=harness(n=>{if(n===1)throw new Error('connection closed');return {items:[receipt('B','EXISTING'),receipt('C')]}});
  assert.equal((await h.run({submissionReceipts:{A:receipt('A')}})).success,true);
  assert.deepEqual(h.calls,[['B','C'],['B','C']]);
});
test('permanent item failure preserves successful receipts and stops', async()=>{
  const h=harness(()=>({items:[receipt('A'),receipt('B','FAILED'),receipt('C')]}));
  const result=await h.run(); assert.equal(result.paused,true);assert.equal(result.receipts.A.status,'QUEUED');assert.equal(h.calls.length,1);
});
test('same-version injection starts one listener and obsolete owner cannot submit',async()=>{
  const h=harness(()=>({items:[]}));h.inject();assert.equal(h.listeners.length,1);
  h.window.__GET_JOBS_ZHILIAN_CONTENT_INSTANCE_ID__='new-owner';await h.run();assert.equal(h.calls.length,0);
});
test('unexpected receipts pause instead of an endless loop',async()=>{
  const h=harness(()=>({items:[receipt('OTHER')]}));assert.equal((await h.run()).paused,true);assert.equal(h.calls.length,1);
});
test('a background ownership change stops the prior scan loop',async()=>{
  const h=harness(()=>({items:[]}));h.window.api.setOwner('original-owner');
  assert.equal(await h.window.api.owned(),true);
});
