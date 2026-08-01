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

function loadBackground({
  tabs,
  statuses = {},
  contentReady = true,
  bossContentVersion = BOSS_CONTENT_VERSION,
  zhilianContentVersion = ZHILIAN_CONTENT_VERSION,
  fetchImpl = async () => {
    throw new Error("fetch should not be called");
  }
}) {
  const storage = {};
  const sentMessages = [];
  const executedScripts = [];
  const tabList = tabs.map((tab) => ({ ...tab }));
  let currentContentReady = contentReady;
  let currentBossContentVersion = bossContentVersion;
  let currentZhilianContentVersion = zhilianContentVersion;
  let runtimeMessageListener = null;
  const chrome = {
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
        if (message.type === "BOSS_SCAN_STATUS" || message.type === "ZHILIAN_SCAN_STATUS_V2") {
          return statuses[tabId] || { success: true, isRunning: false, hasStoredTask: false, stage: "idle" };
        }
        return { success: true };
      }
    },
    windows: {
      async update() {}
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
          currentBossContentVersion = BOSS_CONTENT_VERSION;
        }
        if (options.files.includes("zhilian-content.js")) {
          currentZhilianContentVersion = ZHILIAN_CONTENT_VERSION;
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
    chrome,
    console,
    URL,
    URLSearchParams,
    AbortController,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout
  });
  const source = fs.readFileSync(path.join(EXTENSION_DIR, "background.js"), "utf8");
  vm.runInContext(source, context, { filename: "background.js" });
  async function dispatchRuntimeMessage(message, sender) {
    return await new Promise((resolve) => {
      const keepChannelOpen = runtimeMessageListener(message, sender, resolve);
      if (keepChannelOpen !== true) setImmediate(() => resolve(undefined));
    });
  }
  return { context, storage, sentMessages, executedScripts, runtimeMessageListener, tabList, dispatchRuntimeMessage };
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
    config: { keywords: "[]" }
  }, { tab: { id: 20, url: "http://localhost:6866/zhilian" } });

  assert.equal(response.success, false);
  assert.equal(response.message, "请至少填写一个搜索关键词");
});

test("injects all Zhilian dependencies when the content script is missing", async () => {
  const { context, executedScripts } = loadBackground({
    tabs: [{ id: 1, windowId: 1, url: "https://www.zhaopin.com/", status: "complete" }],
    contentReady: false
  });

  await context.ensureContentScript(1, "zhilian-content.js");

  assert.equal(executedScripts.length, 1);
  assert.deepEqual(Array.from(executedScripts[0].files), [
    "zhilian-scan-support.js",
    "zhilian-content.js"
  ]);
});

test("reinjects all Zhilian dependencies when the content script is stale", async () => {
  const { context, executedScripts } = loadBackground({
    tabs: [{ id: 1, windowId: 1, url: "https://www.zhaopin.com/", status: "complete" }],
    zhilianContentVersion: "2026-06-25-scan-resume-redirect-2"
  });

  await context.ensureContentScript(1, "zhilian-content.js");

  assert.equal(executedScripts.length, 1);
  assert.deepEqual(Array.from(executedScripts[0].files), [
    "zhilian-scan-support.js",
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
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ success: true, saved: 1 }); }
      };
    }
  });

  const response = await dispatchRuntimeMessage(runtimeMessageListener, {
    source: "GET_JOBS_ZHILIAN_CONTENT",
    type: "ZHILIAN_LOCAL_API",
    operation: "chrome-jobs",
    body: { runId: "run-1", keyword: "Java", jobs: [{ title: "Java工程师" }] }
  }, {
    tab: { id: 8, url: "https://www.zhaopin.com/jobdetail/demo.htm" }
  });

  assert.equal(response.success, true);
  assert.equal(response.data.saved, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://localhost:6866/api/zhilian/chrome/jobs");
  assert.equal(requests[0].options.method, "POST");
});

test("allows numeric Zhilian delivery result IDs and rejects invalid or unknown routes", async () => {
  const urls = [];
  const { runtimeMessageListener } = loadBackground({
    tabs: [],
    fetchImpl: async (url) => {
      urls.push(url);
      return { ok: true, status: 200, async text() { return '{"success":true}'; } };
    }
  });
  const sender = { tab: { id: 9, url: "https://www.zhaopin.com/jobdetail/demo.htm" } };

  const allowed = await dispatchRuntimeMessage(runtimeMessageListener, {
    source: "GET_JOBS_ZHILIAN_CONTENT",
    type: "ZHILIAN_LOCAL_API",
    operation: "delivery-result",
    params: { id: 123 },
    body: { success: true }
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
  assert.equal(urls[0], "http://localhost:6866/api/zhilian/jobs/123/delivery-result");
  assert.equal(invalidId.success, false);
  assert.match(invalidId.message, /有效岗位ID/);
  assert.equal(unknown.success, false);
  assert.match(unknown.message, /不被允许/);
  assert.equal(urls.length, 1);
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
    context.registerScanSession("boss", 1, "boss-run", 10),
    context.registerScanSession("zhilian", 2, "zhilian-run", 10)
  ]);

  const sessions = storage.__GET_JOBS_PLATFORM_SCAN_SESSIONS__;
  assert.equal(sessions.boss.tabId, 1);
  assert.equal(sessions.zhilian.tabId, 2);
});

test("uses a separate Boss tab for delivery while scanning", async () => {
  const { context } = loadBackground({
    tabs: [
      { id: 1, windowId: 1, url: "https://www.zhipin.com/web/geek/job", status: "complete", lastAccessed: 10 },
      { id: 2, windowId: 1, url: "https://www.zhipin.com/", status: "complete", lastAccessed: 20 }
    ],
    statuses: {
      1: { success: true, isRunning: true, hasStoredTask: true, stage: "details", runId: "boss-run" },
      2: { success: true, isRunning: false, hasStoredTask: false, stage: "idle" }
    }
  });
  await context.registerScanSession("boss", 1, "boss-run", 10);

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
  await context.registerScanSession("boss", 1, "boss-run", 10);

  const scanTab = await context.findRegisteredOrRunningScanTab("boss");
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
      1: { success: true, isRunning: true, hasStoredTask: true, stage: "details", runId: "boss-old-run" },
      2: { success: true, isRunning: false, hasStoredTask: false, stage: "idle" }
    }
  });
  await context.registerScanSession("boss", 1, "boss-old-run", 10);
  storage.__GET_JOBS_BOSS_SHARED_SCAN_TASK__ = { runId: "boss-old-run" };

  const scanTab = await context.findScanPlatformTab(
    "boss",
    "https://www.zhipin.com/web/geek/job?city=101280600&query=Java",
    "boss-new-run"
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

  assert.equal(detailResponse.success, true);
  assert.equal(tabList[0].url, "https://www.zhipin.com/job_detail/demo.html");
  assert.equal(externalResponse.success, false);
});

test("Boss stop clears registered scan session and shared checkpoint", async () => {
  const { context, storage } = loadBackground({
    tabs: [
      { id: 1, windowId: 1, url: "https://www.zhipin.com/job_detail/old.html", status: "complete" }
    ]
  });
  await context.registerScanSession("boss", 1, "boss-run", 10);
  storage.__GET_JOBS_BOSS_SHARED_SCAN_TASK__ = { runId: "boss-run" };
  storage.__GET_JOBS_BOSS_SHARED_SCAN_CANCEL__ = { runId: "boss-run", requested: true };

  const response = await context.sendPassiveStop(1, "boss", { type: "BOSS_SCAN_STOP", runId: "boss-run" }, 10);

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
  await context.registerScanSession("boss", 1, "boss-run", 10);

  const status = await context.buildRegisteredNavigationStatus("boss", 1);

  assert.equal(status.isRunning, true);
  assert.equal(status.hasStoredTask, true);
  assert.equal(status.stage, "navigating");
  assert.equal(status.runId, "boss-run");
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
