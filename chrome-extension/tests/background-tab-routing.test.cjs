const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

function readContentVersion(file) {
  const source = fs.readFileSync(path.join(EXTENSION_DIR, file), "utf8");
  const match = source.match(/const EXTENSION_VERSION = "([^"]+)"/);
  assert.ok(match, `missing EXTENSION_VERSION in ${file}`);
  return match[1];
}

const BOSS_CONTENT_VERSION = readContentVersion("boss-content.js");
const ZHILIAN_CONTENT_VERSION = readContentVersion("zhilian-content.js");

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null;
      }
    },
    async text() { return JSON.stringify(body); }
  };
}

function loadBackground({
  tabs,
  statuses = {},
  contentReady = true,
  bossContentVersion = BOSS_CONTENT_VERSION,
  zhilianContentVersion = ZHILIAN_CONTENT_VERSION,
  injectedBossVersion = BOSS_CONTENT_VERSION,
  injectedZhilianVersion = ZHILIAN_CONTENT_VERSION,
  bossHrContentVersion = "2026-09-07-hr-autopilot",
  bossDeliveryResponses = [],
  fetchImpl = async () => {
    throw new Error("fetch should not be called");
  }
}) {
  const storage = {};
  const sentMessages = [];
  const executedScripts = [];
  const tabUpdates = [];
  const windowUpdates = [];
  const alarmCreates = [];
  const alarmClears = [];
  const tabList = tabs.map((tab) => ({ ...tab }));
  let currentContentReady = contentReady;
  let currentBossContentVersion = bossContentVersion;
  let currentZhilianContentVersion = zhilianContentVersion;
  let runtimeMessageListener = null;
  let alarmListener = null;
  const chrome = {
    permissions: { contains: async () => true },
    runtime: {
      onMessage: { addListener(listener) { runtimeMessageListener = listener; } },
      lastError: null
    },
    tabs: {
      onRemoved: { addListener() {} },
      async query() {
        return tabList.map((tab) => ({ ...tab }));
      },
      async get(tabId) {
        const tab = tabList.find((item) => item.id === tabId);
        if (!tab) throw new Error(`unknown tab ${tabId}`);
        return { ...tab };
      },
      async create(options) {
        const tab = {
          id: Math.max(0, ...tabList.map((item) => item.id)) + 1,
          windowId: 1,
          status: "complete",
          lastAccessed: Date.now(),
          ...options
        };
        tabList.push(tab);
        return { ...tab };
      },
      async update(tabId, updates) {
        tabUpdates.push({ tabId, updates: { ...updates } });
        const tab = tabList.find((item) => item.id === tabId);
        Object.assign(tab, updates);
        return { ...tab };
      },
      async sendMessage(tabId, message) {
        sentMessages.push({ tabId, message });
        if (message.type === "PING_CONTENT") {
          if (!currentContentReady) throw new Error("Receiving end does not exist");
          return { success: true };
        }
        if (message.type === "GET_BOSS_CONTENT_VERSION") {
          return { success: true, version: currentBossContentVersion };
        }
        if (message.type === "GET_ZHILIAN_CONTENT_VERSION") {
          return { success: true, version: currentZhilianContentVersion };
        }
        if (message.type === "BOSS_HR_CONTENT_VERSION_V2") {
          return { success: true, version: bossHrContentVersion };
        }
        if (message.type === "BOSS_SCAN_STATUS" || message.type === "ZHILIAN_SCAN_STATUS_V2") {
          return statuses[tabId] || { success: true, isRunning: false, hasStoredTask: false, stage: "idle" };
        }
        if (message.type === "BOSS_PAGE_STATUS") return statuses[tabId]?.hasLoginPrompt ? statuses[tabId] : { success: true, chromePageReady: true, isLoggedIn: true };
        if (message.type === "ZHILIAN_PAGE_STATUS") return statuses[tabId] || { success: true, chromePageReady: false };
        if (message.type === "BOSS_DELIVER_CURRENT_V2") {
          const response = bossDeliveryResponses.shift();
          if (response instanceof Error) throw response;
          return response || { success: false, outcome: "UNKNOWN", evidence: "NO_CONFIRMATION" };
        }
        return { success: true };
      }
    },
    windows: {
      async update(windowId, updates) {
        windowUpdates.push({ windowId, updates: { ...updates } });
      }
    },
    alarms: {
      onAlarm: { addListener(listener) { alarmListener = listener; } },
      async create(name, options) { alarmCreates.push({ name, options: { ...options } }); },
      async clear(name) { alarmClears.push(name); return true; }
    },
    scripting: {
      async executeScript(options) {
        executedScripts.push(options);
        if (options.world === "MAIN") {
          return [{
            result: {
              success: true,
              responseOk: true,
              httpStatus: 200,
              data: { code: 0, message: "Success", zpData: { jobList: [] } },
              pageState: { isLoginPage: false, isSecurityPage: false }
            }
          }];
        }
        currentContentReady = true;
        if (options.files.includes("boss-content.js")) {
          currentBossContentVersion = injectedBossVersion;
        }
        if (options.files.includes("zhilian-content.js")) {
          currentZhilianContentVersion = injectedZhilianVersion;
        }
        return [];
      }
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: storage[key] };
        },
        async set(values) {
          Object.assign(storage, values);
        },
        async remove(key) {
          for (const item of Array.isArray(key) ? key : [key]) {
            delete storage[item];
          }
        }
      }
    }
  };

  const context = vm.createContext({
    crypto: require("node:crypto").webcrypto,
    chrome,
    console,
    URL,
    URLSearchParams,
    AbortController,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout
  });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, file), "utf8"), context));
  const source = fs.readFileSync(path.join(EXTENSION_DIR, "background.js"), "utf8");
  vm.runInContext(source, context, { filename: "background.js" });
  async function dispatchRuntimeMessage(message, sender) {
    return await new Promise((resolve) => {
      const keepChannelOpen = runtimeMessageListener(message, sender, resolve);
      if (keepChannelOpen !== true) setImmediate(() => resolve(undefined));
    });
  }
  return {
    context, storage, sentMessages, executedScripts, runtimeMessageListener, tabList,
    tabUpdates, windowUpdates, alarmCreates, alarmClears, dispatchRuntimeMessage
  };
}

function dispatchRuntimeMessage(listener, message, sender) {
  return new Promise((resolve) => {
    const asyncResponse = listener(message, sender, resolve);
    if (asyncResponse !== true) queueMicrotask(() => resolve(undefined));
  });
}

test("accepts the actual Zhilian content script version", async () => {
  const { context } = loadBackground({
    tabs: [{ id: 1, windowId: 1, url: "https://www.zhaopin.com/", status: "complete" }]
  });

  assert.equal(await context.isContentScriptReady(1, "zhilian-content.js"), true);
});

test("rejects empty Zhilian keywords before creating or starting a scan", async () => {
  const { context } = loadBackground({ tabs: [] });

  const response = await context.handlePageMessage({
    type: "ZHILIAN_SCAN_START",
    platform: "zhilian",
    profileId: 4,
    config: { keywords: "[]" }
  }, { tab: { id: 20, url: "http://localhost:6866/zhilian" } });

  assert.equal(response.success, false);
  assert.equal(response.message, "请至少填写一个搜索关键词");
});

test("requires a profile for every scan lifecycle request before touching tabs", async () => {
  const { context, tabList } = loadBackground({ tabs: [] });
  const sender = { tab: { id: 20, url: "http://localhost:6866/boss" } };

  for (const [type, platform] of [
    ["BOSS_SCAN_START", "boss"],
    ["BOSS_SCAN_STATUS", "boss"],
    ["BOSS_SCAN_STOP", "boss"],
    ["ZHILIAN_SCAN_START", "zhilian"],
    ["ZHILIAN_SCAN_STATUS", "zhilian"],
    ["ZHILIAN_SCAN_STOP", "zhilian"]
  ]) {
    const response = await context.handlePageMessage({ type, platform, config: { keywords: ["Java"] } }, sender);
    assert.equal(response.success, false);
    assert.equal(response.errorCode, "PROFILE_REQUIRED");
  }
  assert.equal(tabList.length, 0);
});

test("injects all Zhilian dependencies when the content script is missing", async () => {
  const { context, executedScripts } = loadBackground({
    tabs: [{ id: 1, windowId: 1, url: "https://www.zhaopin.com/", status: "complete" }],
    contentReady: false
  });

  await context.ensureContentScript(1, "zhilian-content.js");

  assert.equal(executedScripts.length, 1);
  assert.deepEqual(Array.from(executedScripts[0].files), [
    "continuous-scan-support.js",
    "zhilian-filters.js",
    "zhilian-scan-support.js",
    "zhilian-modern-collector.js",
    "zhilian-content.js"
  ]);
});

for (const platform of ["boss", "zhilian"]) {
  const url = platform === "boss" ? "https://www.zhipin.com/" : "https://www.zhaopin.com/";
  test(`${platform}: a package/background mismatch requires extension reload, not repeated page refresh`, async () => {
    const { context, executedScripts, sentMessages } = loadBackground({
      tabs: [{ id: 1, windowId: 1, url, status: "complete" }], contentReady: false,
      injectedBossVersion: "new-package-version", injectedZhilianVersion: "new-package-version"
    });
    await assert.rejects(context.ensureContentScript(1, `${platform}-content.js`), error => {
      assert.equal(error.errorCode, "EXTENSION_RELOAD_REQUIRED");
      assert.match(error.message, /new-package-version/);
      assert.match(error.message, /chrome:\/\/extensions/);
      assert.match(error.message, /仅刷新招聘页面不能更新扩展后台/);
      return true;
    });
    assert.equal(executedScripts.length, 1);
    assert.equal(sentMessages.some(item => /SCAN_START|DELIVER/.test(item.message.type)), false);
  });

  test(`${platform}: concurrent readiness checks inject once`, async () => {
    const { context, executedScripts } = loadBackground({
      tabs: [{ id: 1, windowId: 1, url, status: "complete" }], contentReady: false
    });
    await Promise.all([context.ensureContentScript(1, `${platform}-content.js`),
      context.ensureContentScript(1, `${platform}-content.js`)]);
    assert.equal(executedScripts.length, 1);
    assert.equal(await context.isContentScriptReady(1, `${platform}-content.js`), true);
  });
}

test("reinjects all Zhilian dependencies when the content script is stale", async () => {
  const { context, executedScripts } = loadBackground({
    tabs: [{ id: 1, windowId: 1, url: "https://www.zhaopin.com/", status: "complete" }],
    zhilianContentVersion: "2026-06-25-scan-resume-redirect-2"
  });

  await context.ensureContentScript(1, "zhilian-content.js");

  assert.equal(executedScripts.length, 1);
  assert.deepEqual(Array.from(executedScripts[0].files), [
    "continuous-scan-support.js",
    "zhilian-filters.js",
    "zhilian-scan-support.js",
    "zhilian-modern-collector.js",
    "zhilian-content.js"
  ]);
  assert.equal(await context.isContentScriptReady(1, "zhilian-content.js"), true);
});

test("allows Zhilian content scripts to navigate to supported search pages", async () => {
  const { context } = loadBackground({
    tabs: [{ id: 1, windowId: 1, url: "https://www.zhaopin.com/", status: "complete" }]
  });

  const result = await context.handleZhilianContentNavigation({
    url: "https://www.zhaopin.com/sou/jl489/?kw=AI%E4%BA%A7%E5%93%81%E8%BF%90%E8%90%A5",
    navigationType: "search"
  }, {
    tab: { id: 1, url: "https://www.zhaopin.com/" }
  });

  assert.equal(result.success, true);
  assert.equal(result.navigationType, "search");
});

test("rejects non-Zhilian search navigation", async () => {
  const { context } = loadBackground({
    tabs: [{ id: 1, windowId: 1, url: "https://www.zhaopin.com/", status: "complete" }]
  });

  const result = await context.handleZhilianContentNavigation({
    url: "https://example.com/sou/",
    navigationType: "search"
  }, {
    tab: { id: 1, url: "https://www.zhaopin.com/" }
  });

  assert.equal(result.success, false);

  const lookalikeResult = await context.handleZhilianContentNavigation({
    url: "https://evilzhaopin.com/sou/",
    navigationType: "search"
  }, {
    tab: { id: 1, url: "https://www.zhaopin.com/" }
  });

  assert.equal(lookalikeResult.success, false);
});

test("allows Zhilian job submission through the fixed local API route", async () => {
  const requests = [];
  const { runtimeMessageListener } = loadBackground({
    tabs: [],
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ success: true, received: 1, saved: 1, queued: 1 });
    }
  });

  const response = await dispatchRuntimeMessage(runtimeMessageListener, {
    source: "GET_JOBS_ZHILIAN_CONTENT",
    type: "ZHILIAN_LOCAL_API",
    operation: "chrome-jobs",
    body: { profileId: 4, runId: "run-1", keyword: "Java", jobs: [{ title: "Java工程师" }] }
  }, {
    tab: { id: 8, url: "https://www.zhaopin.com/jobdetail/demo.htm" }
  });

  assert.equal(response.success, true);
  assert.equal(response.data.saved, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://127.0.0.1:6866/api/zhilian/chrome/jobs");
  assert.equal(requests[0].options.method, "POST");
});

test("allows numeric Zhilian delivery result IDs and rejects invalid or unknown routes", async () => {
  const urls = [];
  const { runtimeMessageListener } = loadBackground({
    tabs: [],
    fetchImpl: async (url) => {
      urls.push(url);
      return jsonResponse({ success: true, accepted: true, state: "CONFIRMED" });
    }
  });
  const sender = { tab: { id: 9, url: "https://www.zhaopin.com/jobdetail/demo.htm" } };

  const allowed = await dispatchRuntimeMessage(runtimeMessageListener, {
    source: "GET_JOBS_ZHILIAN_CONTENT",
    type: "ZHILIAN_LOCAL_API",
    operation: "delivery-result",
    params: { id: 123 },
    body: { outcome: "CONFIRMED", evidence: "PLATFORM_STATUS_TEXT" }
  }, sender);
  const invalidId = await dispatchRuntimeMessage(runtimeMessageListener, {
    source: "GET_JOBS_ZHILIAN_CONTENT",
    type: "ZHILIAN_LOCAL_API",
    operation: "delivery-result",
    params: { id: "12/not-allowed" }
  }, sender);
  const unknown = await dispatchRuntimeMessage(runtimeMessageListener, {
    source: "GET_JOBS_ZHILIAN_CONTENT",
    type: "ZHILIAN_LOCAL_API",
    operation: "arbitrary-url",
    url: "http://example.com/unsafe"
  }, sender);

  assert.equal(allowed.success, true);
  assert.equal(urls[0], "http://127.0.0.1:6866/api/zhilian/jobs/123/delivery-result");
  assert.equal(invalidId.success, false);
  assert.match(invalidId.message, /有效岗位ID/);
  assert.equal(unknown.success, false);
  assert.match(unknown.message, /不被允许/);
  assert.equal(urls.length, 1);
});

test("treats HTTP 200 business rejection as a failed local API request", async () => {
  const { context } = loadBackground({
    tabs: [],
    fetchImpl: async () => jsonResponse({ success: false, message: "状态已变化" })
  });

  const result = await context.requestLocalApi("/api/boss/jobs/1/delivery-result", {
    operation: "delivery-result",
    method: "POST",
    body: { requestKey: "request-1", outcome: "CONFIRMED", evidence: "PLATFORM_STATUS_TEXT" }
  });

  assert.equal(result.success, false);
  assert.equal(result.errorType, "BUSINESS_REJECTED");
  assert.equal(result.message, "状态已变化");
});

test("accepts a valid local JSON envelope when Chrome hides the Content-Type header", async () => {
  const { context } = loadBackground({ tabs: [] });
  const response = {
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    async text() { return JSON.stringify({ success: true, data: { watching: false } }); }
  };

  const parsed = await context.parseLocalApiResponse(response);

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.watching, false);
});

test("binds the initiating Boss chat directly without opening or focusing another window", async () => {
  const requests = [];
  const { dispatchRuntimeMessage, tabUpdates, windowUpdates, alarmCreates } = loadBackground({
    tabs: [{ id: 7, windowId: 3, url: "https://www.zhipin.com/web/geek/chat", status: "complete" }],
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.endsWith("/api/local-auth/action-token")) {
        return jsonResponse({ success: true, data: { token: "test-action-token" } });
      }
      if (url.endsWith("/api/hr-assistant/watch/start")) {
        return jsonResponse({ success: true, data: { watching: true, watchSessionId: "watch-1", profileId: 1 } });
      }
      if (url.endsWith("/api/hr-assistant/autopilot")) return jsonResponse({success:true,data:{enabled:false,paused:false}});
      throw new Error(`unexpected URL: ${url}`);
    }
  });

  const response = await dispatchRuntimeMessage({
    source: "GET_JOBS_BOSS_CONTENT",
    type: "BOSS_LOCAL_API",
    operation: "hr-start",
    body: { expectedProfileId: 1 },
    timeoutMs: 30000
  }, {
    tab: { id: 7, windowId: 3, url: "https://www.zhipin.com/web/geek/chat" }
  });

  assert.equal(response.success, true);
  assert.deepEqual(requests.map((url) => new URL(url).pathname), [
    "/api/local-auth/action-token",
    "/api/hr-assistant/watch/start",
    "/api/hr-assistant/autopilot"
  ]);
  assert.equal(tabUpdates.length, 0);
  assert.equal(windowUpdates.length, 0);
  assert.deepEqual(alarmCreates, [{ name: "getjobs-boss-hr-watch", options: { periodInMinutes: 1 } }]);
});

test("persists an HR Outbox identity before a content script opens the conversation", async () => {
  const { context, dispatchRuntimeMessage, storage } = loadBackground({
    tabs: [{ id: 7, windowId: 3, url: "https://www.zhipin.com/web/geek/chat", status: "complete" }]
  });
  await context.writeBossHrWatch({ watching: true, tabId: 7, watchSessionId: "watch-1", profileId: 1 });

  const response = await dispatchRuntimeMessage({
    source: "GET_JOBS_BOSS_HR_CONTENT",
    type: "BOSS_HR_OUTBOX_PUT",
    watchSessionId: "watch-1",
    capture: { captureId: "capture-1", uid: "friend-1", unreadCount: 1, hrName: "HR" }
  }, { tab: { id: 7, url: "https://www.zhipin.com/web/geek/chat" } });

  assert.equal(response.success, true);
  assert.equal(storage.__GET_JOBS_BOSS_HR_OUTBOX__["1:capture-1"].uid, "friend-1");
});

test("preserves backend profile errors and rejects unscoped job submission locally", async () => {
  let fetchCalls = 0;
  const { context } = loadBackground({
    tabs: [],
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ success: false, errorCode: "PROFILE_CHANGED", message: "档案已切换" }, { ok: false, status: 409 });
    }
  });

  const missing = await context.handleBossLocalApiRequest({ operation: "chrome-jobs", body: { jobs: [] } });
  const changed = await context.handleBossLocalApiRequest({ operation: "chrome-jobs", body: { profileId: 4, jobs: [] } });

  assert.equal(missing.errorCode, "PROFILE_REQUIRED");
  assert.equal(fetchCalls, 1);
  assert.equal(changed.errorType, "PROFILE_CHANGED");
});

test("records an empty Boss chat-page response as unknown instead of confirmed", async () => {
  const requests = [];
  const { context } = loadBackground({
    tabs: [{ id: 7, windowId: 1, url: "https://www.zhipin.com/web/geek/chat", status: "complete" }],
    fetchImpl: async (url, options) => {
      if(url.endsWith("/api/hr-assistant/autopilot")) return jsonResponse({success:true,data:{enabled:false,paused:false}});
      requests.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({ success: true, accepted: true, state: "UNKNOWN" });
    }
  });

  const result = await context.inferBossDeliveryAfterEmptyResponse(7, {
    id: 99,
    requestKey: "request-99"
  });

  assert.equal(result.success, false);
  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.persisted, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.requestKey, "request-99");
  assert.equal(requests[0].body.outcome, "UNKNOWN");
  assert.equal(requests[0].body.evidence, "CHAT_SURFACE_ONLY");
});

test("does not upgrade legacy success booleans to confirmed without explicit evidence", () => {
  const { context } = loadBackground({ tabs: [] });

  assert.equal(context.deliveryOutcomeOf({ success: true }), "UNKNOWN");
  assert.equal(context.deliveryOutcomeOf({ outcome: "CONFIRMED" }), "UNKNOWN");
  assert.equal(context.deliveryOutcomeOf({
    outcome: "CONFIRMED",
    evidence: "PLATFORM_STATUS_TEXT"
  }), "CONFIRMED");
});

test("surfaces delivery-result persistence failure instead of reporting a stored outcome", async () => {
  const { context } = loadBackground({
    tabs: [],
    fetchImpl: async () => jsonResponse(
      { success: false, message: "database unavailable" },
      { ok: false, status: 500 }
    )
  });

  await assert.rejects(
    context.recordBossDeliveryResponse(
      { id: 77, requestKey: "request-77" },
      { outcome: "UNKNOWN", evidence: "NO_CONFIRMATION", message: "result uncertain" }
    ),
    /database unavailable/
  );
});

test("rejects forged Zhilian senders before any local API request", async () => {
  let fetchCalls = 0;
  const { runtimeMessageListener } = loadBackground({
    tabs: [],
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("forged sender must not reach fetch");
    }
  });

  const response = await dispatchRuntimeMessage(runtimeMessageListener, {
    source: "GET_JOBS_ZHILIAN_CONTENT",
    type: "ZHILIAN_LOCAL_API",
    operation: "chrome-jobs",
    body: {}
  }, {
    tab: { id: 10, url: "https://zhaopin.com.example.com/jobdetail/demo.htm" }
  });

  assert.equal(response.success, false);
  assert.match(response.message, /拒绝非智联页面/);
  assert.equal(fetchCalls, 0);
});

test("keeps Boss and Zhilian scan ownership when both start together", async () => {
  const { context, storage } = loadBackground({ tabs: [] });

  await Promise.all([
    context.registerScanSession("boss", 1, "boss-run", 10, "", 4),
    context.registerScanSession("zhilian", 2, "zhilian-run", 10, "", 4)
  ]);

  const sessions = storage.__GET_JOBS_PLATFORM_SCAN_SESSIONS__;
  assert.equal(sessions.boss.tabId, 1);
  assert.equal(sessions.zhilian.tabId, 2);
});

test("halts a Boss batch after the first unknown result and leaves later jobs untouched", async () => {
  const requests = [];
  const tasks = [1, 2, 3].map((id) => ({
    id,
    requestKey: `request-${id}`,
    url: `https://www.zhipin.com/job_detail/job-${id}.html`,
    greeting: `岗位 ${id} 的精确话术`
  }));
  const { context, sentMessages } = loadBackground({
    tabs: [{ id: 7, windowId: 1, url: tasks[0].url, status: "complete" }],
    bossDeliveryResponses: [{
      success: false,
      outcome: "UNKNOWN",
      evidence: "CHAT_SURFACE_ONLY",
      greetingOutcome: "UNKNOWN",
      greetingEvidence: "GREETING_RENDER_UNCONFIRMED",
      message: "点击发送后未检测到精确话术"
    }],
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      return jsonResponse({ success: true, accepted: true, state: body.outcome });
    }
  });

  const result = await context.handleBossDeliver(
    { id: 7, windowId: 1, url: tasks[0].url, status: "complete" },
    { hosts: ["zhipin.com"], contentScript: "boss-content.js" },
    { type: "BOSS_DELIVER_BATCH", tasks },
    null
  );

  assert.equal(result.success, false);
  assert.equal(result.halted, true);
  assert.equal(result.haltedJobId, 1);
  assert.equal(result.unknownCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(result.unprocessedCount, 2);
  assert.equal(result.results.length, 3);
  assert.deepEqual(Array.from(result.results.slice(1), (item) => item.skipped), [true, true]);
  assert.equal(sentMessages.filter((entry) => entry.message.type === "BOSS_DELIVER_CURRENT_V2").length, 1);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].body.outcome, "UNKNOWN");
  assert.deepEqual(requests.slice(1).map((entry) => entry.body.greetingOutcome), ["NOT_SENT", "NOT_SENT"]);
  assert.deepEqual(requests.slice(1).map((entry) => entry.body.evidence), ["BATCH_HALTED_BEFORE_ACTION", "BATCH_HALTED_BEFORE_ACTION"]);
});

test("preserves Boss existing-conversation and not-sent evidence", async () => {
  const requests = [];
  const { context } = loadBackground({
    tabs: [],
    fetchImpl: async (url, options) => {
      if(url.endsWith("/api/hr-assistant/autopilot")) return jsonResponse({success:true,data:{enabled:false,paused:false}});
      requests.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({ success: true, accepted: true, state: "UNKNOWN" });
    }
  });

  const result = await context.recordBossDeliveryResponse(
    { id: 51, requestKey: "boss-existing" },
    {
      success: false,
      outcome: "UNKNOWN",
      evidence: "EXISTING_CONVERSATION",
      greetingOutcome: "NOT_SENT",
      greetingEvidence: "ALREADY_CONTACTED",
      message: "已有沟通，本次未补发"
    }
  );

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.evidence, "EXISTING_CONVERSATION");
  assert.equal(result.greetingOutcome, "NOT_SENT");
  assert.equal(result.greetingEvidence, "ALREADY_CONTACTED");
  assert.equal(requests[0].body.evidence, "EXISTING_CONVERSATION");
  assert.equal(requests[0].body.greetingOutcome, "NOT_SENT");
  assert.equal(requests[0].body.greetingEvidence, "ALREADY_CONTACTED");
});

test("profile switch and legacy sessions invalidate shared checkpoints", async () => {
  const { context, storage } = loadBackground({
    tabs: [
      { id: 1, windowId: 1, url: "https://www.zhipin.com/job_detail/old.html", status: "complete", lastAccessed: 10 },
      { id: 2, windowId: 1, url: "https://www.zhipin.com/web/geek/job", status: "complete", lastAccessed: 20 }
    ],
    statuses: {
      1: { success: true, isRunning: true, hasStoredTask: true, stage: "details", runId: "old", profileId: 3 }
    }
  });
  await context.registerScanSession("boss", 1, "old", 10, "", 3);
  storage.__GET_JOBS_BOSS_SHARED_SCAN_TASK__ = { runId: "old", profileId: 3 };

  const selected = await context.findScanPlatformTab("boss", "https://www.zhipin.com/web/geek/job", "new", 4);

  assert.equal(selected.id, 2);
  assert.equal(storage.__GET_JOBS_PLATFORM_SCAN_SESSIONS__.boss, undefined);
  assert.equal(storage.__GET_JOBS_BOSS_SHARED_SCAN_TASK__, undefined);

  storage.__GET_JOBS_PLATFORM_SCAN_SESSIONS__ = {
    boss: { platform: "boss", tabId: 1, runId: "legacy", updatedAt: Date.now() }
  };
  storage.__GET_JOBS_BOSS_SHARED_SCAN_TASK__ = { runId: "legacy" };
  assert.equal(await context.readScanSession("boss"), null);
  assert.equal(storage.__GET_JOBS_BOSS_SHARED_SCAN_TASK__, undefined);
});

test("drops delayed scan events from another profile", async () => {
  const { context, sentMessages } = loadBackground({
    tabs: [
      { id: 1, windowId: 1, url: "https://www.zhipin.com/web/geek/job", status: "complete" },
      { id: 10, windowId: 1, url: "http://localhost:6866/boss", status: "complete" }
    ]
  });
  await context.registerScanSession("boss", 1, "current", 10, "", 4);

  await context.forwardPlatformEvent({
    payload: { platform: "boss", operation: "scan", stage: "details", profileId: 3 }
  }, { tab: { id: 1, url: "https://www.zhipin.com/web/geek/job" } });

  assert.equal(sentMessages.filter((entry) => entry.message.type === "GET_JOBS_EXTENSION_EVENT").length, 0);
});

test("uses a separate Boss tab for delivery while scanning", async () => {
  const { context } = loadBackground({
    tabs: [
      { id: 1, windowId: 1, url: "https://www.zhipin.com/web/geek/job", status: "complete", lastAccessed: 10 },
      { id: 2, windowId: 1, url: "https://www.zhipin.com/", status: "complete", lastAccessed: 20 }
    ],
    statuses: {
      1: { success: true, isRunning: true, hasStoredTask: true, stage: "details", runId: "boss-run", profileId: 4 },
      2: { success: true, isRunning: false, hasStoredTask: false, stage: "idle" }
    }
  });
  await context.registerScanSession("boss", 1, "boss-run", 10, "", 4);

  const deliveryTab = await context.findDeliveryPlatformTab("boss", "https://www.zhipin.com/job_detail/demo.html");

  assert.equal(deliveryTab.id, 2);
});

test("status lookup keeps using the registered scan tab after another tab is clicked", async () => {
  const { context } = loadBackground({
    tabs: [
      { id: 1, windowId: 1, url: "https://www.zhipin.com/web/geek/job", status: "complete", lastAccessed: 10 },
      { id: 2, windowId: 1, url: "https://www.zhipin.com/job_detail/other.html", status: "complete", lastAccessed: 999 }
    ]
  });
  await context.registerScanSession("boss", 1, "boss-run", 10, "", 4);

  const scanTab = await context.findRegisteredOrRunningScanTab("boss", 4);
  const owner = await context.handleScanOwnerStatus("boss", { tab: { id: 2 } });

  assert.equal(scanTab.id, 1);
  assert.equal(owner.isOwner, false);
});

test("new Boss scan run does not keep using a registered stale scan tab", async () => {
  const { context, storage } = loadBackground({
    tabs: [
      { id: 1, windowId: 1, url: "https://www.zhipin.com/job_detail/old.html", status: "complete", lastAccessed: 10 },
      { id: 2, windowId: 1, url: "https://www.zhipin.com/web/geek/job", status: "complete", lastAccessed: 20 }
    ],
    statuses: {
      1: { success: true, isRunning: true, hasStoredTask: true, stage: "details", runId: "boss-old-run", profileId: 4 },
      2: { success: true, isRunning: false, hasStoredTask: false, stage: "idle" }
    }
  });
  await context.registerScanSession("boss", 1, "boss-old-run", 10, "", 4);
  storage.__GET_JOBS_BOSS_SHARED_SCAN_TASK__ = { runId: "boss-old-run", profileId: 4 };

  const scanTab = await context.findScanPlatformTab(
    "boss",
    "https://www.zhipin.com/web/geek/job?city=101280600&query=Java",
    "boss-new-run",
    4
  );

  assert.equal(scanTab.id, 2);
  assert.equal(storage.__GET_JOBS_PLATFORM_SCAN_SESSIONS__.boss, undefined);
  assert.equal(storage.__GET_JOBS_BOSS_SHARED_SCAN_TASK__, undefined);
});

test("Boss content navigation allows job detail pages and rejects external pages", async () => {
  const { context, tabList } = loadBackground({
    tabs: [
      { id: 1, windowId: 1, url: "https://www.zhipin.com/web/geek/job", status: "complete" }
    ]
  });

  const detailResponse = await context.handleBossContentNavigation({
    url: "https://www.zhipin.com/job_detail/demo.html"
  }, { tab: { id: 1, url: "https://www.zhipin.com/web/geek/job" } });
  const externalResponse = await context.handleBossContentNavigation({
    url: "https://example.com/job_detail/demo.html"
  }, { tab: { id: 1, url: "https://www.zhipin.com/job_detail/demo.html" } });
  const lookalikeResponse = await context.handleBossContentNavigation({
    url: "https://evilzhipin.com/job_detail/demo.html"
  }, { tab: { id: 1, url: "https://www.zhipin.com/job_detail/demo.html" } });
  const insecureResponse = await context.handleBossContentNavigation({
    url: "http://www.zhipin.com/job_detail/demo.html"
  }, { tab: { id: 1, url: "https://www.zhipin.com/job_detail/demo.html" } });

  assert.equal(detailResponse.success, true);
  assert.equal(tabList[0].url, "https://www.zhipin.com/job_detail/demo.html");
  assert.equal(externalResponse.success, false);
  assert.equal(lookalikeResponse.success, false);
  assert.equal(insecureResponse.success, false);
});

test("rejects forged Boss senders before any local API request", async () => {
  let fetchCalls = 0;
  const { runtimeMessageListener } = loadBackground({
    tabs: [],
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("forged sender must not reach fetch");
    }
  });

  const response = await dispatchRuntimeMessage(runtimeMessageListener, {
    source: "GET_JOBS_BOSS_CONTENT",
    type: "BOSS_LOCAL_API",
    operation: "chrome-jobs",
    body: {}
  }, {
    tab: { id: 10, url: "https://zhipin.com.example.com/job_detail/demo.html" }
  });

  assert.equal(response.success, false);
  assert.match(response.message, /拒绝非 Boss 页面/);
  assert.equal(fetchCalls, 0);
});

test("Boss stop clears registered scan session and shared checkpoint", async () => {
  const { context, storage } = loadBackground({
    tabs: [
      { id: 1, windowId: 1, url: "https://www.zhipin.com/job_detail/old.html", status: "complete" }
    ]
  });
  await context.registerScanSession("boss", 1, "boss-run", 10, "", 4);
  storage.__GET_JOBS_BOSS_SHARED_SCAN_TASK__ = { runId: "boss-run", profileId: 4 };
  storage.__GET_JOBS_BOSS_SHARED_SCAN_CANCEL__ = { runId: "boss-run", requested: true };

  const response = await context.sendPassiveStop(1, "boss", { type: "BOSS_SCAN_STOP", runId: "boss-run", profileId: 4 }, 10);

  assert.equal(response.success, true);
  assert.equal(storage.__GET_JOBS_PLATFORM_SCAN_SESSIONS__.boss, undefined);
  assert.equal(storage.__GET_JOBS_BOSS_SHARED_SCAN_TASK__, undefined);
  assert.equal(storage.__GET_JOBS_BOSS_SHARED_SCAN_CANCEL__, undefined);
});

test("broadcasts scan progress to every open local app page", async () => {
  const { context, sentMessages } = loadBackground({
    tabs: [
      { id: 10, windowId: 1, url: "http://localhost:6866/boss", status: "complete" },
      { id: 11, windowId: 1, url: "http://127.0.0.1:6866/boss/analysis", status: "complete" },
      { id: 12, windowId: 1, url: "https://www.zhipin.com/web/geek/job", status: "complete" }
    ]
  });

  await context.broadcastPlatformEvent({ platform: "boss", operation: "scan", stage: "details" }, 10);

  const targetIds = sentMessages
    .filter((entry) => entry.message.type === "GET_JOBS_EXTENSION_EVENT")
    .map((entry) => entry.tabId)
    .sort((left, right) => left - right);
  assert.deepEqual(targetIds, [10, 11]);
});

test("reports navigation as running while the registered scan content script reloads", async () => {
  const { context } = loadBackground({
    tabs: [
      { id: 1, windowId: 1, url: "https://www.zhipin.com/job_detail/demo.html", status: "loading" }
    ]
  });
  await context.registerScanSession("boss", 1, "boss-run", 10, "", 4);

  const status = await context.buildRegisteredNavigationStatus("boss", 1);

  assert.equal(status.isRunning, true);
  assert.equal(status.hasStoredTask, true);
  assert.equal(status.stage, "navigating");
  assert.equal(status.runId, "boss-run");
  assert.equal(status.profileId, 4);
});

test("runs only the fixed Boss search API request in the page MAIN world", async () => {
  const { dispatchRuntimeMessage, executedScripts } = loadBackground({
    tabs: [{ id: 7, windowId: 1, url: "https://www.zhipin.com/web/geek/job", status: "complete" }]
  });
  const request = {
    source: "GET_JOBS_BOSS_CONTENT",
    type: "BOSS_API_PAGE_REQUEST",
    request: {
      path: "/wapi/zpgeek/search/joblist.json",
      params: {
        scene: "1",
        query: "Java",
        city: "101280600",
        page: "1",
        pageSize: "10",
        salary: "405,406"
      }
    }
  };

  const denied = await dispatchRuntimeMessage(request, {
    tab: { id: 8, url: "https://example.com/" },
    url: "https://example.com/"
  });
  assert.equal(denied.success, false);
  assert.equal(executedScripts.length, 0);

  const response = await dispatchRuntimeMessage(request, {
    tab: { id: 7, url: "https://www.zhipin.com/web/geek/job" },
    url: "https://www.zhipin.com/web/geek/job"
  });
  assert.equal(response.success, true, response.message || JSON.stringify(response));
  assert.equal(executedScripts.length, 1);
  assert.equal(executedScripts[0].world, "MAIN");
  assert.equal(executedScripts[0].target.tabId, 7);
  assert.match(executedScripts[0].args[0], /^\/wapi\/zpgeek\/search\/joblist\.json\?/);
  assert.match(executedScripts[0].args[0], /pageSize=10/);
});

test("rejects unsafe Boss API paths and out-of-scope pagination", () => {
  const { context } = loadBackground({ tabs: [] });

  assert.equal(context.resolveBossApiPageRequest({
    path: "/wapi/other.json",
    params: {}
  }).success, false);
  assert.equal(context.resolveBossApiPageRequest({
    path: "/wapi/zpgeek/search/joblist.json",
    params: { scene: "1", query: "Java", city: "101280600", page: "2", pageSize: "10" }
  }).success, false);
  assert.equal(context.resolveBossApiPageRequest({
    path: "/wapi/zpgeek/search/joblist.json",
    params: { scene: "1", query: "Java", city: "101280600", page: "1", pageSize: "11" }
  }).success, false);
});


test("HR backend 404 retains HTTP identity while malformed 200 stays a contract error", async () => {
  for (const [status, expected] of [[404, "HR_BACKEND_UNAVAILABLE"], [200, "LOCAL_API_CONTRACT_MISMATCH"]]) {
    let calls = 0;
    const { context } = loadBackground({ tabs: [], fetchImpl: async () => {
      calls++; return jsonResponse({ status, error: "Not Found" }, { status, ok: status === 200 });
    } });
    const result = await context.requestLocalApi("/api/hr-assistant/status", { method: "GET", operation: "hr-status" });
    assert.equal(result.httpStatus, status);
    assert.equal(result.errorType, expected);
    assert.equal(calls, 1);
  }
});

test("chat entry focuses the bound tab, reuses an existing chat, or opens the fixed URL", async () => {
  for (const mode of ["bound", "existing", "new"]) {
    const tabs = mode === "new" ? [] : [
      { id: 7, windowId: 3, url: "https://www.zhipin.com/web/geek/chat", lastAccessed: 10 },
      { id: 8, windowId: 4, url: "https://www.zhipin.com/web/geek/chat", lastAccessed: 20 },
    ];
    const { context, tabList, dispatchRuntimeMessage, windowUpdates } = loadBackground({ tabs });
    if (mode === "bound") await context.writeBossHrWatch({ tabId: 7 });
    const result = await dispatchRuntimeMessage({ source: "GET_JOBS_PAGE", type: "BOSS_HR_OPEN_CHAT", url: "https://evil.example/" },
      { tab: { id: 20, url: "http://127.0.0.1:6866/env-config" } });
    assert.equal(result.success, true);
    assert.equal(result.tabId, mode === "bound" ? 7 : mode === "existing" ? 8 : 1);
    assert.equal(tabList.length, mode === "new" ? 1 : 2);
    assert.equal(windowUpdates.length, 1);
    assert.ok(tabList.every(tab => tab.url === "https://www.zhipin.com/web/geek/chat"));
    const rejected = await dispatchRuntimeMessage({ source: "GET_JOBS_PAGE", type: "BOSS_HR_OPEN_CHAT" },
      { tab: { id: 21, url: "https://evil.example/" } });
    assert.equal(rejected.success, false);
  }
});

test("Outbox acknowledgements and old-session captures cannot cross profiles or erase legacy records", async () => {
  const { context, storage } = loadBackground({ tabs: [] });
  await context.writeBossHrOutbox({
    "legacy": { captureId: "legacy", uid: "old" },
    "1:same": { captureId: "same", uid: "first", profileId: 1 },
    "2:same": { captureId: "same", uid: "second", profileId: 2 },
  });
  await context.acknowledgeBossHrOutbox(["same"], 1);
  assert.equal(storage.__GET_JOBS_BOSS_HR_OUTBOX__["1:same"], undefined);
  assert.equal(storage.__GET_JOBS_BOSS_HR_OUTBOX__["2:same"].uid, "second");
  assert.equal(storage.__GET_JOBS_BOSS_HR_OUTBOX__.legacy.uid, "old");
  await context.writeBossHrWatch({ watching: true, tabId: 7, profileId: 2, watchSessionId: "new" });
  const rejected = await context.handleBossHrOutboxPut({ watchSessionId: "old", capture: { captureId: "late", uid: "uid" } },
    { tab: { id: 7, url: "https://www.zhipin.com/web/geek/chat" } });
  assert.equal(rejected.errorCode, "STALE_STATE");
  assert.equal(Object.keys(storage.__GET_JOBS_BOSS_HR_OUTBOX__).length, 2);
});


test("a late scan cannot restore stopped watch state", async () => {
  const { context } = loadBackground({ tabs: [] });
  const state = { watching: true, watchSessionId: "watch-1", profileId: 1, tabId: 7 };
  await context.writeBossHrWatch(state);
  await context.writeBossHrWatch({ ...state, watching: false });
  assert.equal(await context.updateBossHrWatchIfActive(state, { scanRunning: false }), false);
  assert.equal((await context.readBossHrWatch()).watching, false);
});

test("losing the send channel records an unknown outcome exactly once", async () => {
  const results = [];
  const { context } = loadBackground({ tabs: [], fetchImpl: async (url, options) => {
    if (url.endsWith("/action-token")) return jsonResponse({ success: true, data: { token: "t" } });
    if (url.endsWith("/claim")) return jsonResponse({ success: true, data: { commandId: "cmd", leaseToken: "lease", leaseDeadlineEpochMs: Date.now() + 60000 } });
    if (url.endsWith("/result")) { results.push(JSON.parse(options.body)); return jsonResponse({ success: true, data: {} }); }
    throw new Error(url);
  } });
  await context.writeBossHrWatch({ watching: true, watchSessionId: "watch-1", profileId: 1, tabId: 7 });
  context.chrome.tabs.sendMessage = async () => { throw new Error("message channel closed"); };
  const result = await context.pollBossHrSendCommandLocked({ tab: { id: 7 } }, {});
  assert.equal(result.success, true);
  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, "RESULT_UNKNOWN");
});


test("rejects the old HR script before any backend start request", async () => {
  const { dispatchRuntimeMessage } = loadBackground({
    tabs: [{ id: 7, url: "https://www.zhipin.com/web/geek/chat", status: "complete" }],
    bossHrContentVersion: "2026-09-06-hr-profile-guard"
  });
  const response = await dispatchRuntimeMessage({
    source: "GET_JOBS_BOSS_CONTENT", type: "BOSS_LOCAL_API", operation: "hr-start",
    body: { expectedProfileId: 1 }
  }, { tab: { id: 7, url: "https://www.zhipin.com/web/geek/chat" } });
  assert.equal(response.success, false);
  assert.equal(response.errorCode, "BOSS_HR_CONTENT_OUTDATED");
});


test("thirty minute mode is persisted and asks the content bridge to read all conversations", async () => {
  const requests = [];
  const { context, alarmCreates, storage, sentMessages } = loadBackground({
    tabs: [{ id: 7, url: "https://www.zhipin.com/web/geek/chat", status: "complete" }],
    fetchImpl: async (url, options) => {
      if (url.endsWith("action-token")) return jsonResponse({ success: true, data: { token: "test" } });
      if(url.endsWith("/api/hr-assistant/autopilot")) return jsonResponse({success:true,data:{enabled:false,paused:false}});
      requests.push({ url, body: JSON.parse(options.body) });
      if (url.endsWith("watch/start")) return jsonResponse({ success: true, data: { watchSessionId: "watch", profileId: 1 } });
      return jsonResponse({ success: true, data: { acknowledgedCaptureIds: [] } });
    }
  });
  const run = context.runBossHrScan;
  context.runBossHrScan = async () => {};
  await context.startBossHrWatch({ tab: { id: 7, url: "https://www.zhipin.com/web/geek/chat" } }, {}, 1, 30);
  assert.equal(requests[0].body.intervalMinutes, 30);
  assert.equal(storage.__GET_JOBS_BOSS_HR_WATCH__.intervalMinutes, 30);
  assert.equal(alarmCreates[0].options.periodInMinutes, 30);
  await run("initial");
  const scan = sentMessages.find(entry => entry.message.type === "BOSS_HR_SCAN_V2");
  assert.equal(scan.message.scanAll, true);
  assert.equal(scan.message.streamResults, true);
  assert.equal(alarmCreates.at(-1).options.delayInMinutes, 30);
});

test("streamed capture rejects stale sessions and retains Outbox after an unknown AI submission", async () => {
  let submissions = 0;
  const { context, storage } = loadBackground({
    tabs: [],
    fetchImpl: async (url) => {
      if (url.endsWith("action-token")) return jsonResponse({ success: true, data: { token: "test" } });
      submissions++;
      throw new Error("NetworkError");
    }
  });
  await context.writeBossHrWatch({ watching: true, scanRunning: true, tabId: 7, profileId: 1, watchSessionId: "watch", scanId: "scan" });
  await context.writeBossHrOutbox({ "1:cap": { profileId: 1, uid: "101-0", captureId: "cap" } });
  const sender = { tab: { id: 7, url: "https://www.zhipin.com/web/geek/chat" } };
  const message = { watchSessionId: "old", scanId: "scan", capture: { captureId: "cap", session: { uid: "101-0" }, messages: [{ from: "对方", type: "文本", text: "你好" }] } };
  assert.equal((await context.submitBossHrCapture(message, sender)).errorCode, "STALE_STATE");
  assert.equal(submissions, 0);
  message.watchSessionId = "watch";
  assert.equal((await context.submitBossHrCapture(message, sender)).success, false);
  assert.equal(submissions, 1);
  assert.ok(storage.__GET_JOBS_BOSS_HR_OUTBOX__["1:cap"]);
});


test("Zhilian page checks prefer a usable tab without focusing or creating tabs", async () => {
  const harness = loadBackground({ tabs: [
    { id: 1, windowId: 1, url: "https://passport.zhaopin.com/login", status: "complete", lastAccessed: 20 },
    { id: 2, windowId: 1, url: "https://www.zhaopin.com/sou/", status: "complete", lastAccessed: 10 }
  ], statuses: { 1: { success: true, hasLoginPrompt: true, chromePageReady: false }, 2: { success: true, chromePageReady: true } } });
  const response = await harness.dispatchRuntimeMessage({ source: "GET_JOBS_PAGE", type: "ZHILIAN_PAGE_STATUS", platform: "zhilian" }, { tab: { id: 20, url: "http://127.0.0.1:6866/zhilian" }, url: "http://127.0.0.1:6866/zhilian" });
  assert.equal(response.chromePageReady, true);
  assert.equal(response.tabId, 2);
  assert.equal(harness.tabUpdates.length, 0);
  assert.equal(harness.tabList.length, 2);
  const selected = await harness.context.findScanPlatformTab("zhilian", "https://www.zhaopin.com/", "run-4", 4);
  assert.equal(selected.id, 2);
});

test("Zhilian missing and loading pages remain unavailable without opening a tab", async () => {
  const missing = loadBackground({ tabs: [] });
  const status = await missing.context.handlePageMessage({ type: "ZHILIAN_PAGE_STATUS", platform: "zhilian" }, { tab: { id: 20 } });
  assert.equal(status.chromePageReady, false);
  assert.equal(status.pageState, "NO_TAB");
  assert.equal(missing.tabList.length, 0);
  const loading = loadBackground({ tabs: [{ id: 1, url: "https://www.zhaopin.com/", status: "loading" }] });
  const pending = await loading.context.handlePageMessage({ type: "ZHILIAN_PAGE_STATUS", platform: "zhilian" }, { tab: { id: 20 } });
  assert.equal(pending.pageState, "LOADING");
  assert.equal(loading.sentMessages.length, 0);
});

test("explicit Zhilian preflight opens one official page for concurrent requests and reuses it", async () => {
  const harness = loadBackground({ tabs: [], statuses: { 1: { success: true, chromePageReady: true } } });
  const message = { type: "ZHILIAN_PAGE_STATUS", platform: "zhilian", openIfMissing: true, startUrl: "https://example.com/" };
  const results = await Promise.all([harness.context.queryZhilianPageStatus(message, 20), harness.context.queryZhilianPageStatus(message, 20)]);
  assert.ok(results.every(result => result.chromePageReady));
  assert.equal(harness.tabList.length, 1);
  assert.equal(harness.tabList[0].url, "https://www.zhaopin.com/jobs?jl=489");
  await harness.context.queryZhilianPageStatus(message, 20);
  assert.equal(harness.tabList.length, 1);
  assert.equal(harness.tabUpdates.length, 0);
});

test("explicit Zhilian preflight waits for loading pages without navigating or bypassing login", async () => {
  const harness = loadBackground({ tabs: [{ id: 1, url: "https://www.zhaopin.com/jobs", status: "loading" }], statuses: { 1: { success: true, chromePageReady: false, hasLoginPrompt: true } } });
  let waited = false;
  harness.context.waitForSupportedTab = async () => { waited = true; harness.tabList[0].status = "complete"; };
  const status = await harness.context.queryZhilianPageStatus({ type: "ZHILIAN_PAGE_STATUS", openIfMissing: true }, 20);
  assert.equal(waited, true);
  assert.equal(status.hasLoginPrompt, true);
  assert.equal(status.chromePageReady, false);
  assert.equal(harness.tabList.length, 1);
  assert.equal(harness.tabUpdates.length, 0);
});

test("auto-opened Zhilian page retains security checks and returns creation failures", async () => {
  const harness = loadBackground({ tabs: [], statuses: { 1: { success: true, chromePageReady: false, hasSecurityPrompt: true } } });
  const message = { type: "ZHILIAN_PAGE_STATUS", openIfMissing: true };
  assert.equal((await harness.context.queryZhilianPageStatus(message, 20)).hasSecurityPrompt, true);
  const failed = loadBackground({ tabs: [] });
  failed.context.chrome.tabs.create = async () => { throw new Error("cannot create tab"); };
  const status = await failed.context.queryZhilianPageStatus(message, 20);
  assert.equal(status.success, false);
  assert.match(status.message, /cannot create tab/);
});


test("rejects job navigation originating from a chat tab", async () => {
  const { context, tabUpdates }=loadBackground({tabs:[{id:7,url:"https://www.zhipin.com/web/geek/chat",status:"complete"}]});
  const result=await context.handleBossContentNavigation({url:"https://www.zhipin.com/web/geek/job"},{tab:{id:7,url:"https://www.zhipin.com/web/geek/chat"}});
  assert.equal(result.success,false);
  assert.equal(result.errorCode,"HR_CHAT_PROTECTED");
  assert.equal(tabUpdates.length,0);
});

test("autopilot tick serializes simultaneous alarms and scans before sending", async () => {
  const { context }=loadBackground({tabs:[],fetchImpl:async()=>jsonResponse({success:true,data:{enabled:true,paused:false}})});
  await context.writeBossHrWatch({watching:true,tabId:7,watchSessionId:"watch",profileId:1,managed:true});
  const order=[];let release;
  const pending=new Promise(resolve=>{release=resolve;});
  context.runBossHrScan=async()=>{order.push("scan");await pending;order.push("scan-complete");};
  context.pollBossHrSendCommand=async()=>{order.push("send");};
  const first=context.runBossHrTick();const second=context.runBossHrTick();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(order,["scan"]);
  release();await Promise.all([first,second]);
  assert.deepEqual(order,["scan","scan-complete","send"]);
});

test("QQ pause prevents both scanning and queued sends", async () => {
  const { context }=loadBackground({tabs:[],fetchImpl:async()=>jsonResponse({success:true,data:{enabled:true,paused:true}})});
  await context.writeBossHrWatch({watching:true,tabId:7,watchSessionId:"watch",profileId:1,managed:true});
  let actions=0;context.runBossHrScan=async()=>{actions++;};context.pollBossHrSendCommand=async()=>{actions++;};
  await context.runBossHrTick();assert.equal(actions,0);
});


test("failed policy read after start stops backend watch instead of downgrading to unmanaged", async () => {
  const requests=[];
  const {dispatchRuntimeMessage,alarmCreates}=loadBackground({
    tabs:[{id:7,windowId:3,url:"https://www.zhipin.com/web/geek/chat",status:"complete"}],
    fetchImpl:async(url)=>{
      requests.push(url);
      if(url.endsWith("/api/local-auth/action-token")) return jsonResponse({success:true,data:{token:"test-action-token"}});
      if(url.endsWith("/api/hr-assistant/watch/start")) return jsonResponse({success:true,data:{watching:true,watchSessionId:"watch-1",profileId:1}});
      if(url.endsWith("/api/hr-assistant/autopilot")) return jsonResponse({success:false,message:"unavailable"});
      if(url.endsWith("/api/hr-assistant/watch/stop")) return jsonResponse({success:true,data:{watching:false}});
      throw new Error(`unexpected URL: ${url}`);
    }
  });
  const response=await dispatchRuntimeMessage({source:"GET_JOBS_BOSS_CONTENT",type:"BOSS_LOCAL_API",operation:"hr-start",body:{expectedProfileId:1}},
    {tab:{id:7,windowId:3,url:"https://www.zhipin.com/web/geek/chat"}});
  assert.equal(response.success,false);
  assert.equal(response.errorCode,"HR_POLICY_UNAVAILABLE");
  assert.equal(alarmCreates.length,0);
  assert.ok(requests.some(url=>url.endsWith("/api/hr-assistant/watch/stop")));
});
