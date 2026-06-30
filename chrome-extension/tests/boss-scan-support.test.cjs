const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadSupport() {
  const window = {};
  const context = vm.createContext({ window, globalThis: window });
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
