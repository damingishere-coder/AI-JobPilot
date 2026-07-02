(function (root) {
  if (root.GetJobsBossScanSupport) return;

  const DEFAULT_TASK_TTL_MS = 24 * 60 * 60 * 1000;

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
    DEFAULT_TASK_TTL_MS,
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
