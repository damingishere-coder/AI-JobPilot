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
  const listeners = [], timers = [], messages = [], runs = [];
  const sessionStorage = storage(), localStorage = storage();
  const window = { location: new URL('https://www.zhipin.com/web/geek/jobs?query=AI'), setTimeout: fn => timers.push(fn) };
  const context = vm.createContext({ window, sessionStorage, localStorage, URL, console, setTimeout: window.setTimeout,
    chrome: { runtime: { onMessage: { addListener: fn => listeners.push(fn) }, sendMessage: async m => { messages.push(m); return { success: true }; } } },
    runs });
  vm.runInContext(fs.readFileSync(path.join(dir, 'boss-scan-support.js'), 'utf8'), context);
  const instrumented = source.replace(/\}\)\(\);\s*$/, `
    window.test = { resumeStoredScanTaskIfActive, storeScanTask, clearStoredScanTask, writeScanStatus, requestBackgroundNavigation,
      isSearchNavigationPending, postProgress, setActive: value => { activeScanPromise = value; } };
    runScan = async task => { runs.push(task); };
  })();`);
  const boot = () => vm.runInContext(instrumented, context);
  boot();
  return { window, listeners, timers, messages, runs, sessionStorage, boot };
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
