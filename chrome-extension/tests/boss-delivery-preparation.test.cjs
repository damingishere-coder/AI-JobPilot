const assert = require('node:assert/strict');
const test = require('node:test');
const { prepare } = require('../boss-delivery-support.js');
const url = 'https://www.zhipin.com/job_detail/abc.html';
function harness(overrides = {}) {
  let injections = 0, sends = 0, navigations = 0;
  const options = { tabId: 1, targetUrl: url, sleep: async () => {},
    navigate: async () => { navigations++; }, ensure: async () => { injections++; },
    chrome: { permissions: { contains: async () => true }, tabs: {
      get: async () => ({ id: 1, url, status: 'complete' }),
      sendMessage: async (_, message) => { assert.equal(message.type, 'BOSS_PAGE_STATUS'); sends++; return { chromePageReady: true, isLoggedIn: true }; }
    } } };
  overrides.configure?.(options);
  return { run: () => prepare(options), counts: () => ({ injections, sends, navigations }) };
}
test('permission denial occurs before any delivery action and halts batch', async () => {
  const h = harness({ configure: o => { o.chrome.permissions.contains = async () => false; } });
  const r = await h.run();
  assert.equal(r.evidence, 'PRE_ACTION_ERROR'); assert.equal(r.actionStarted, false);
  assert.equal(r.greetingOutcome, 'NOT_SENT'); assert.equal(r.haltBatch, true);
  assert.equal(h.counts().injections, 0);
});
test('the screenshot injection error is not UNKNOWN', async () => {
  const h = harness({ configure: o => { o.ensure = async () => { throw new Error('Cannot access contents of the page. Extension manifest must request permission to access the respective host.'); }; } });
  const r = await h.run(); assert.equal(r.outcome, 'FAILED'); assert.equal(r.actionStarted, false); assert.equal(r.haltBatch, true);
});
test('loading page is retried twice without injecting or sending', async () => {
  const h = harness({ configure: o => { o.chrome.tabs.get = async () => ({ url, status: 'loading' }); } });
  assert.equal((await h.run()).actionStarted, false);
  assert.deepEqual(h.counts(), { injections: 0, sends: 0, navigations: 3 });
});
test('navigation during script readiness does not pass preparation', async () => {
  let n = 0;
  const h = harness({ configure: o => { o.chrome.tabs.get = async () => ({ url: ++n % 2 ? url : 'https://www.zhipin.com/web/user/', status: 'complete' }); } });
  assert.equal((await h.run()).success, false);
});
test('ready page only probes status and never sends a delivery command', async () => {
  const h = harness(); assert.equal((await h.run()).success, true); assert.equal(h.counts().sends, 1);
});

test('rejects an unsupported target before navigating and rejects a changed job ID', async () => {
  const invalid = harness({ configure: o => { o.targetUrl = 'https://example.com/job_detail/abc.html'; } });
  assert.equal((await invalid.run()).evidence, 'PRE_ACTION_ERROR');
  assert.equal(invalid.counts().navigations, 0);
  const mismatch = harness({ configure: o => { o.chrome.tabs.get = async () => ({url: url.replace('abc','other'), status:'complete'}); } });
  assert.equal((await mismatch.run()).success, false);
  assert.equal(mismatch.counts().injections, 0);
});
