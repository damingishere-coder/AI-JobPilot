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

  function isFreshTask(task, now = Date.now(), ttlMs = DEFAULT_TASK_TTL_MS) {
    if (!task || task.type !== "BOSS_SCAN_START" || !task.runId) return false;
    if (task.completed || ["complete", "stopped", "error"].includes(String(task.phase || ""))) return false;
    const lastActiveAt = Number(task.updatedAt || task.startedAt || 0);
    return Boolean(lastActiveAt && Number(now) - lastActiveAt <= Number(ttlMs));
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
    normalizeBatchIndex,
    classifyLocalApiFailure
  });
})(typeof window !== "undefined" ? window : globalThis);
