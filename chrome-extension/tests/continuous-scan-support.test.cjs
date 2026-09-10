const assert = require('node:assert/strict');
const test = require('node:test');
const scan = require('../continuous-scan-support.js');

test('credits belong to the first keyword and receipt replay is idempotent', () => {
  const state = {};
  const receipt = [{ jobKey: 'one', freshAccepted: true }, { jobKey: 'old', freshAccepted: false }];
  assert.deepEqual(scan.applyReceipts(state, receipt, 'first', 30), { accepted: 1, remaining: 29 });
  assert.equal(scan.applyReceipts(state, receipt, 'first', 30).accepted, 1);
  assert.equal(scan.applyReceipts(state, receipt, 'second', 30).accepted, 0);
});
test('thirty historical jobs do not exhaust the target, later new jobs do', async () => {
  const state = {}, jobs = Array.from({ length: 60 }, (_, i) => ({ id: String(i) }));
  let calls = 0;
  const result = await scan.submit({ jobs, state, keyword: 'kw', target: 30,
    send: async batch => { calls++; return { items: batch.map(job => ({ jobKey: job.id, status: Number(job.id) < 30 ? 'SKIPPED' : 'QUEUED', freshAccepted: Number(job.id) >= 30 })) }; },
    checkpoint: async () => {}, stopped: async () => false, sleep: async () => {} });
  assert.equal(result.accepted, 30); assert.equal(result.skipped, 30); assert.equal(calls, 6);
});
test('queue backpressure preserves pending jobs and does not increment a rejected item', async () => {
  const state = {}; let calls = 0, checkpoints = 0;
  const result = await scan.submit({ jobs: [{ id: 'a' }], state, keyword: 'kw', target: 1,
    send: async () => ({ items: [{ jobKey: 'a', status: ++calls === 1 ? 'REJECTED' : 'QUEUED', retryable: calls === 1, freshAccepted: calls > 1 }] }),
    checkpoint: async () => { checkpoints++; }, stopped: async () => false, sleep: async () => {} });
  assert.equal(result.accepted, 1); assert.equal(calls, 2); assert.ok(checkpoints >= 4);
});
test('lost response is replayed without a second credit, invalid receipt pauses', async () => {
  const state = {}; let calls = 0;
  const args = { jobs: [{ id: 'a' }], state, keyword: 'kw', target: 1,
    checkpoint: async () => {}, stopped: async () => false, sleep: async () => {} };
  const result = await scan.submit({ ...args, send: async () => { if (++calls === 1) throw Error('lost'); return { items: [{ jobKey: 'a', status: 'EXISTING', freshAccepted: true }] }; } });
  assert.equal(result.accepted, 1);
  assert.equal((await scan.submit({ ...args, send: async () => { throw Error('must not resend'); } })).accepted, 1);
  await assert.rejects(scan.submit({ ...args, state: {}, send: async () => ({ items: [{ jobKey: 'wrong', freshAccepted: true }] }) }), /逐项入队回执/);
});
function scrolling() {
  let keys = ['old']; const moves = []; const list = { clientHeight: 400, scrollHeight: 1600, scrollTop: 1200,
    dispatchEvent(event) { if (event.type === 'wheel') { moves.push(event.deltaY); if (moves.some(n => n < 0) && event.deltaY > 0) keys = ['new']; } } };
  class Event { constructor(type, values) { this.type = type; Object.assign(this, values); } }
  const doc = { body: {}, documentElement: {}, scrollingElement: list, defaultView: { Event, WheelEvent: Event, getComputedStyle: () => ({ overflowY: 'auto' }) } };
  const card = { parentElement: list, getBoundingClientRect: () => ({ height: 80 }) };
  return { doc, list, cards: () => [card], readKeys: () => keys, seen: new Set(['old']), sleep: async () => {}, stopped: async () => false, moves };
}
test('nested list recovery scrolls upward before down and detects virtual-list ID replacement', async () => {
  const h = scrolling(); const result = await scan.advance({ ...h, recovery: true });
  assert.equal(result.grew, true); assert.deepEqual(h.moves, [-200, 400]);
});
test('no movement is not platform exhaustion and only three recovery cycles are allowed', async () => {
  const h = scrolling(); h.readKeys = () => ['old'];
  for (let i = 0; i < scan.MAX_RECOVERIES; i++) assert.equal((await scan.advance({ ...h, recovery: true })).grew, false);
  assert.equal(h.moves.filter(n => n < 0).length, 3);
  assert.equal(scan.outcome([{ stopReason: 'stagnation_safety_cap' }], 1), 'partial');
  assert.equal(scan.outcome([{ stopReason: 'platform_exhausted' }], 1), 'exhausted');
});

test('canonical keys agree for URLs and IDs on both platforms', () => {
  assert.equal(scan.jobKey({url:'https://www.zhaopin.com/jobdetail/abc.htm?ref=search'}), 'abc');
  assert.equal(scan.jobKey({url:'https://www.zhipin.com/job_detail/xyz.html?lid=old'}), 'xyz');
});
test('resume retains unsent details and prior credits, restarting only unfinished keywords', () => {
  const storage = new Map(); storage.setItem = storage.set.bind(storage); storage.getItem = storage.get.bind(storage);
  const previous = {profileId:4,runId:'r',keywordCursorKey:'filters',keywords:['done','pending'],config:{searchJobLimit:1},
    currentIndex:1,phase:'submitting',jobs:[{id:'pending'}],continuousScan:{credited:{first:'done'},receipts:{},
      keywords:{done:{stopReason:'target_reached'},pending:{stopReason:'stopped',elapsedMs:42}}}};
  scan.archive(storage,'boss',previous);
  const resumed = scan.restore(storage,'boss',{profileId:4,runId:'r',keywordCursorKey:'filters',pageTabId:8});
  assert.equal(resumed.currentIndex,1); assert.equal(resumed.phase,'submitting');
  assert.deepEqual(resumed.jobs,[{id:'pending'}]); assert.equal(resumed.continuousScan.credited.first,'done');
  assert.equal(resumed.continuousScan.keywords.pending.elapsedMs,0);
  assert.throws(() => scan.restore(storage,'boss',{profileId:4,runId:'new',keywordCursorKey:'filters'}),/条件或任务已变化/);
});
test('detail budget includes navigation but excludes queue waiting and human pause', () => {
  const task = {keywords:['kw'],currentIndex:0,phase:'detail',continuousScan:{keywords:{kw:{elapsedMs:0}}}};
  scan.accountDetailTime(task,100); scan.accountDetailTime(task,600);
  assert.equal(task.continuousScan.keywords.kw.elapsedMs,500);
  task.phase='submitting'; scan.accountDetailTime(task,800); scan.accountDetailTime(task,5000);
  assert.equal(task.continuousScan.keywords.kw.elapsedMs,700);
  task.phase='detail'; scan.accountDetailTime(task,6000); task.pausedAt=6500; scan.accountDetailTime(task,6500);
  scan.accountDetailTime(task,99000); assert.equal(task.continuousScan.keywords.kw.elapsedMs,1200);
});

test('a server cancellation retains receipts already accepted in that batch', async () => {
  const state={};let stored;
  const result=await scan.submit({jobs:[{id:'accepted'},{id:'untouched'}],state,keyword:'kw',target:2,
    send:async()=>({cancelled:true,items:[{jobKey:'accepted',status:'QUEUED',freshAccepted:true}]}),
    checkpoint:async()=>{stored=structuredClone(state)},stopped:async()=>false,sleep:async()=>{}});
  assert.equal(result.cancelled,true);assert.equal(result.totalAccepted,1);
  assert.equal(stored.credited.accepted,'kw');assert.equal(stored.receipts.untouched,undefined);
});

test('a candidate target without queue receipts stays resumable after stop or refresh', () => {
  const task={profileId:4,runId:'r',keywordCursorKey:'k',keywords:['kw'],currentIndex:0,phase:'detail',
    jobs:[{id:'a'}],config:{searchJobLimit:1},continuousScan:{credited:{},receipts:{},keywords:{kw:{stopReason:'target_reached'}}}};
  assert.equal(scan.results(task)[0].outcome,'partial');
  assert.equal(scan.results(task)[0].stopReason,'awaiting_submission');
  const storage=new Map();storage.setItem=storage.set.bind(storage);storage.getItem=storage.get.bind(storage);
  scan.archive(storage,'boss',task);
  assert.equal(scan.restore(storage,'boss',{profileId:4,runId:'r',keywordCursorKey:'k'}).phase,'detail');
  scan.applyReceipts(task.continuousScan,[{jobKey:'a',freshAccepted:true}],'kw',1);
  assert.equal(scan.results(task)[0].outcome,'complete');
});
