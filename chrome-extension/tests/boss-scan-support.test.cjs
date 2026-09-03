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

test("uses the agreed Boss deep collection safety bounds", () => {
  const support = loadSupport();
  assert.deepEqual(
    JSON.parse(JSON.stringify(support.deepCollectionBounds(40))),
    { target: 40, maxRounds: 30, maxCandidates: 500, maxDurationMs: 180000, maxStagnantRounds: 5 }
  );
  assert.equal(support.deepCollectionStopReason({ target: 40, fresh: 40 }), "target_reached");
  assert.equal(support.deepCollectionStopReason({ target: 40, fresh: 12, stagnantRounds: 4 }), "");
  assert.equal(support.deepCollectionStopReason({ target: 40, fresh: 12, stagnantRounds: 5 }), "stagnation_safety_cap");
  assert.equal(support.deepCollectionStopReason({ target: 40, fresh: 12, elapsedMs: 180000 }), "timeout_safety_cap");
  assert.equal(support.deepCollectionStopReason({ target: 40, fresh: 12, platformExhausted: true }), "platform_exhausted");
});

test("does not auto append AI keywords after a Boss scan", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "boss-content.js"), "utf8");
  assert.doesNotMatch(source, /await appendAiKeywords\(task, keywords\)/);
});

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
  assert.equal(support.isBossJobDetailUrl("https://sub.zhipin.com/job_detail/demo.html"), true);
  assert.equal(support.isBossJobDetailUrl("https://www.zhipin.com/web/geek/job?query=Java"), false);
  assert.equal(support.isBossJobDetailUrl("https://example.com/job_detail/demo.html"), false);
  assert.equal(support.isBossJobDetailUrl("https://evilzhipin.com/job_detail/demo.html"), false);
  assert.equal(support.isBossJobDetailUrl("https://zhipin.com.example.com/job_detail/demo.html"), false);
  assert.equal(support.isBossJobDetailUrl("http://www.zhipin.com/job_detail/demo.html"), false);
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
    support.classifyLocalApiFailure(new Error("无法连接本地服务，请确认8888端口正常")),
    "LOCAL_SERVICE_UNAVAILABLE"
  );
});

test("partitions all historical Boss jobs for reuse without detail collection", () => {
  const support = loadSupport();
  const jobs = [
    { id: "history-1", company: "甲公司", title: "产品经理", url: "https://www.zhipin.com/job_detail/history-1.html" },
    { id: "history-2", company: "乙公司", title: "运营经理", url: "https://www.zhipin.com/job_detail/history-2.html" },
  ];
  const partition = support.partitionDedupeJobs(jobs, jobs.map((job) => ({ ...job, duplicate: true, action: "SKIP" })));

  assert.equal(partition.detailJobs.length, 0);
  assert.equal(partition.historicalJobs.length, 2);
  assert.deepEqual(Array.from(partition.historicalJobs, (job) => job.collectionAction), ["REUSE_HISTORY", "REUSE_HISTORY"]);
});

test("keeps new and enrich jobs in details while marking only skips as historical", () => {
  const support = loadSupport();
  const jobs = [
    { id: "new-1", company: "甲公司", title: "新岗位", url: "https://www.zhipin.com/job_detail/new-1.html" },
    { id: "enrich-1", company: "乙公司", title: "补全岗位", url: "https://www.zhipin.com/job_detail/enrich-1.html" },
    { id: "history-1", company: "丙公司", title: "历史岗位", url: "https://www.zhipin.com/job_detail/history-1.html" },
  ];
  const partition = support.partitionDedupeJobs(jobs, [
    { ...jobs[0], action: "NEW" },
    { ...jobs[1], action: "ENRICH", duplicate: true },
    { ...jobs[2], action: "SKIP", duplicate: true },
  ]);

  assert.deepEqual(Array.from(partition.detailJobs, (job) => job.id), ["new-1", "enrich-1"]);
  assert.deepEqual(Array.from(partition.historicalJobs, (job) => job.id), ["history-1"]);
  assert.ok(partition.detailJobs.every((job) => job.collectionAction === "ANALYZE"));
});

test("rejects incomplete or invalid Boss dedupe decisions instead of treating them as new", () => {
  const support = loadSupport();
  const jobs = [
    { id: "job-1", company: "甲公司", title: "岗位一" },
    { id: "job-2", company: "乙公司", title: "岗位二" },
  ];

  assert.throws(
    () => support.partitionDedupeJobs(jobs, [{ ...jobs[0], action: "NEW" }]),
    /未完整返回/
  );
  assert.throws(
    () => support.partitionDedupeJobs(jobs, jobs.map((job) => ({ ...job, action: "UNKNOWN" }))),
    /未完整返回/
  );
});

test("keeps the failed Boss submit batch index and prior success summary for resume", () => {
  const support = loadSupport();
  const checkpoint = support.buildFailedSubmitCheckpoint(
    { type: "BOSS_SCAN_START", runId: "boss-submit-retry", jobs: [{ id: 1 }, { id: 2 }] },
    2,
    { received: 40, saved: 36, queued: 30 },
    { type: "LOCAL_SERVICE_UNAVAILABLE", message: "database is locked" },
    123456,
  );

  assert.equal(checkpoint.phase, "submitting");
  assert.equal(checkpoint.submitBatchIndex, 2);
  assert.equal(checkpoint.submitSummary.received, 40);
  assert.equal(checkpoint.submitSummary.saved, 36);
  assert.equal(checkpoint.submitSummary.queued, 30);
  assert.equal(checkpoint.lastSubmitError.failedAt, 123456);
  assert.equal(checkpoint.lastSubmitError.message, "database is locked");
});
