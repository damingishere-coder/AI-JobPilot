const assert = require('node:assert/strict');
const test = require('node:test');
const { prepare } = require('../boss-delivery-support.js');
const url = 'https://www.zhipin.com/job_detail/abc.html';
function harness(overrides = {}) {
  let injections = 0, sends = 0, navigations = 0;
  let elapsed = 0;
  const options = { tabId: 1, targetUrl: url, now: () => elapsed, sleep: async ms => { elapsed += ms; },
    navigate: async () => { navigations++; }, ensure: async () => { injections++; },
    chrome: { permissions: { contains: async () => true }, tabs: {
      get: async () => ({ id: 1, url, status: 'complete' }),
      sendMessage: async (_, message) => { assert.equal(message.type, 'BOSS_PAGE_STATUS'); sends++; return { chromePageReady: true, isLoggedIn: true }; }
    } } };
  overrides.configure?.(options);
  return { run: () => prepare(options), counts: () => ({ injections, sends, navigations }), elapsed: () => elapsed };
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
test('loading page has a bounded wait without injecting, sending or repeated navigation', async () => {
  const h = harness({ configure: o => { o.chrome.tabs.get = async () => ({ url, status: 'loading' }); } });
  const result = await h.run();
  assert.equal(result.actionStarted, false);
  assert.equal(result.errorCode, 'BOSS_PAGE_NOT_READY');
  assert.equal(result.haltBatch, true);
  assert.equal(h.elapsed(), 20000);
  assert.deepEqual(h.counts(), { injections: 0, sends: 0, navigations: 1 });
});
test('navigation during script readiness does not pass preparation', async () => {
  let n = 0;
  const h = harness({ configure: o => { o.chrome.tabs.get = async () => ({ url: ++n % 2 ? url : 'https://www.zhipin.com/web/user/', status: 'complete' }); } });
  assert.equal((await h.run()).success, false);
});
test('ready page only probes status and never sends a delivery command', async () => {
  const h = harness(); assert.equal((await h.run()).success, true); assert.equal(h.counts().sends, 1);
});

test('verification and login redirects halt immediately without repeated navigation', async () => {
  for (const [path, type] of [['/web/passport/zp/verify.html', 'PLATFORM_VERIFICATION'], ['/web/passport/login', 'LOGIN_EXPIRED'], ['/web/user/', 'LOGIN_EXPIRED']]) {
    const h = harness({ configure: o => { o.chrome.tabs.get = async () => ({ url: 'https://www.zhipin.com' + path, status: 'complete' }); } });
    const result = await h.run();
    assert.equal(result.failureType, type);
    assert.equal(result.haltBatch, true);
    assert.equal(result.actionStarted, false);
    assert.deepEqual(h.counts(), { injections: 0, sends: 0, navigations: 0 });
  }
});

test('a navigation timeout on verification preserves the page without retrying navigation', async () => {
  const h = harness({ configure: o => {
    let redirected = false;
    const navigate = o.navigate;
    o.navigate = async () => { await navigate(); redirected = true; throw new Error('岗位导航超时'); };
    o.chrome.tabs.get = async () => ({url:redirected?'https://www.zhipin.com/web/passport/zp/verify.html':url,status:'complete'});
  } });
  const result = await h.run();
  assert.equal(result.haltBatch, true);
  assert.equal(result.failureType, 'PLATFORM_VERIFICATION');
  assert.deepEqual(h.counts(), {injections:0,sends:0,navigations:1});
});

test('cold preflight waits more than one second for the committed page without navigation', async () => {
  const h = harness({ configure: o => {
    delete o.targetUrl;
    o.chrome.tabs.get = async () => o.now() < 3500
      ? {url:'about:blank',pendingUrl:'https://www.zhipin.com/',status:'loading'}
      : {url:'https://www.zhipin.com/',status:'complete'};
  } });
  assert.equal((await h.run()).success,true);
  assert.equal(h.elapsed(),3500);
  assert.deepEqual(h.counts(),{injections:1,sends:1,navigations:0});
});

test('pending login redirect is preserved even when the committed job still looks ready', async () => {
  const h = harness({ configure: o => { o.chrome.tabs.get = async () => ({url,pendingUrl:'https://www.zhipin.com/web/user/',status:'loading'}); } });
  assert.equal((await h.run()).failureType,'LOGIN_EXPIRED');
  assert.deepEqual(h.counts(),{injections:0,sends:0,navigations:0});
});

test('a newly created blank tab without pendingUrl waits instead of being classified as logged out', async () => {
  const h = harness({ configure: o => {
    delete o.targetUrl;
    o.chrome.tabs.get = async () => ({url:o.now()<1250?'about:blank':url,status:'complete'});
  } });
  assert.equal((await h.run()).success,true);
  assert.equal(h.elapsed(),1250);
  assert.deepEqual(h.counts(),{injections:1,sends:1,navigations:0});
});

test('explicit login and security status halt immediately even with a generic page message', async () => {
  for (const [flag, type] of [['hasLoginPrompt', 'LOGIN_EXPIRED'], ['hasSecurityPrompt', 'PLATFORM_VERIFICATION']]) {
    const h = harness({ configure: o => {
      o.chrome.tabs.sendMessage = async () => ({[flag]:true,message:'请稍后再试'});
    } });
    const result = await h.run();
    assert.equal(result.failureType,type);
    assert.equal(result.actionStarted,false);
    assert.equal(result.haltBatch,true);
    assert.equal(h.elapsed(),0);
  }
});

test('readiness from an old document is rejected until its current URL matches', async () => {
  const h = harness({ configure: o => {
    o.chrome.tabs.sendMessage = async () => ({chromePageReady:true,isLoggedIn:true,currentUrl:o.now()<1500?url.replace('abc','other'):url});
  } });
  assert.equal((await h.run()).success,true);
  assert.equal(h.elapsed(),1500);
  assert.equal(h.counts().navigations,1);
});

test('rejects an unsupported target before navigating and rejects a changed job ID', async () => {
  const invalid = harness({ configure: o => { o.targetUrl = 'https://example.com/job_detail/abc.html'; } });
  assert.equal((await invalid.run()).evidence, 'PRE_ACTION_ERROR');
  assert.equal(invalid.counts().navigations, 0);
  const mismatch = harness({ configure: o => { o.chrome.tabs.get = async () => ({url: url.replace('abc','other'), status:'complete'}); } });
  assert.equal((await mismatch.run()).success, false);
  assert.equal(mismatch.counts().injections, 0);
});
