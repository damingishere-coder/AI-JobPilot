const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadSupport(existingSupport) {
  const window = existingSupport ? { GetJobsZhilianScanSupport: existingSupport } : {};
  const context = vm.createContext({ window, globalThis: window, URL, URLSearchParams });
  const source = fs.readFileSync(path.resolve(__dirname, "..", "zhilian-scan-support.js"), "utf8");
  vm.runInContext(source, context, { filename: "zhilian-scan-support.js" });
  return window.GetJobsZhilianScanSupport;
}

test("replaces a stale Zhilian support module after extension reload", () => {
  const staleSupport = Object.freeze({ version: "2026-07-03-official-search-params" });
  const support = loadSupport(staleSupport);

  assert.notEqual(support, staleSupport);
  assert.equal(support.version, "2026-07-29-zhilian-security-resume-fix");
  assert.equal(typeof support.isZhilianUrl, "function");
});

test("does not treat normal Zhilian job descriptions as security verification", () => {
  const support = loadSupport();
  const realFalsePositive = {
    url: "https://www.zhaopin.com/jobdetail/CC193399810J40866382707.htm",
    title: "技术运营招聘_东华软件招聘 - 智联招聘",
    text: "负责处理操作系统、应用软件安装调试、权限访问异常等问题。",
    hasNormalContent: true,
    hasChallengeUi: false
  };

  assert.equal(support.zhilianSecurityReason(realFalsePositive), "");
  assert.equal(support.isZhilianSecurityPage(realFalsePositive), false);
  assert.equal(support.isZhilianSecurityPage({
    ...realFalsePositive,
    text: "负责安全验证、verify 与 captcha 相关系统的产品研发"
  }), false);
});

test("recognizes dedicated Zhilian verification signals", () => {
  const support = loadSupport();

  assert.equal(support.zhilianSecurityReason({
    url: "https://www.zhaopin.com/safe-verify/?from=job",
    hasNormalContent: false
  }), "verification-url");
  assert.equal(support.zhilianSecurityReason({
    url: "https://www.zhaopin.com/jobdetail/demo.htm",
    title: "安全验证 - 智联招聘",
    hasNormalContent: false
  }), "verification-title");
  assert.equal(support.zhilianSecurityReason({
    url: "https://www.zhaopin.com/jobdetail/demo.htm",
    text: "请拖动滑块完成验证",
    hasNormalContent: false
  }), "instruction-text");
  assert.equal(support.zhilianSecurityReason({
    url: "https://www.zhaopin.com/jobdetail/demo.htm",
    text: "岗位详情正常展示",
    hasNormalContent: true,
    hasChallengeUi: true
  }), "challenge-ui");
});

test("clears stale blocking markers when resuming and resets paused status", () => {
  const support = loadSupport();
  const resumedTask = support.prepareTaskForResume({
    runId: "zhilian-1",
    phase: "detail",
    detailIndex: 7,
    blockedAt: 100,
    blockState: "安全验证",
    pausedAt: 101,
    lastError: { type: "SECURITY_VERIFICATION" }
  });

  assert.equal(resumedTask.detailIndex, 7);
  assert.equal("blockedAt" in resumedTask, false);
  assert.equal("blockState" in resumedTask, false);
  assert.equal("pausedAt" in resumedTask, false);
  assert.equal("lastError" in resumedTask, false);

  const running = support.mergeScanStatus({
    stage: "blocked",
    paused: true,
    resumable: true,
    diagnosticType: "SECURITY_VERIFICATION"
  }, {
    stage: "resume",
    isRunning: true
  }, 200);
  assert.equal(running.paused, false);
  assert.equal(running.resumable, true);
  assert.equal(running.diagnosticType, "");
  assert.equal(running.updatedAt, 200);

  const complete = support.mergeScanStatus(running, {
    stage: "complete",
    isRunning: false
  }, 300);
  assert.equal(complete.paused, false);
  assert.equal(complete.resumable, false);
});

test("normalizes empty, delimited, JSON and duplicate Zhilian keywords", () => {
  const support = loadSupport();

  assert.deepEqual(Array.from(support.normalizeKeywordList("[]")), []);
  assert.deepEqual(Array.from(support.normalizeKeywordList("  \n\t  ")), []);
  assert.deepEqual(Array.from(support.normalizeKeywordList("Java， 后端, Spring\nAI 产品")), ["Java", "后端", "Spring", "AI 产品"]);
  assert.deepEqual(Array.from(support.normalizeKeywordList('["Java", " 后端 ", "Java"]')), ["Java", "后端"]);
  assert.deepEqual(Array.from(support.normalizeKeywordList(["Java", "java", "后端"])), ["Java", "后端"]);
});

test("recognizes supported Zhilian pages without trusting lookalike hosts", () => {
  const support = loadSupport();

  assert.equal(support.isZhilianUrl("https://www.zhaopin.com/"), true);
  assert.equal(support.isZhilianUrl("https://sou.zhaopin.com/"), true);
  assert.equal(support.isZhilianSearchUrl("https://www.zhaopin.com/sou/jl489/kwtoken/p1"), true);
  assert.equal(support.isZhilianSearchUrl("https://www.zhaopin.com/jobdetail/demo.htm"), false);
  assert.equal(support.isZhilianUrl("https://zhaopin.com.example.com/sou/"), false);
  assert.equal(support.isZhilianUrl("http://www.zhaopin.com/sou/"), false);
});

test("keeps the Zhilian resume URL guard and background search navigation wired", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "zhilian-content.js"), "utf8");

  assert.match(source, /function isZhilianUrl\(rawUrl\)/);
  assert.match(source, /!isFreshScanTask\(task\) \|\| !isZhilianUrl\(window\.location\.href\)/);
  assert.match(source, /requestBackgroundNavigation\(url, "search"\)/);
});

test("routes Zhilian local API calls through the extension background and keeps submit checkpoints", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "zhilian-content.js"), "utf8");

  assert.match(source, /type: "ZHILIAN_LOCAL_API"/);
  assert.doesNotMatch(source, /fetch\([^\n]*\/api\/zhilian\//);
  assert.match(source, /phase: "detail",\s+jobs,\s+detailIndex: jobs\.length,/);
  assert.match(source, /stage: "blocked"/);
  assert.match(source, /resumable: true/);
  assert.match(source, /if \(collectionResult\.paused\)/);
  assert.match(source, /await handleBlockingState/);
  assert.match(source, /hasNormalContent/);
  assert.match(source, /hasChallengeUi/);
  assert.match(source, /prepareTaskForResume\(storedTask\)/);
  assert.match(source, /return \{ success: false, totalSaved, paused: true, message: blockResult\.message \}/);
  assert.doesNotMatch(source, /if \(blockResult\) \{\s*stopRequested = true/);
  assert.match(source, /async function handleScanStopMessage[\s\S]*?clearStoredScanTask\(\)/);
});

test("builds a Zhilian search URL with official city and salary params", () => {
  const support = loadSupport();

  assert.equal(
    support.buildSearchUrl("Java", { cityCode: "765", salary: "10001,15000" }),
    "https://www.zhaopin.com/sou/jl765/?kw=Java&sl=10001%2C15000"
  );
});

test("omits sl when salary is unlimited", () => {
  const support = loadSupport();

  assert.equal(
    support.buildSearchUrl("Java", { cityCode: "765", salary: "0" }),
    "https://www.zhaopin.com/sou/jl765/?kw=Java"
  );
  assert.equal(
    support.buildSearchUrl("Java", { cityCode: "765", salary: "\u4e0d\u9650" }),
    "https://www.zhaopin.com/sou/jl765/?kw=Java"
  );
  assert.equal(
    support.buildSearchUrl("Java", { cityCode: "765", salary: "0000,9999999" }),
    "https://www.zhaopin.com/sou/jl765/?kw=Java"
  );
});

test("normalizes legacy custom salary and pagination", () => {
  const support = loadSupport();

  assert.equal(
    support.buildSearchUrl("Java", { cityCode: "jl765", salary: "12000,30000" }, 3),
    "https://www.zhaopin.com/sou/jl765/?kw=Java&p=3"
  );
  assert.equal(
    JSON.stringify(support.normalizedSearchParamsForCursor({ cityCode: "0", salary: "12000,30000" })),
    JSON.stringify({ cityCode: "489", salary: "0000,9999999" })
  );
});
