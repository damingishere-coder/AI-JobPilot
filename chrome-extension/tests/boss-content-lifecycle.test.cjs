const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dir = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(dir, 'boss-content.js'), 'utf8');
function storage() {
  const items = new Map();
  return { getItem: k => items.get(k) ?? null, setItem: (k, v) => items.set(k, String(v)), removeItem: k => items.delete(k) };
}
function harness() {
  const listeners = [], timers = [], messages = [], runs = [], watched = [];
  const sessionStorage = storage(), localStorage = storage(), shared={};
  const pageEvents = {};
  const window = { location: new URL('https://www.zhipin.com/web/geek/jobs?query=AI'), setTimeout: fn => timers.push(fn),
    addEventListener: (name, listener) => { pageEvents[name] = listener; } };
  window.GetJobsScanControl = {create: () => ({watch: async t => watched.push(t), checkpoint: async () => false})};
  const context = vm.createContext({ window, sessionStorage, localStorage, URL, console, setTimeout: window.setTimeout,
    chrome: { storage:{local:{get:async k=>({[k]:shared[k]}),set:async value=>Object.assign(shared,value),remove:async k=>delete shared[k]}},
      runtime: { onMessage: { addListener: fn => listeners.push(fn) }, sendMessage: async m => {
        messages.push(m);
        if(m.type==='BOSS_SCAN_OWNER_STATUS') {
          const t=JSON.parse(sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__')||'null');
          return {success:true,isOwner:true,runId:t?.runId,profileId:t?.profileId,ownerToken:t?.scanOwnerToken};
        }
        return { success: true };
      } } },
    runs });
  window.GetJobsScanStartSupport=require('../scan-start-support.js');
  vm.runInContext(fs.readFileSync(path.join(dir, 'boss-scan-support.js'), 'utf8'), context);
  const instrumented = source.replace(/\}\)\(\);\s*$/, `
    window.test = { resumeStoredScanTaskIfActive, storeScanTask, clearStoredScanTask, clearStoppedScanTask, writeScanStatus, requestBackgroundNavigation,
      isSearchNavigationPending, postProgress, normalizeScanTask, buildKeywordCursorKey, setActive: value => { activeScanPromise = value; } };
    runScan = async task => { runs.push(task); };
  })();`);
  const boot = () => vm.runInContext(instrumented, context);
  boot();
  return { window, listeners, timers, messages, runs, watched, sessionStorage, localStorage, shared, context, boot, pageEvents };
}
function task(extra = {}) {
  return { profileId: 4, runId: 'boss-test', keywords: ['AI'], currentIndex: 0, phase: 'searching',
    startedAt: Date.now(), updatedAt: Date.now(), expectedSearchUrl: 'https://www.zhipin.com/web/geek/jobs?query=AI',
    navigationStartedAt: Date.now(), ...extra };
}
test('manifest and readiness injection share one listener and one bootstrap', () => {
  const h = harness();
  const first = h.window.__GET_JOBS_BOSS_CONTENT_INSTANCE_ID__;
  h.boot();
  assert.equal(h.listeners.length, 1);
  assert.equal(h.timers.length, 1);
  assert.equal(h.window.__GET_JOBS_BOSS_CONTENT_INSTANCE_ID__, first);
});
test('passive bootstrap preserves paused checkpoint; explicit resume retries it', async () => {
  const h = harness();
  h.window.test.storeScanTask(task({ pausedAt: Date.now(), navigationAttempts: 5, lastError: { type: 'NAVIGATION_FAILED' } }));
  await h.window.test.resumeStoredScanTaskIfActive();
  assert.equal(h.runs.length, 0);
  assert.equal(h.messages.length, 0);
  assert.equal(JSON.parse(h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__')).navigationAttempts, 5);
  await h.window.test.resumeStoredScanTaskIfActive(true);
  assert.equal(h.runs.length, 1);
  assert.equal(h.runs[0].pausedAt, undefined);
  assert.equal(h.runs[0].navigationAttempts, 0);
});
test('late bootstrap does not overwrite an already active detail task', async () => {
  const h = harness();
  h.window.test.storeScanTask(task({ phase: 'detail', detailIndex: 3, jobs: [{url:'https://www.zhipin.com/job_detail/a.html'}] }));
  h.window.test.setActive(Promise.resolve());
  const before = h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__');
  await h.window.test.resumeStoredScanTaskIfActive();
  assert.equal(h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__'), before);
  assert.equal(h.messages.length, 0);
  assert.equal(h.runs.length, 0);
});

test('protocol reload preserves the blocked detail checkpoint and only reconnects control', async () => {
  const h = harness();
  h.window.test.storeScanTask(task({scanProtocol:1,scanOwnerToken:'owner',phase:'detail',detailIndex:7,
    blockedAt:Date.now(),blockState:'登录提示'}));
  await h.window.test.resumeStoredScanTaskIfActive();
  assert.equal(h.runs.length,0);
  assert.equal(h.watched.length,1);
  assert.equal(h.watched[0].detailIndex,7);
  assert.equal(h.watched[0].blockState,'登录提示');
  assert.equal(h.messages.filter(m=>m.type!=='BOSS_SCAN_OWNER_STATUS').length,0,'a passive reload must not publish a resume');
  await h.window.test.resumeStoredScanTaskIfActive(true);
  assert.equal(h.runs.length,1);
  assert.equal(h.runs[0].blockedAt,undefined);
});
test('superseded instance cannot navigate, publish, overwrite or clear the new checkpoint', async () => {
  const h = harness(), old = h.window.test;
  old.storeScanTask(task());
  h.window.__GET_JOBS_BOSS_CONTENT_INSTANCE_ID__ = 'replacement';
  const before = h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__');
  old.storeScanTask(task({currentIndex:7})); old.clearStoredScanTask(); old.writeScanStatus({isRunning:false});
  old.postProgress(task(), 'info', 'old');
  assert.equal((await old.requestBackgroundNavigation('https://www.zhipin.com/job_detail/old.html')).success, false);
  assert.equal(h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__'), before);
  assert.equal(h.messages.length, 0);
  assert.equal(h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_STATUS__'), null);
});
test('pending navigation timers stop after pause or phase advance', () => {
  const h = harness();
  assert.equal(h.window.test.isSearchNavigationPending(task()), true);
  assert.equal(h.window.test.isSearchNavigationPending(task({pausedAt:Date.now()})), false);
  assert.equal(h.window.test.isSearchNavigationPending(task({phase:'detail'})), false);
});

test('BFCache pagehide retires the runner and permits a fresh readiness injection', async () => {
  const h = harness(), old = h.window.test;
  const firstId = h.window.__GET_JOBS_BOSS_CONTENT_INSTANCE_ID__;
  h.pageEvents.pagehide();
  let response;
  h.listeners[0]({ source: 'GET_JOBS_BACKGROUND', type: 'PING_CONTENT' }, {}, value => { response = value; });
  assert.equal(response, undefined, 'the frozen listener must not claim readiness');
  assert.equal((await old.requestBackgroundNavigation('https://www.zhipin.com/job_detail/old.html')).success, false);
  h.boot();
  assert.notEqual(h.window.__GET_JOBS_BOSS_CONTENT_INSTANCE_ID__, firstId);
  h.listeners[1]({ source: 'GET_JOBS_BACKGROUND', type: 'PING_CONTENT' }, {}, value => { response = value; });
  assert.equal(response.success, true);
});

function dispatch(h,message) {
  return new Promise(resolve=>h.listeners[0]({source:'GET_JOBS_BACKGROUND',...message},{},resolve));
}
function startRequest(extra={}) {
  return {type:'BOSS_SCAN_START',scanProtocol:1,runId:'boss-new',profileId:4,scanOwnerToken:'new-owner',config:{keywords:['AI'],searchJobLimit:30},...extra};
}
test('concurrent same run starts save once and return pure duplicate acknowledgement',async()=>{
  const h=harness();
  const [first,second]=await Promise.all([dispatch(h,startRequest()),dispatch(h,startRequest())]);
  assert.equal(first.startAccepted,true);assert.equal(second.startAccepted,true);assert.equal(second.duplicate,true);
  assert.equal(h.runs.length,1);assert.equal(h.messages.filter(m=>m.operation==='chrome-resume').length,0);
  const before=h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__');
  h.window.test.writeScanStatus({stage:'blocked',paused:true,isRunning:false});
  const paused=await dispatch(h,startRequest());
  assert.equal(paused.isRunning,false);assert.equal(paused.paused,true);
  assert.equal(h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__'),before);assert.equal(h.runs.length,1);
});
test('start reconciliation reads raw records without mutating cursor or checkpoint',async()=>{
  const h=harness();await dispatch(h,startRequest());
  const before=[h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__'),h.localStorage.getItem('__GET_JOBS_BOSS_KEYWORD_CURSOR__'),JSON.stringify(h.shared),h.messages.length];
  const result=await dispatch(h,{...startRequest(),type:'BOSS_SCAN_STATUS',reconcileStart:true});
  assert.equal(result.startAccepted,true);
  assert.deepEqual([h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__'),h.localStorage.getItem('__GET_JOBS_BOSS_KEYWORD_CURSOR__'),JSON.stringify(h.shared),h.messages.length],before);
});
test('partial checkpoint storage failure rolls back and never starts collection',async()=>{
  const h=harness(),original=h.sessionStorage.setItem;
  h.sessionStorage.setItem=(key,value)=>{
    if(key==='__GET_JOBS_BOSS_SCAN_TASK__' && JSON.parse(value).startAccepted===true)throw new Error('quota');
    return original(key,value);
  };
  const result=await dispatch(h,startRequest());
  assert.equal(result.success,false);assert.equal(result.errorCode,'SCAN_STORAGE_FAILED');assert.equal(result.startNotDispatched,true);
  assert.equal(h.runs.length,0);assert.equal(h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__'),null);
  assert.equal(h.shared.__GET_JOBS_BOSS_SHARED_SCAN_TASK__,undefined);
  const status=await dispatch(h,{...startRequest(),type:'BOSS_SCAN_STATUS',reconcileStart:true});
  assert.equal(status.startAccepted,false);
});
test('a preparatory checkpoint cannot be bootstrapped into collection',async()=>{
  const h=harness();
  h.sessionStorage.setItem('__GET_JOBS_BOSS_SCAN_TASK__',JSON.stringify(task({scanProtocol:1,startAccepted:false})));
  await h.window.test.resumeStoredScanTaskIfActive(true);
  assert.equal(h.runs.length,0);assert.equal(h.watched.length,0);
});
test('shared checkpoint save failure cannot acknowledge or start a scan',async()=>{
  const h=harness();h.context.chrome.storage.local.set=async()=>{throw new Error('storage unavailable');};
  const result=await dispatch(h,startRequest());
  assert.equal(result.success,false);assert.equal(result.startNotDispatched,true);assert.equal(result.errorCode,'SCAN_STORAGE_FAILED');
  assert.equal(h.runs.length,0);
});
test('a delayed STOP cannot clear a newer BOSS checkpoint',async()=>{
  const h=harness();await dispatch(h,startRequest());
  const old=JSON.parse(h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__'));
  const newer={...old,runId:'boss-newer',scanOwnerToken:'newer-owner'};
  h.sessionStorage.setItem('__GET_JOBS_BOSS_SCAN_TASK__',JSON.stringify(newer));
  h.shared.__GET_JOBS_BOSS_SHARED_SCAN_TASK__=newer;
  await h.window.test.clearStoppedScanTask(old);
  assert.equal(JSON.parse(h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__')).runId,newer.runId);
  assert.equal(h.shared.__GET_JOBS_BOSS_SHARED_SCAN_TASK__.runId,newer.runId);
});
test('matching BOSS STOP propagates shared checkpoint cleanup failures',async()=>{
  const h=harness();await dispatch(h,startRequest());
  const target=JSON.parse(h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__'));
  h.context.chrome.storage.local.remove=async()=>{throw new Error('remove failed');};
  await assert.rejects(h.window.test.clearStoppedScanTask(target),/remove failed/);
});
test('a paused BOSS checkpoint rejects same run owner, profile and config changes without mutation',async()=>{
  const h=harness();await dispatch(h,startRequest());
  h.window.test.writeScanStatus({stage:'blocked',paused:true,isRunning:false});
  const before=[h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__'),JSON.stringify(h.shared),h.messages.length,h.runs.length];
  for(const extra of [{scanOwnerToken:'different'},{profileId:5},{config:{keywords:['AI'],searchJobLimit:31}},
      {scanProtocol:2},{autoDeliver:1}]) {
    const result=await dispatch(h,startRequest(extra));
    assert.equal(result.success,false);assert.equal(result.errorCode,'SCAN_START_CONFLICT');
    assert.deepEqual([h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__'),JSON.stringify(h.shared),h.messages.length,h.runs.length],before);
  }
});
test('dynamic start preparation prevents bootstrap of a fresh old local run',async()=>{
  const h=harness();
  h.sessionStorage.setItem('__GET_JOBS_BOSS_SCAN_TASK__',JSON.stringify(task({startAccepted:true,scanProtocol:1,scanOwnerToken:'old-owner'})));
  h.window.__GET_JOBS_SCAN_START_PREPARING__={platform:'boss',profileId:4,runId:'boss-new'};
  await h.timers[0]();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.runs.length,0);assert.equal(h.messages.length,0);
});
test('an already loaded local checkpoint cannot bootstrap under a different owner run',async()=>{
  const h=harness();
  h.sessionStorage.setItem('__GET_JOBS_BOSS_SCAN_TASK__',JSON.stringify(task({startAccepted:true,scanProtocol:1,scanOwnerToken:'old-owner'})));
  h.context.chrome.runtime.sendMessage=async()=>({success:true,isOwner:true,runId:'boss-new',profileId:4,ownerToken:'new-owner'});
  await h.window.test.resumeStoredScanTaskIfActive();
  assert.equal(h.runs.length,0);assert.equal(JSON.parse(h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__')).runId,'boss-test');
});
test('BOSS stores opaque cursor and start keys while preserving configured filters',async()=>{
  const h=harness();await dispatch(h,startRequest({config:{keywords:['采购'],searchJobLimit:30,salary:['10001,15000']}}));
  const saved=JSON.parse(h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__'));
  assert.match(saved.keywordCursorKey,/^sha256:[a-f0-9]{64}$/);assert.match(saved.startConfigKey,/^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(saved.config.salary,['10001,15000']);
  assert.equal(saved.startConfigKey.includes('salary'),false);assert.equal(saved.keywordCursorKey.includes('10001'),false);
});
test('a legacy BOSS cursor retains its next keyword and a legacy start key acknowledges without rewriting',async()=>{
  const h=harness(),message=startRequest({config:{keywords:['AI','采购'],searchJobLimit:30,salary:['10001,15000']}});
  const oldCursor=JSON.stringify({platform:'boss',profileId:4,keywords:['AI','采购'],cityCode:[],jobType:'',salary:['10001,15000'],experience:[],degree:[],scale:[],industry:[],stage:[],searchJobLimit:30});
  h.localStorage.setItem('__GET_JOBS_BOSS_KEYWORD_CURSOR__',JSON.stringify({cursorKey:oldCursor,keywordTotal:2,nextIndex:1}));
  const normalized=h.window.test.normalizeScanTask(message);
  assert.equal(normalized.currentIndex,1);assert.match(normalized.keywordCursorKey,/^sha256:/);
  const oldStart=JSON.stringify({cursor:oldCursor,scanProtocol:1,autoDeliver:false});
  const legacy={...normalized,keywordCursorKey:oldCursor,startConfigKey:oldStart,startAccepted:true,pausedAt:Date.now()};
  h.sessionStorage.setItem('__GET_JOBS_BOSS_SCAN_TASK__',JSON.stringify(legacy));
  const before=h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__');
  const result=await dispatch(h,message);
  assert.equal(result.startAccepted,true);assert.equal(result.duplicate,true);assert.equal(h.runs.length,0);
  assert.equal(h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__'),before);
  h.window.test.storeScanTask(legacy);
  const updated=JSON.parse(h.sessionStorage.getItem('__GET_JOBS_BOSS_SCAN_TASK__'));
  assert.match(updated.startConfigKey,/^sha256:/);assert.match(updated.keywordCursorKey,/^sha256:/);
  assert.equal(updated.currentIndex,1);
});
