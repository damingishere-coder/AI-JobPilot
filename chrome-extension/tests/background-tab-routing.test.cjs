const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadBackground({ tabs, statuses = {} }) {
  const storage = {};
  const sentMessages = [];
  const tabList = tabs.map((tab) => ({ ...tab }));
  const chrome = {
    runtime: {
      onMessage: { addListener() {} },
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
        if (message.type === "PING_CONTENT") return { success: true };
        if (message.type === "GET_BOSS_CONTENT_VERSION") {
          return { success: true, version: "2026-06-25-scan-resume-redirect-2" };
        }
        if (message.type === "GET_ZHILIAN_CONTENT_VERSION") {
          return { success: true, version: "2026-06-25-scan-resume-redirect-2" };
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
      async executeScript() {}
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
          delete storage[key];
        }
      }
    }
  };

  const context = vm.createContext({
    chrome,
    console,
    URL,
    AbortController,
    fetch: async () => {
      throw new Error("fetch should not be called");
    },
    setTimeout,
    clearTimeout
  });
  const source = fs.readFileSync(path.resolve(__dirname, "..", "background.js"), "utf8");
  vm.runInContext(source, context, { filename: "background.js" });
  return { context, storage, sentMessages };
}

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
