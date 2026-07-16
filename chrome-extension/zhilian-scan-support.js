(function (root) {
  const SUPPORT_VERSION = "2026-07-16-search-resume-navigation-1";
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
    normalizeZhilianCityCode,
    normalizeZhilianSalaryCode,
    isUnlimitedZhilianSalary,
    normalizedSearchParamsForCursor,
    isZhilianUrl,
    isZhilianSearchUrl,
    buildSearchUrl
  });
})(typeof window !== "undefined" ? window : globalThis);
