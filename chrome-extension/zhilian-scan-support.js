(function (root) {
  const SUPPORT_VERSION = "2026-07-29-zhilian-security-resume-fix";
  if (root.GetJobsZhilianScanSupport?.version === SUPPORT_VERSION) return;

  const DEFAULT_CITY_CODE = "489";
  const DEFAULT_SALARY_CODE = "0000,9999999";
  const OFFICIAL_SALARY_CODES = new Set([
    DEFAULT_SALARY_CODE,
    "0000,4000",
    "4001,6000",
    "6001,8000",
    "8001,10000",
    "10001,15000",
    "15001,25000",
    "25001,35000",
    "35001,50000",
    "50001,9999999"
  ]);

  function first(value, fallback = "") {
    if (Array.isArray(value)) {
      const found = value.map((item) => compact(item)).find(Boolean);
      return found || fallback;
    }
    const raw = compact(value);
    if (!raw) return fallback;
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return first(parsed, fallback);
      } catch {
        return raw.slice(1, -1).split(/[,，;；\n\r]+/).map((item) => compact(item)).find(Boolean) || fallback;
      }
    }
    return raw;
  }

  function compact(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeKeywordList(value) {
    const keywords = [];

    function append(rawValue) {
      if (Array.isArray(rawValue)) {
        rawValue.forEach(append);
        return;
      }

      const raw = String(rawValue ?? "").trim();
      if (!raw) return;
      if (raw.startsWith("[") && raw.endsWith("]")) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            parsed.forEach(append);
            return;
          }
        } catch {
          append(raw.slice(1, -1));
          return;
        }
      }

      raw.split(/[,，;；\n\r]+/).forEach((item) => {
        const keyword = compact(item).replace(/^["']|["']$/g, "").trim();
        if (!keyword) return;
        if (!keywords.some((existing) => existing.toLowerCase() === keyword.toLowerCase())) {
          keywords.push(keyword);
        }
      });
    }

    append(value);
    return keywords;
  }

  function normalizeZhilianCityCode(value) {
    const raw = first(value, DEFAULT_CITY_CODE);
    if (!raw || raw === "0" || raw === "不限") return DEFAULT_CITY_CODE;
    const withoutPrefix = raw.replace(/^jl/i, "");
    return /^\d+$/.test(withoutPrefix) ? withoutPrefix : DEFAULT_CITY_CODE;
  }

  function normalizeZhilianSalaryCode(value) {
    const raw = first(value, DEFAULT_SALARY_CODE);
    if (!raw || raw === "0" || raw === "不限") return DEFAULT_SALARY_CODE;
    return OFFICIAL_SALARY_CODES.has(raw) ? raw : DEFAULT_SALARY_CODE;
  }

  function isUnlimitedZhilianSalary(value) {
    return normalizeZhilianSalaryCode(value) === DEFAULT_SALARY_CODE;
  }

  function normalizedSearchParamsForCursor(config = {}) {
    return {
      cityCode: normalizeZhilianCityCode(config.cityCode || config.cityId || config.city),
      salary: normalizeZhilianSalaryCode(config.salary || config.salaryTypeCode || config.sl)
    };
  }

  function isZhilianUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      const host = parsed.hostname.toLowerCase();
      return parsed.protocol === "https:"
        && (host === "zhaopin.com" || host.endsWith(".zhaopin.com"));
    } catch {
      return false;
    }
  }

  function isZhilianSearchUrl(value) {
    if (!isZhilianUrl(value)) return false;
    try {
      return /^\/sou(?:\/|$)/i.test(new URL(String(value)).pathname);
    } catch {
      return false;
    }
  }

  function isZhilianSecurityInstructionText(value) {
    const text = compact(value);
    if (!text) return false;
    return /请(?:先|立即|在.{0,8})?(?:完成|进行|通过).{0,8}(?:安全|身份|行为|人机)?验证|请.{0,8}(?:拖动|按住).{0,8}滑块|拖动.{0,8}滑块.{0,8}(?:完成|通过)验证|请输入.{0,8}验证码|验证码(?:已失效|错误|不正确)|访问(?:过于频繁|异常).{0,12}(?:验证|稍后|重试)|complete.{0,16}(?:security )?(?:verification|captcha)|verify you are human/i.test(text);
  }

  function zhilianSecurityReason({ url = "", title = "", text = "", hasChallengeUi = false, hasNormalContent = false } = {}) {
    if (hasChallengeUi) return "challenge-ui";
    if (/\/(?:captcha|challenge|security[-_]?check|safe[-_]?verify|verify-slider|verify)(?:\/|$|[?#])/i.test(String(url || ""))) {
      return "verification-url";
    }
    if (/^(?:安全验证|访问异常|异常访问|身份验证|行为验证|验证码|请完成验证)(?:\s*[-_|·].*)?$/i.test(String(title || "").trim())) {
      return "verification-title";
    }
    if (!hasNormalContent && isZhilianSecurityInstructionText(text)) {
      return "instruction-text";
    }
    return "";
  }

  function isZhilianSecurityPage(options = {}) {
    return Boolean(zhilianSecurityReason(options));
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

  function buildSearchUrl(keyword, config = {}, pageNumber = 1) {
    const search = normalizedSearchParamsForCursor(config);
    const page = Math.max(1, Math.floor(Number(pageNumber) || 1));
    const params = new URLSearchParams();
    params.set("kw", String(keyword || ""));
    if (!isUnlimitedZhilianSalary(search.salary)) params.set("sl", search.salary);
    if (page > 1) params.set("p", String(page));
    return `https://www.zhaopin.com/sou/jl${search.cityCode}/?${params.toString()}`;
  }

  root.GetJobsZhilianScanSupport = Object.freeze({
    version: SUPPORT_VERSION,
    DEFAULT_CITY_CODE,
    DEFAULT_SALARY_CODE,
    normalizeKeywordList,
    normalizeZhilianCityCode,
    normalizeZhilianSalaryCode,
    isUnlimitedZhilianSalary,
    normalizedSearchParamsForCursor,
    isZhilianUrl,
    isZhilianSearchUrl,
    isZhilianSecurityInstructionText,
    zhilianSecurityReason,
    isZhilianSecurityPage,
    prepareTaskForResume,
    mergeScanStatus,
    buildSearchUrl
  });
})(typeof window !== "undefined" ? window : globalThis);
