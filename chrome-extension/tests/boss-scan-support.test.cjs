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

test("uses the current Boss degree codes", () => {
  const support = loadSupport();

  assert.deepEqual(JSON.parse(JSON.stringify(support.DEGREE_NAME_BY_CODE)), {
    "0": "不限",
    "209": "初中及以下",
    "208": "中专/中技",
    "206": "高中",
    "202": "大专",
    "203": "本科",
    "204": "硕士",
    "205": "博士"
  });
  assert.equal(support.degreeNameForCode("203"), "本科");
  assert.equal(support.degreeNameForCode(205), "博士");
  assert.equal(support.degreeNameForCode("207"), "");
});

test("does not treat security-related words in a normal job description as a Boss challenge", () => {
  const support = loadSupport();

  assert.equal(support.isBossSecurityPage({
    url: "https://www.zhipin.com/job_detail/example.html",
    title: "AI Coding 应用研发工程师_BOSS直聘",
    text: "编写高质量数据采集脚本，处理签名验证、滑块/九宫格验证码、风控指纹等工程问题",
    hasNormalContent: true,
    hasChallengeUi: false
  }), false);
  assert.equal(support.isBossSecurityPage({
    url: "https://www.zhipin.com/job_detail/example.html",
    title: "Captcha verification engineer_BOSS直聘",
    text: "负责 verify、captcha 和安全验证相关系统研发",
    hasNormalContent: true,
    hasChallengeUi: false
  }), false);
});

test("recognizes real Boss security pages and visible challenge controls", () => {
  const support = loadSupport();

  assert.equal(support.isBossSecurityPage({
    url: "https://www.zhipin.com/web/user/safe/verify-slider",
    hasNormalContent: false
  }), true);
  assert.equal(support.isBossSecurityPage({
    url: "https://www.zhipin.com/web/geek/jobs",
    text: "请按住滑块，拖动到最右边完成验证",
    hasNormalContent: false
  }), true);
  assert.equal(support.isBossSecurityPage({
    url: "https://www.zhipin.com/job_detail/example.html",
    hasNormalContent: true,
    hasChallengeUi: true
  }), true);
});

test("clears the blocked checkpoint and stale paused status when continuing a scan", () => {
  const support = loadSupport();
  const task = support.prepareTaskForResume({
    type: "BOSS_SCAN_START",
    runId: "boss-resume-1",
    phase: "detail",
    detailIndex: 4,
    blockedAt: 123,
    blockState: "安全验证",
    pausedAt: 124,
    lastError: { type: "SECURITY_VERIFICATION" }
  });
  const resumedStatus = support.mergeScanStatus({
    isRunning: false,
    stage: "blocked",
    paused: true,
    resumable: true,
    diagnosticType: "SECURITY_VERIFICATION"
  }, {
    isRunning: true,
    stage: "resume"
  }, 456);
  const completedStatus = support.mergeScanStatus(resumedStatus, {
    isRunning: false,
    stage: "complete"
  }, 789);

  assert.equal(task.detailIndex, 4);
  assert.equal("blockedAt" in task, false);
  assert.equal("blockState" in task, false);
  assert.equal("pausedAt" in task, false);
  assert.equal("lastError" in task, false);
  assert.equal(resumedStatus.paused, false);
  assert.equal(resumedStatus.resumable, true);
  assert.equal(resumedStatus.diagnosticType, "");
  assert.equal(completedStatus.paused, false);
  assert.equal(completedStatus.resumable, false);
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
