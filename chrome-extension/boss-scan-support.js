(function (root) {
  const SUPPORT_VERSION = "2026-07-18-boss-security-resume-fix";
  if (root.GetJobsBossScanSupport?.version === SUPPORT_VERSION) return;

  const DEFAULT_TASK_TTL_MS = 24 * 60 * 60 * 1000;
  const DEGREE_NAME_BY_CODE = Object.freeze({
    "0": "不限",
    "209": "初中及以下",
    "208": "中专/中技",
    "206": "高中",
    "202": "大专",
    "203": "本科",
    "204": "硕士",
    "205": "博士"
  });

  function degreeNameForCode(value) {
    return DEGREE_NAME_BY_CODE[String(value ?? "").trim()] || "";
  }

  function isBossSecurityInstructionText(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return false;
    return /请(?:先|立即|在.{0,8})?(?:完成|进行|通过).{0,8}(?:安全|身份|行为|人机)?验证|请.{0,8}(?:拖动|按住).{0,8}滑块|拖动.{0,8}滑块.{0,8}(?:完成|通过)验证|请输入.{0,8}验证码|验证码(?:已失效|错误|不正确)|访问(?:过于频繁|异常).{0,12}(?:验证|稍后)|complete.{0,16}(?:security )?(?:verification|captcha)|verify you are human/i.test(text);
  }

  function isBossSecurityPage({ url = "", title = "", text = "", hasChallengeUi = false, hasNormalContent = false } = {}) {
    if (hasChallengeUi) return true;
    if (/verify-slider|\/(?:web\/)?user\/safe\/verify(?:\/|$)|\/(?:captcha|security[-_]?check|challenge)(?:\/|$|[?#])/i.test(String(url || ""))) {
      return true;
    }
    if (/^(?:安全验证|访问异常|异常访问|身份验证|行为验证|验证码|请完成验证)(?:\s*[-_|·].*)?$/i.test(String(title || "").trim())) {
      return true;
    }
    return !hasNormalContent && isBossSecurityInstructionText(text);
  }

  function prepareTaskForResume(task) {
    if (!task || typeof task !== "object") return task;
    const resumed = { ...task };
    delete resumed.blockedAt;
    delete resumed.blockState;
    delete resumed.pausedAt;
    delete resumed.lastError;
    return resumed;
  }

  function mergeScanStatus(previous, nextStatus, now = Date.now()) {
    const next = {
      ...(previous || {}),
      ...(nextStatus || {}),
      updatedAt: Number(now)
    };
    const stage = String(next.stage || "");
    if (next.isRunning === true) {
      next.paused = false;
      next.resumable = true;
      next.diagnosticType = "";
    } else if (["complete", "stopped", "error", "idle"].includes(stage)) {
      next.paused = false;
      next.resumable = false;
      next.diagnosticType = "";
    }
    return next;
  }

  const NON_JOB_NAVIGATION_TITLES = /^(职位搜索|搜索职位|岗位搜索|搜索岗位|职位|岗位|工作搜索|公司搜索|搜索公司|全部职位|全部岗位|返回列表)$/;

  function isFreshTask(task, now = Date.now(), ttlMs = DEFAULT_TASK_TTL_MS) {
    if (!task || task.type !== "BOSS_SCAN_START" || !task.runId) return false;
    if (task.completed || ["complete", "stopped", "error"].includes(String(task.phase || ""))) return false;
    const lastActiveAt = Number(task.updatedAt || task.startedAt || 0);
    return Boolean(lastActiveAt && Number(now) - lastActiveAt <= Number(ttlMs));
  }

  function sameScanRun(left, right) {
    const leftRunId = normalizeRunId(left?.runId);
    const rightRunId = normalizeRunId(right?.runId);
    return Boolean(leftRunId && rightRunId && leftRunId === rightRunId);
  }

  function canResumeScanTask(existingTask, incomingTask, status = {}, options = {}) {
    if (options.configChanged) return false;
    if (!sameScanRun(existingTask, incomingTask)) return false;
    if (!isFreshTask(existingTask, options.now || Date.now(), options.ttlMs || DEFAULT_TASK_TTL_MS)) return false;
    if (options.resumable === false && !status?.resumable && status?.stage !== "blocked") return false;
    return true;
  }

  function normalizeRunId(value) {
    return String(value || "").trim();
  }

  function normalizeBossJobUrl(value, baseUrl = "https://www.zhipin.com") {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const match = raw.match(/https?:\/\/[^\s"'<>]*job_detail[^\s"'<>]*/i)
      || raw.match(/\/[^\s"'<>]*job_detail[^\s"'<>]*/i);
    const candidate = match ? match[0] : raw;
    if (!/job_detail/i.test(candidate)) return "";
    try {
      const parsed = new URL(candidate, baseUrl);
      parsed.hash = "";
      if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("zhipin.com")) return "";
      if (!parsed.pathname.includes("/job_detail/")) return "";
      return parsed.href;
    } catch {
      return "";
    }
  }

  function extractBossJobId(url, baseUrl = "https://www.zhipin.com") {
    const normalized = normalizeBossJobUrl(url, baseUrl);
    if (!normalized) return "";
    try {
      const parsed = new URL(normalized, baseUrl);
      const match = parsed.pathname.match(/\/job_detail\/([^/?#]+?)(?:\.html)?$/i);
      const id = match?.[1] || parsed.searchParams.get("jobId") || parsed.searchParams.get("encryptId") || parsed.searchParams.get("securityId") || "";
      return compact(String(id).replace(/\.html$/i, ""));
    } catch {
      return "";
    }
  }

  function isBossJobDetailUrl(url, baseUrl = "https://www.zhipin.com") {
    return Boolean(extractBossJobId(url, baseUrl));
  }

  function sameBossJobUrl(left, right, baseUrl = "https://www.zhipin.com") {
    const leftId = extractBossJobId(left, baseUrl);
    const rightId = extractBossJobId(right, baseUrl);
    return Boolean(leftId && rightId && leftId === rightId);
  }

  function isNonJobNavigationTitle(value) {
    const title = compact(value);
    return Boolean(title && NON_JOB_NAVIGATION_TITLES.test(title));
  }

  function classifyBossDetailNavigation(input = {}, baseUrl = "https://www.zhipin.com") {
    const targetUrl = normalizeBossJobUrl(input.targetUrl, baseUrl);
    const currentUrl = String(input.currentUrl || "");
    const afterUrl = String(input.afterUrl || currentUrl || "");
    if (!targetUrl || !isBossJobDetailUrl(targetUrl, baseUrl)) {
      return { status: "blocked", targetUrl, message: `岗位详情链接无效或不是Boss岗位页：${input.targetUrl || "空"}` };
    }
    if (currentUrl && sameBossJobUrl(currentUrl, targetUrl, baseUrl)) {
      return { status: "same", targetUrl };
    }
    if (input.backgroundSuccess === false) {
      return { status: "blocked", targetUrl, message: input.message || "后台未返回成功状态" };
    }
    if (afterUrl && afterUrl !== currentUrl) {
      return { status: "pending", targetUrl };
    }
    return { status: "blocked", targetUrl, message: "已请求后台跳转，但页面URL未变化" };
  }

  function normalizeBatchIndex(value, batchTotal) {
    const total = Math.max(0, Math.floor(Number(batchTotal) || 0));
    const parsed = Math.max(0, Math.floor(Number(value) || 0));
    return Math.min(parsed, total);
  }

  function classifyLocalApiFailure(error) {
    const explicit = String(error?.code || "");
    if (explicit) return explicit;
    const text = String(error?.message || error || "");
    if (/Invalid CORS request|cors/i.test(text)) return "CORS_REJECTED";
    if (/超时|timeout|abort/i.test(text)) return "LOCAL_API_TIMEOUT";
    if (/无法连接|Failed to fetch|NetworkError|本地服务请求失败|6866端口/i.test(text)) {
      return "LOCAL_SERVICE_UNAVAILABLE";
    }
    return "LOCAL_API_ERROR";
  }

  function compact(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  root.GetJobsBossScanSupport = Object.freeze({
    version: SUPPORT_VERSION,
    DEFAULT_TASK_TTL_MS,
    DEGREE_NAME_BY_CODE,
    degreeNameForCode,
    isBossSecurityInstructionText,
    isBossSecurityPage,
    prepareTaskForResume,
    mergeScanStatus,
    isFreshTask,
    sameScanRun,
    canResumeScanTask,
    normalizeBossJobUrl,
    extractBossJobId,
    isBossJobDetailUrl,
    sameBossJobUrl,
    isNonJobNavigationTitle,
    classifyBossDetailNavigation,
    normalizeBatchIndex,
    classifyLocalApiFailure
  });
})(typeof window !== "undefined" ? window : globalThis);
