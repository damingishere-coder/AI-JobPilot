const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createHash } = require('node:crypto');
const dir = path.join(__dirname, '..');
const TASK = '__GET_JOBS_ZHILIAN_SCAN_TASK__';
const SHARED = '__GET_JOBS_ZHILIAN_SHARED_SCAN_TASK__';
const STATUS = '__GET_JOBS_ZHILIAN_SCAN_STATUS__';
const CURSOR = '__GET_JOBS_ZHILIAN_KEYWORD_CURSOR__';
const digest = serialized => `sha256:${createHash('sha256').update(serialized, 'utf8').digest('hex')}`;
const request = (extra = {}) => ({ source: 'GET_JOBS_BACKGROUND', type: 'ZHILIAN_SCAN_START',
  scanProtocol: 1, profileId: 4, runId: 'zhilian-new', scanOwnerToken: 'owner-new',
  config: { cityCode: '489', keywords: ['AI'], searchJobLimit: 30 }, ...extra });
function harness({ failSave = false, holdSave = false, failLocalCommit = false, failRollback = false, keepShared = false,
  preparationFlag = false, initialTask = null, automaticBootstrap = false, realControl = false } = {}) {
  const local = new Map(), shared = {}, mutations = [], runs = [], watches = [], messages = [];
  let controlOptions, releaseSave;
  let clock = Date.now(), controlReply = { success: true, desired: 'PAUSED', state: 'BLOCKED', epoch: 1, commands: [] };
  const timers = new Set(), controlCalls = [];
  const held = holdSave ? new Promise(resolve => { releaseSave = resolve; }) : null;
  const storage = { getItem: key => local.get(key) || null,
    setItem: (key, value) => {
      if (failLocalCommit && key === TASK && JSON.parse(value).startAccepted === true) throw new Error('local commit failed');
      mutations.push(['local-set', key]); local.set(key, value);
    },
    removeItem: key => { mutations.push(['local-remove', key]); local.delete(key); } };
  const window = { location: { href: 'https://www.zhaopin.com/jobs?jl=489&kw=AI' },
    __GET_JOBS_SCAN_START_PREPARING__: preparationFlag,
    GetJobsScanControl: { create: options => { controlOptions = options; return {
      watch: async (task, options) => { watches.push({ ...structuredClone(task), controlOptions: structuredClone(options || {}) }); },
      checkpoint: async () => false, fault: () => {}, pausedMs: () => 0,
    }; } } };
  const hooks = { run: async task => { runs.push(structuredClone(task)); },
    ownership: { success: true, isOwner: true, runId: 'zhilian-new', profileId: 4, ownerToken: 'owner-new' } };
  const context = vm.createContext({ window, globalThis: window, hooks, sessionStorage: storage, localStorage: storage,
    chrome: { runtime: { onMessage: { addListener: () => {} }, sendMessage: async message => {
      messages.push(structuredClone(message));
      if (message.type === 'SCAN_CONTROL_SYNC') {
        controlCalls.push(structuredClone(message));
        if (message.ack) {
          const kind = controlReply.commands.find(command => command.id === message.ack.id)?.kind;
          controlReply = { ...controlReply, commands: [], desired: message.ack.ok
            ? kind === 'RESUME' ? 'RUNNING' : kind === 'STOP' ? 'STOPPED' : 'PAUSED' : kind === 'STOP' ? 'STOPPED' : 'PAUSED' };
        }
        return structuredClone(controlReply);
      }
      if (message.type === 'ZHILIAN_SCAN_OWNER_STATUS') return hooks.ownership;
      return { success: true };
    } }, storage: { local: {
      get: async key => ({ [key]: shared[key] }),
      set: async values => {
        if (values[SHARED] && held) await held;
        if (values[SHARED] && failSave) throw new Error('storage write failed');
        mutations.push(['shared-set', Object.keys(values)]); Object.assign(shared, structuredClone(values));
      },
      remove: async key => {
        if (key === SHARED && failRollback) throw new Error('shared rollback failed');
        if (key === SHARED && keepShared) return;
        mutations.push(['shared-remove', key]); delete shared[key];
      },
    } } }, console, Date: { now: () => clock }, Math, URL, URLSearchParams, setTimeout, clearTimeout,
    setInterval: callback => { timers.add(callback); return callback; }, clearInterval: callback => timers.delete(callback) });
  for (const name of ['vendor/js-sha256.js', 'scan-start-support.js', 'zhilian-scan-support.js']) {
    vm.runInContext(fs.readFileSync(path.join(dir, name), 'utf8'), context);
  }
  if (realControl) {
    vm.runInContext(fs.readFileSync(path.join(dir, 'scan-control.js'), 'utf8'), context);
    const create = window.GetJobsScanControl.create;
    window.GetJobsScanControl.create = options => {
      controlOptions = options; const control = create(options);
      return { ...control, watch: async (task, settings) => {
        watches.push({ ...structuredClone(task), controlOptions: structuredClone(settings || {}) });
        return control.watch(task, settings);
      } };
    };
  }
  let source = fs.readFileSync(path.join(dir, 'zhilian-content.js'), 'utf8');
  if (!automaticBootstrap) source = source.replace('resumeStoredScanTaskIfActive().catch', 'Promise.resolve().catch');
  source = source.replace(/\}\)\(\);\s*$/, `
      runScan = hooks.run;
      window.testApi = { start: handleScanStartMessage, resume: resumeStoredScanTaskIfActive,
        stop: handleScanStopMessage, status: message => new Promise(resolve => handleScanStatusMessage(message, resolve)),
        normalize: normalizeScanTask, store: storeScanTask, advance: advanceKeywordCursor,
        cursorKey: buildKeywordCursorKey, startKey: scanStartConfigKey,
        busy: value => { activeScanPromise = value ? Promise.resolve() : null; },
        writeStatus: writeScanStatus };
    })();`);
  if (initialTask) { local.set(TASK, JSON.stringify(initialTask)); shared[SHARED] = structuredClone(initialTask); }
  vm.runInContext(source, context);
  const seed = task => { local.set(TASK, JSON.stringify(task)); shared[SHARED] = structuredClone(task); };
  const task = () => JSON.parse(local.get(TASK) || 'null');
  return { api: window.testApi, local, shared, mutations, runs, watches, messages, seed, task,
    options: () => controlOptions, releaseSave, ownership: value => { hooks.ownership = value; },
    controlCalls, now: () => clock, advanceTime: ms => { clock += ms; },
    directive: value => { controlReply = structuredClone(value); }, tick: async () => {
      for (const timer of [...timers]) await timer();
      await new Promise(resolve => setImmediate(resolve));
    },
    state: () => JSON.parse(local.get(STATUS) || 'null') };
}
test('acknowledges start only after the shared checkpoint has been saved', async () => {
  const h = harness({ holdSave: true }); let settled = false;
  const pending = h.api.start(request()).then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(h.runs.length, 0);
  assert.equal(h.task(), null);
  h.releaseSave(); const ack = await pending;
  assert.equal(ack.startAccepted, true); assert.equal(ack.runId, 'zhilian-new');
  assert.equal(ack.profileId, 4); assert.equal(ack.scanOwnerToken, 'owner-new');
  assert.equal(h.shared[SHARED].startAccepted, true); assert.equal(h.runs.length, 1);
});
test('failed durable save never acknowledges or runs a scan', async () => {
  const h = harness({ failSave: true });
  await assert.rejects(h.api.start(request()), error => error.errorCode === 'SCAN_STORAGE_FAILED' && error.startNotDispatched === true);
  assert.equal(h.task(), null); assert.equal(h.runs.length, 0);
  const status = await h.api.status({ ...request(), reconcileStart: true });
  assert.equal(status.startAccepted, false);
});
test('partial commit failure is rolled back in both stores before claiming not dispatched', async () => {
  const h = harness({ failLocalCommit: true });
  await assert.rejects(h.api.start(request()), error => error.errorCode === 'SCAN_STORAGE_FAILED' && error.startNotDispatched === true);
  assert.equal(h.task(), null); assert.equal(h.shared[SHARED], undefined); assert.equal(h.runs.length, 0);
  assert.equal((await h.api.status({ ...request(), reconcileStart: true })).startAccepted, false);
});
test('unconfirmed rollback retains uncertainty and preparation markers never bootstrap', async () => {
  const h = harness({ failLocalCommit: true, failRollback: true });
  await assert.rejects(h.api.start(request()), error => error.errorCode === 'SCAN_START_UNCONFIRMED' && error.startNotDispatched === false);
  assert.equal(h.runs.length, 0);
  h.seed({ ...request(), startAccepted: false, updatedAt: Date.now() });
  await h.api.resume(false); await h.api.resume(true);
  assert.equal(h.runs.length, 0); assert.equal(h.watches.length, 0);
});
test('concurrent and later identical starts are pure acknowledgements', async () => {
  const h = harness(); const [a, b] = await Promise.all([h.api.start(request()), h.api.start(request())]);
  assert.equal(a.startAccepted, true); assert.equal(b.startAccepted, true); assert.equal(h.runs.length, 1);
  const before = h.mutations.length, checkpoint = h.local.get(TASK), messages = h.messages.length;
  const again = await h.api.start(request({ config: { searchJobLimit: 30, keywords: ['AI'], cityCode: '489' } }));
  assert.equal(again.startAccepted, true); assert.equal(h.mutations.length, before);
  assert.equal(again.stage, 'received');
  assert.equal(h.local.get(TASK), checkpoint); assert.equal(h.messages.length, messages);
  assert.equal(h.runs.length, 1);
});
test('same run with changed config, profile or owner never restarts or clears its checkpoint', async () => {
  const h = harness(); await h.api.start(request()); const before = h.mutations.length;
  for (const message of [request({ config: { cityCode: '489', keywords: ['AI'], searchJobLimit: 25 } }),
    request({ profileId: 5 }), request({ scanOwnerToken: 'another-owner' })]) {
    const result = await h.api.start(message); assert.equal(result.success, false); assert.equal(result.startNotDispatched, true);
  }
  assert.equal(h.mutations.length, before); assert.equal(h.runs.length, 1);
});
test('a new run never resumes the old paused run or inherits its detail checkpoint', async () => {
  const h = harness(); h.seed({ ...request({ runId: 'zhilian-old', scanOwnerToken: 'owner-old' }),
    phase: 'detail', detailIndex: 8, totalSaved: 12, pausedAt: Date.now(), updatedAt: Date.now(), jobs: [{ id: 'old' }] });
  const result = await h.api.start(request());
  assert.equal(result.runId, 'zhilian-new'); assert.equal(h.runs.length, 1);
  assert.equal(h.runs[0].runId, 'zhilian-new'); assert.equal(h.runs[0].phase, 'searching');
  assert.equal(h.runs[0].detailIndex, 0); assert.equal(h.runs[0].totalSaved, 0);
  assert.deepEqual(h.runs[0].jobs, []); assert.equal(h.watches.length, 0);
  assert.equal(h.messages.some(message => message.operation === 'chrome-resume'), false);
});
test('a new run is refused while another runner has not exited', async () => {
  const h = harness(); h.api.busy(true); const result = await h.api.start(request());
  assert.equal(result.errorCode, 'SCAN_EXECUTOR_BUSY'); assert.equal(h.runs.length, 0);
  assert.equal(h.task(), null);
});
test('paused PAGE_HIDDEN reload watches the unchanged checkpoint; explicit resume may run it', async () => {
  const h = harness(); h.seed({ ...request(), phase: 'collecting', startAccepted: true,
    pausedAt: Date.now(), updatedAt: Date.now(), collectedJobs: [{ id: 'kept', title: '已采集岗位',
      url: 'https://www.zhaopin.com/jobdetail/kept.htm', detailVerified: true }],
    lastError: { type: 'PAGE_HIDDEN' } });
  await h.api.resume(false);
  assert.equal(h.runs.length, 0); assert.equal(h.watches.length, 1);
  assert.equal(h.task().lastError.type, 'PAGE_HIDDEN'); assert.ok(h.task().pausedAt);
  assert.equal(h.state().stage, 'blocked');
  const before = h.mutations.length, duplicate = await h.api.start(request());
  assert.equal(duplicate.paused, true); assert.equal(duplicate.stage, 'blocked');
  assert.equal(duplicate.isRunning, false); assert.equal(h.mutations.length, before);
  await h.api.resume(true);
  assert.equal(h.runs.length, 1); assert.equal(h.runs[0].lastError, undefined);
  assert.equal(h.runs[0].pausedAt, undefined); assert.equal(h.runs[0].collectedJobs[0].id, 'kept');
});
test('read-only reconciliation neither clears expired or foreign tasks nor runs/resumes anything', async () => {
  const h = harness(); h.seed({ ...request(), startAccepted: true, updatedAt: 1, phase: 'detail', detailIndex: 9 });
  const raw = h.local.get(TASK), before = h.mutations.length;
  const exact = await h.api.status({ ...request(), reconcileStart: true });
  assert.equal(exact.startAccepted, true); assert.equal(exact.scanOwnerToken, 'owner-new');
  for (const message of [request({ profileId: 5 }), request({ runId: 'wrong' }), request({ scanOwnerToken: 'wrong' })]) {
    assert.equal((await h.api.status({ ...message, reconcileStart: true })).startAccepted, false);
  }
  assert.equal(h.local.get(TASK), raw); assert.equal(h.mutations.length, before);
  assert.equal(h.runs.length, 0); assert.equal(h.watches.length, 0); assert.equal(h.messages.length, 0);
});
test('reconciliation can read shared-only acceptance and leaves malformed local storage untouched', async () => {
  const h = harness(); h.local.set(TASK, '{malformed'); h.shared[SHARED] = { ...request(), startAccepted: true };
  h.local.set(STATUS, '{malformed-status');
  const before = h.mutations.length;
  assert.equal((await h.api.status({ ...request(), reconcileStart: true })).startAccepted, true);
  assert.equal(h.local.get(TASK), '{malformed'); assert.equal(h.mutations.length, before);
  assert.equal(h.local.get(STATUS), '{malformed-status');
});
test('STOP clears its checkpoint through the control callback, and refuses another profile/run', async () => {
  const h = harness(); await h.api.start(request()); const before = h.mutations.length;
  for (const message of [request({ profileId: 5 }), request({ runId: 'different-run' })]) {
    assert.equal((await h.api.stop(message)).success, false);
  }
  assert.equal(h.mutations.length, before);
  assert.equal(typeof h.options().clearTask, 'function');
  await h.options().clearTask(request({ runId: 'older-run' }));
  assert.equal(h.mutations.length, before);
  await h.options().clearTask(request());
  assert.equal(h.task(), null); assert.equal(h.shared[SHARED], undefined);
});
test('STOP cleanup reports shared storage failure instead of silently confirming removal', async () => {
  const h = harness({ failRollback: true }); await h.api.start(request());
  await assert.rejects(h.options().clearTask(request()), error => error.errorCode === 'CHECKPOINT_CLEAR_FAILED');
  assert.equal(h.shared[SHARED].runId, 'zhilian-new');
});
test('STOP cleanup verifies both stores and refuses acknowledgement if a matching checkpoint remains', async () => {
  const h = harness({ keepShared: true }); await h.api.start(request());
  await assert.rejects(h.options().clearTask(request()), error => error.errorCode === 'CHECKPOINT_CLEAR_FAILED');
  assert.equal(h.shared[SHARED].runId, 'zhilian-new');
});
test('new START preparation suppresses actual injection bootstrap of an old fresh local task', async () => {
  const initialTask = { ...request({ runId: 'zhilian-old', scanOwnerToken: 'old-owner' }),
    startAccepted: true, updatedAt: Date.now(), phase: 'searching' };
  const guarded = harness({ preparationFlag: { platform: 'zhilian', runId: 'zhilian-new', profileId: 4 },
    initialTask, automaticBootstrap: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(guarded.runs.length, 0); assert.equal(guarded.watches.length, 0);
  assert.equal(guarded.task().runId, 'zhilian-old');
  assert.equal((await guarded.api.start(request())).startAccepted, true);
  assert.equal(guarded.runs.length, 1); assert.equal(guarded.runs[0].runId, 'zhilian-new');
  const ordinary = harness(); ordinary.seed(initialTask);
  ordinary.ownership({ success: true, isOwner: true, runId: 'zhilian-old', profileId: 4, ownerToken: 'old-owner' });
  await ordinary.api.resume(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ordinary.runs.length, 1); assert.equal(ordinary.runs[0].runId, 'zhilian-old');
});
test('local bootstrap requires exact live run/profile/owner registration and accepted start evidence', async () => {
  const h = harness(); const original = { ...request(), startAccepted: true, updatedAt: Date.now() };
  h.seed(original);
  for (const ownership of [{ success: false }, { success: true, isOwner: false },
    { success: true, isOwner: true, runId: 'another-run', profileId: 4, ownerToken: 'owner-new' },
    { success: true, isOwner: true, runId: 'zhilian-new', profileId: 5, ownerToken: 'owner-new' },
    { success: true, isOwner: true, runId: 'zhilian-new', profileId: 4, ownerToken: 'another-owner' }]) {
    h.ownership(ownership); await h.api.resume(false);
  }
  assert.equal(h.runs.length, 0); assert.equal(h.watches.length, 0);
  h.ownership({ success: true, isOwner: true, runId: 'zhilian-new', profileId: 4, ownerToken: 'owner-new' });
  h.seed({ ...original, startAccepted: undefined }); await h.api.resume(false);
  assert.equal(h.runs.length, 0);
  h.seed({ ...original, startAccepted: undefined, pausedAt: Date.now(), lastError: { type: 'PAGE_HIDDEN' } });
  await h.api.resume(false); assert.equal(h.watches.length, 1); assert.equal(h.runs.length, 0);
});
test('ordinary STATUS never presents an uncommitted initial marker as a running scan', async () => {
  const h = harness(); h.seed({ ...request(), startAccepted: false, updatedAt: Date.now() });
  const before = h.mutations.length;
  const result = await h.api.status(request());
  assert.equal(result.isRunning, false); assert.equal(result.startUnconfirmed, true);
  assert.equal(result.resumable, false); assert.equal(h.runs.length, 0); assert.equal(h.mutations.length, before);
  const duplicate = await h.api.start(request());
  assert.equal(duplicate.startUnconfirmed, true); assert.notEqual(duplicate.startNotDispatched, true);
});
test('legacy raw JSON cursor keys retain the next keyword while all newly written keys use real SHA256', () => {
  const h = harness(); const keywords = ['AI', '运营', '数据'];
  const message = request({ config: { cityCode: '489', keywords, searchJobLimit: 30 } });
  const legacyKey = JSON.stringify({ platform: 'zhilian', profileId: 4, keywords,
    cityCode: '489', salary: '0000,9999999', searchJobLimit: 30 });
  const legacyCursor = { cursorKey: legacyKey, nextIndex: 2, keywordTotal: 3,
    state: 'next', keyword: '运营', updatedAt: 12345 };
  h.local.set(CURSOR, JSON.stringify(legacyCursor));
  const normalized = h.api.normalize(message);
  assert.equal(normalized.currentIndex, 2); assert.equal(normalized.keywordCursorReset, false);
  assert.equal(normalized.keywordCursorKey, digest(legacyKey));
  assert.deepEqual(JSON.parse(h.local.get(CURSOR)), legacyCursor, 'reading an old matching cursor must not reset or rewrite its history');
  h.api.advance(normalized, 2, '数据');
  const saved = JSON.parse(h.local.get(CURSOR));
  assert.equal(saved.nextIndex, 2); assert.equal(saved.keywordTotal, 3);
  assert.equal(saved.cursorKey, digest(legacyKey)); assert.equal(saved.cursorKey.includes('salary'), false);
  assert.equal(saved.cursorKey.includes('0000,9999999'), false);
});
test('legacy accepted start JSON compares compatibly without restarting and saves only hashed redundant keys', async () => {
  const h = harness(); const legacyStartKey = JSON.stringify({ cityCode: '489', keywords: ['AI'], searchJobLimit: 30 });
  const legacyCursorKey = JSON.stringify({ platform: 'zhilian', profileId: 4, keywords: ['AI'],
    cityCode: '489', salary: '0000,9999999', searchJobLimit: 30 });
  const original = { ...request(), startAccepted: true, startConfigKey: legacyStartKey,
    keywordCursorKey: legacyCursorKey, currentIndex: 0, phase: 'detail', detailIndex: 7,
    totalSaved: 9, updatedAt: Date.now(), jobs: [{ id: 'historical', title: '保留岗位', url: 'https://www.zhaopin.com/jobdetail/historical.htm' }] };
  h.seed(original); const before = h.mutations.length;
  const duplicate = await h.api.start(request());
  assert.equal(duplicate.startAccepted, true); assert.equal(h.runs.length, 0);
  assert.equal(h.mutations.length, before); assert.deepEqual(h.task(), original);
  await h.api.store(original, { requireDurable: true });
  const saved = h.task();
  assert.equal(saved.startConfigKey, digest(legacyStartKey)); assert.equal(saved.keywordCursorKey, digest(legacyCursorKey));
  assert.equal(saved.currentIndex, 0); assert.equal(saved.detailIndex, 7); assert.equal(saved.totalSaved, 9);
  assert.deepEqual(saved.jobs, original.jobs); assert.equal(h.shared[SHARED].startConfigKey, saved.startConfigKey);
  assert.match(saved.keywordCursorKey, /^sha256:[a-f0-9]{64}$/);
  assert.equal(saved.keywordCursorKey.includes('salary'), false);
  h.api.writeStatus({ runId: original.runId, profileId: 4, startConfigKey: legacyStartKey });
  assert.equal(h.state().startConfigKey, digest(legacyStartKey));
});

test('a 95-minute paused checkpoint reload reconnects real controls without renewal and epoch-two RESUME runs once', async () => {
  const h = harness({ realControl: true });
  const original = { ...request({ config: { cityCode: '489', keywords: ['AI', '运营', '数据'], searchJobLimit: 30 } }),
    startAccepted: true, phase: 'detail', currentIndex: 2, detailIndex: 7,
    totalSaved: 9, updatedAt: h.now() - 95 * 60000, pausedAt: h.now() - 95 * 60000,
    lastError: { type: 'PAGE_HIDDEN' }, jobs: [{ id: 'kept', title: '已采集岗位', url: 'https://www.zhaopin.com/jobdetail/kept.htm' }] };
  h.seed(original); await h.api.resume(false);
  assert.equal(h.watches.length, 1); assert.equal(h.runs.length, 0);
  assert.deepEqual(h.task(), original, 'a control-only reload must preserve the original recovery deadline and business checkpoint');
  h.directive({ success: true, epoch: 2, desired: 'RESUMING', commands: [{ id: 'resume-epoch-two', kind: 'RESUME' }] });
  await h.tick();
  assert.equal(h.controlCalls.find(call => call.ack?.id === 'resume-epoch-two')?.ack.ok, true);
  assert.equal(h.runs.length, 1); assert.equal(h.runs[0].currentIndex, 2); assert.equal(h.runs[0].detailIndex, 7);
  assert.equal(h.runs[0].jobs[0].id, 'kept'); assert.equal(h.runs[0].lastError, undefined);
});

for (const age of [86400000 - 1, 86400000, 86400000 + 1]) test(`paused control boundary at ${age} ms never renews a checkpoint`, async () => {
  const h = harness({ realControl: true });
  const original = { ...request(), startAccepted: true, updatedAt: h.now() - age,
    pausedAt: h.now() - age, lastError: { type: 'PAGE_HIDDEN' }, phase: 'collecting' };
  h.seed(original); await h.api.resume(false);
  assert.equal(h.watches.length, 1); assert.deepEqual(h.task(), original); assert.equal(h.runs.length, 0);
  h.directive({ success: true, epoch: 2, desired: 'RESUMING', commands: [{ id: 'resume-boundary', kind: 'RESUME' }] });
  await h.tick();
  const ack = h.controlCalls.find(call => call.ack?.id === 'resume-boundary').ack;
  assert.equal(ack.ok, age < 86400000);
  if (age >= 86400000) {
    assert.equal(ack.errorCode, 'CHECKPOINT_EXPIRED'); assert.deepEqual(h.task(), original); assert.equal(h.runs.length, 0);
    h.directive({ success: true, epoch: 2, desired: 'PAUSED', commands: [{ id: 'pause-expired', kind: 'PAUSE' }] });
    await h.tick();
    assert.equal(h.controlCalls.find(call => call.ack?.id === 'pause-expired').ack.ok, false);
    assert.deepEqual(h.task(), original);
    await h.api.resume(false); assert.deepEqual(h.task(), original);
    h.directive({ success: true, epoch: 3, desired: 'RESUMING', commands: [{ id: 'resume-still-expired', kind: 'RESUME' }] });
    await h.tick();
    assert.equal(h.controlCalls.find(call => call.ack?.id === 'resume-still-expired').ack.errorCode, 'CHECKPOINT_EXPIRED');
    h.directive({ success: true, epoch: 3, desired: 'STOPPED', commands: [{ id: 'stop-expired', kind: 'STOP' }] });
    await h.tick();
    assert.equal(h.controlCalls.find(call => call.ack?.id === 'stop-expired').ack.ok, true); assert.equal(h.task(), null);
  }
});

test('accepted identity with no checkpoint reconnects controls, fails RESUME/PAUSE and retains STOP recovery', async () => {
  const h = harness({ realControl: true });
  h.api.writeStatus({ ...request(), startAccepted: true, stage: 'blocked', paused: true, resumable: true });
  await h.api.resume(false); assert.equal(h.task(), null); assert.equal(h.watches.length, 1);
  for (const [id, kind] of [['resume-missing', 'RESUME'], ['pause-missing', 'PAUSE']]) {
    h.directive({ success: true, epoch: 2, desired: kind === 'RESUME' ? 'RESUMING' : 'PAUSED', commands: [{ id, kind }] });
    await h.tick();
    const ack = h.controlCalls.find(call => call.ack?.id === id).ack;
    assert.equal(ack.ok, false); assert.equal(ack.errorCode, 'CHECKPOINT_MISSING'); assert.equal(h.task(), null);
  }
  await h.api.resume(false); assert.equal(h.task(), null);
  h.directive({ success: true, epoch: 3, desired: 'RESUMING', commands: [{ id: 'resume-missing-after-reload', kind: 'RESUME' }] });
  await h.tick(); assert.equal(h.controlCalls.find(call => call.ack?.id === 'resume-missing-after-reload').ack.ok, false);
  h.directive({ success: true, epoch: 3, desired: 'STOPPED', commands: [{ id: 'stop-missing', kind: 'STOP' }] });
  await h.tick(); assert.equal(h.controlCalls.find(call => call.ack?.id === 'stop-missing').ack.ok, true);
  assert.equal(h.runs.length, 0); assert.equal(h.task(), null);
});

test('PAUSE fails explicitly when a valid watched checkpoint disappears after reconnecting controls', async () => {
  const h = harness({ realControl: true });
  h.seed({ ...request(), startAccepted: true, updatedAt: h.now() - 95 * 60000,
    pausedAt: h.now() - 95 * 60000, lastError: { type: 'PAGE_HIDDEN' } });
  await h.api.resume(false);
  assert.equal(h.watches[0].controlOptions.checkpointError, '');
  h.local.delete(TASK); delete h.shared[SHARED];
  h.directive({ success: true, epoch: 2, desired: 'PAUSED', commands: [{ id: 'pause-after-loss', kind: 'PAUSE' }] });
  await h.tick();
  const ack = h.controlCalls.find(call => call.ack?.id === 'pause-after-loss')?.ack;
  assert.equal(ack?.ok, false); assert.equal(ack?.errorCode, 'CHECKPOINT_MISSING');
  assert.equal(h.task(), null); assert.equal(h.shared[SHARED], undefined); assert.equal(h.runs.length, 0);
});

test('accepted paused checkpoint cannot resume after its live owner changed', async () => {
  const h = harness({ realControl: true }); const original = { ...request(), startAccepted: true,
    updatedAt: h.now() - 95 * 60000, pausedAt: h.now() - 95 * 60000, lastError: { type: 'PAGE_HIDDEN' } };
  h.seed(original); await h.api.resume(false);
  h.ownership({ success: true, isOwner: true, runId: 'new-owner-run', profileId: 4, ownerToken: 'new-owner' });
  await h.api.resume(true); assert.equal(h.runs.length, 0); assert.deepEqual(h.task(), original);
});

for (const storage of ['session-only', 'shared-only']) test(`${storage} paused checkpoints missing both timestamps cannot acquire a new validity window during normalization`, async () => {
  const h = harness({ realControl: true });
  const original = { ...request(), startAccepted: true, pausedAt: h.now() - 48 * 3600000,
    phase: 'collecting', lastError: { type: 'PAGE_HIDDEN' } };
  h.seed(original);
  if (storage === 'session-only') delete h.shared[SHARED];
  else h.local.delete(TASK);
  await h.api.resume(false);
  assert.equal(h.watches.length, 1); assert.equal(h.watches[0].controlOptions.checkpointError, 'CHECKPOINT_MISSING');
  assert.equal(h.task().startedAt, undefined); assert.equal(h.task().updatedAt, undefined);
  assert.equal(h.watches[0].startedAt, undefined);
  const before = structuredClone(h.task());
  for (const [id, kind] of [['resume-no-time', 'RESUME'], ['pause-no-time', 'PAUSE']]) {
    h.directive({ success: true, epoch: 2, desired: kind === 'RESUME' ? 'RESUMING' : 'PAUSED', commands: [{ id, kind }] });
    await h.tick();
    assert.equal(h.controlCalls.find(call => call.ack?.id === id).ack.errorCode, 'CHECKPOINT_MISSING');
    assert.deepEqual(h.task(), before); assert.equal(h.runs.length, 0);
    if (storage === 'shared-only') assert.deepEqual(h.shared[SHARED], original);
  }
});
