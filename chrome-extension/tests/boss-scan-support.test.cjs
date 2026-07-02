const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadSupport() {
  const window = {};
  const context = vm.createContext({ window, globalThis: window, URL });
  const source = fs.readFileSync(path.resolve(__dirname, "..", "boss-scan-support.js"), "utf8");
  vm.runInContext(source, context, { filename: "boss-scan-support.js" });
  return window.GetJobsBossScanSupport;
}

test("keeps an unfinished Boss checkpoint for 24 hours", () => {
  const support = loadSupport();
  const now = Date.now();
  const task = {
    type: "BOSS_SCAN_START",
    runId: "boss-run-1",
    phase: "submitting",
    updatedAt: now - (23 * 60 * 60 * 1000)
  };

  assert.equal(support.isFreshTask(task, now), true);
  assert.equal(
    support.isFreshTask({ ...task, updatedAt: now - (25 * 60 * 60 * 1000) }, now),
    false
  );
});

test("keeps a fresh detail checkpoint even when the page was redirected", () => {
  const support = loadSupport();
  const now = Date.now();
  const task = {
    type: "BOSS_SCAN_START",
    runId: "boss-run-redirect",
    phase: "detail",
    detailIndex: 3,
    updatedAt: now - 2000
  };

  assert.equal(support.isFreshTask(task, now), true);
});

test("does not resume a Boss detail checkpoint for a new scan run", () => {
  const support = loadSupport();
  const now = Date.now();
  const existingTask = {
    type: "BOSS_SCAN_START",
    runId: "boss-old-run",
    phase: "detail",
    jobs: [{ title: "医学总监", url: "https://www.zhipin.com/job_detail/old.html" }],
    updatedAt: now - 1000
  };
  const incomingTask = {
    type: "BOSS_SCAN_START",
    runId: "boss-new-run",
    keywords: ["Java"]
  };

  assert.equal(support.sameScanRun(existingTask, incomingTask), false);
  assert.equal(
    support.canResumeScanTask(existingTask, incomingTask, { resumable: true }, { now, resumable: true }),
    false
  );
});

test("allows a fresh Boss checkpoint to resume for the same scan run", () => {
  const support = loadSupport();
  const now = Date.now();
  const existingTask = {
    type: "BOSS_SCAN_START",
    runId: "boss-same-run",
    phase: "detail",
    updatedAt: now - 1000
  };
  const incomingTask = {
    type: "BOSS_SCAN_START",
    runId: "boss-same-run",
    keywords: ["Java"]
  };

  assert.equal(support.sameScanRun(existingTask, incomingTask), true);
  assert.equal(
    support.canResumeScanTask(existingTask, incomingTask, { resumable: true }, { now, resumable: true }),
    true
  );
});

test("rejects Boss navigation titles and non-job detail URLs", () => {
  const support = loadSupport();

  assert.equal(support.isNonJobNavigationTitle("职位搜索"), true);
  assert.equal(support.isNonJobNavigationTitle("销售赋能运营"), false);
  assert.equal(support.isBossJobDetailUrl("https://www.zhipin.com/job_detail/demo.html"), true);
  assert.equal(support.isBossJobDetailUrl("https://www.zhipin.com/web/geek/job?query=Java"), false);
  assert.equal(support.isBossJobDetailUrl("https://example.com/job_detail/demo.html"), false);
});

test("classifies unchanged Boss detail navigation as blocked", () => {
  const support = loadSupport();
  const currentUrl = "https://www.zhipin.com/web/geek/job?city=101280600&query=Java";
  const targetUrl = "https://www.zhipin.com/job_detail/demo.html";
  const blocked = support.classifyBossDetailNavigation({ currentUrl, targetUrl, afterUrl: currentUrl, backgroundSuccess: true });

  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.targetUrl, targetUrl);
  assert.equal(blocked.message, "已请求后台跳转，但页面URL未变化");
  assert.equal(
    support.classifyBossDetailNavigation({
      currentUrl,
      targetUrl,
      afterUrl: "https://www.zhipin.com/job_detail/demo.html",
      backgroundSuccess: true
    }).status,
    "pending"
  );
  assert.equal(
    support.classifyBossDetailNavigation({
      currentUrl: targetUrl,
      targetUrl,
      afterUrl: targetUrl,
      backgroundSuccess: true
    }).status,
    "same"
  );
});

test("resumes from the stored failed batch without exceeding batch count", () => {
  const support = loadSupport();

  assert.equal(support.normalizeBatchIndex(1, 2), 1);
  assert.equal(support.normalizeBatchIndex(99, 2), 2);
  assert.equal(support.normalizeBatchIndex(-1, 2), 0);
});

test("classifies CORS and local service failures for actionable diagnostics", () => {
  const support = loadSupport();

  assert.equal(
    support.classifyLocalApiFailure(new Error("Invalid CORS request")),
    "CORS_REJECTED"
  );
  assert.equal(
    support.classifyLocalApiFailure(new Error("无法连接本地服务，请确认6866端口正常")),
    "LOCAL_SERVICE_UNAVAILABLE"
  );
});
