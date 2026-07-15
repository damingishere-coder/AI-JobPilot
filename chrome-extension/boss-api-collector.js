(function () {
  if (window.GetJobsBossApiCollector) return;

  const API_PATH = "/wapi/zpgeek/search/joblist.json";
  const FILTER_KEYS = ["jobType", "salary", "experience", "degree", "scale", "industry", "stage"];
  const FALLBACK_DIAGNOSTICS = new Set(["API_EMPTY", "API_SCHEMA_CHANGED", "API_REQUEST_FAILED"]);

  function buildRequest(options = {}) {
    const keyword = compact(options.keyword);
    const cityCode = compact(options.cityCode || options.city);
    const page = normalizeInteger(options.page, 1);
    const pageSize = normalizeInteger(options.pageSize, 10);
    const config = options.config || {};

    if (!keyword) throw new Error("Boss API POC 缺少搜索关键词");
    if (keyword.length > 100) throw new Error("Boss API POC 搜索关键词过长");
    if (!/^\d+$/.test(cityCode) || cityCode === "0") throw new Error("Boss API POC 需要一个明确的城市码");
    if (page !== 1) throw new Error("Boss API POC 仅支持第一页");
    if (pageSize < 1 || pageSize > 10) throw new Error("Boss API POC pageSize 必须在 1 到 10 之间");

    const params = {
      scene: "1",
      query: keyword,
      city: cityCode,
      page: "1",
      pageSize: String(pageSize)
    };
    FILTER_KEYS.forEach((key) => {
      const value = normalizeFilter(config[key]);
      if (value) params[key] = value;
    });

    const search = new URLSearchParams(params);
    return {
      path: API_PATH,
      params,
      relativeUrl: `${API_PATH}?${search.toString()}`,
      keyword,
      cityCode,
      page: 1,
      pageSize
    };
  }

  async function collect(options = {}) {
    let request;
    try {
      request = buildRequest(options);
    } catch (error) {
      return diagnosticResult("API_REQUEST_FAILED", {
        apiMessage: error?.message || String(error),
        request: null
      });
    }

    let pageResult;
    try {
      const requestPage = typeof options.requestPage === "function" ? options.requestPage : requestInPage;
      pageResult = await requestPage(request);
    } catch (error) {
      return diagnosticResult("API_REQUEST_FAILED", {
        apiMessage: error?.message || String(error),
        request
      });
    }
    return parsePageResult(pageResult, request);
  }

  async function collectWithFallback(options = {}, fallbackCollector) {
    const apiResult = await collect(options);
    if (!shouldFallback(apiResult.diagnosticType) || typeof fallbackCollector !== "function") {
      return { ...apiResult, fallbackUsed: false };
    }

    try {
      const fallbackResult = await fallbackCollector(apiResult);
      const jobs = Array.isArray(fallbackResult?.jobs) ? fallbackResult.jobs.slice(0, 10) : [];
      return {
        ...apiResult,
        success: jobs.length > 0,
        jobs,
        candidateCount: jobs.length,
        fallbackUsed: true,
        collectorSource: compact(fallbackResult?.collectorSource) || "boss-fallback",
        fallback: fallbackResult || {}
      };
    } catch (error) {
      return {
        ...apiResult,
        success: false,
        jobs: [],
        candidateCount: 0,
        fallbackUsed: true,
        collectorSource: "none",
        fallbackError: error?.message || String(error)
      };
    }
  }

  function parsePageResult(pageResult, request) {
    const httpStatus = Number(pageResult?.httpStatus || 0);
    const pageState = pageResult?.pageState || {};
    if (pageState.isSecurityPage) {
      return diagnosticResult("SECURITY_VERIFICATION", { httpStatus, request, apiMessage: "Boss 页面要求安全验证" });
    }
    if (pageState.isLoginPage) {
      return diagnosticResult("LOGIN_REQUIRED", { httpStatus, request, apiMessage: "Boss 登录状态已失效" });
    }
    if (!pageResult?.success) {
      return diagnosticResult("API_REQUEST_FAILED", {
        httpStatus,
        request,
        apiMessage: compact(pageResult?.message || pageResult?.parseError) || `Boss 搜索接口返回 HTTP ${httpStatus || "未知"}`
      });
    }

    const data = pageResult.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return diagnosticResult(pageResult?.responseOk ? "API_SCHEMA_CHANGED" : "API_REQUEST_FAILED", {
        httpStatus,
        request,
        apiMessage: compact(pageResult?.parseError) || "Boss 搜索接口未返回 JSON 对象"
      });
    }

    const apiCode = Number(data.code);
    const apiMessage = compact(data.message || data.msg);
    if (apiCode === 37) {
      return diagnosticResult("API_CODE_37", { apiCode, apiMessage, httpStatus, request });
    }
    if (looksLikeSecurityMessage(apiMessage)) {
      return diagnosticResult("SECURITY_VERIFICATION", { apiCode, apiMessage, httpStatus, request });
    }
    if (looksLikeLoginMessage(apiMessage)) {
      return diagnosticResult("LOGIN_REQUIRED", { apiCode, apiMessage, httpStatus, request });
    }
    if (!pageResult?.responseOk) {
      return diagnosticResult("API_REQUEST_FAILED", { apiCode, apiMessage, httpStatus, request });
    }
    if (apiCode !== 0) {
      return diagnosticResult("API_REQUEST_FAILED", { apiCode, apiMessage, httpStatus, request });
    }
    if (!data.zpData || typeof data.zpData !== "object" || Array.isArray(data.zpData)) {
      return diagnosticResult("API_SCHEMA_CHANGED", { apiCode, apiMessage, httpStatus, request });
    }
    if (!Array.isArray(data.zpData.jobList)) {
      return diagnosticResult("API_SCHEMA_CHANGED", { apiCode, apiMessage, httpStatus, request });
    }
    if (!data.zpData.jobList.length) {
      return diagnosticResult("API_EMPTY", { apiCode, apiMessage, httpStatus, request });
    }

    const jobs = data.zpData.jobList.slice(0, request.pageSize).map((job) => mapJob(job, request.keyword));
    const missingSalaryCount = jobs.filter((job) => !job.salary).length;
    const diagnosticType = missingSalaryCount > 0 ? "API_SALARY_MISSING" : "API_SUCCESS";
    return diagnosticResult(diagnosticType, {
      success: true,
      jobs,
      candidateCount: jobs.length,
      missingSalaryCount,
      apiCode,
      apiMessage,
      httpStatus,
      request,
      collectorSource: "boss-search-api"
    });
  }

  function mapJob(rawJob, keyword) {
    const job = rawJob && typeof rawJob === "object" ? rawJob : {};
    const id = compact(job.encryptJobId);
    const encryptBossId = compact(job.encryptBossId);
    return {
      id,
      userId: encryptBossId,
      title: compact(job.jobName),
      company: compact(job.brandName),
      salary: compact(job.salaryDesc),
      location: [job.cityName, job.areaDistrict, job.businessDistrict].map(compact).filter(Boolean).join("·"),
      experience: compact(job.jobExperience),
      degree: compact(job.jobDegree),
      hrName: "",
      hrTitle: compact(job.bossTitle),
      hrActive: "",
      description: "",
      deliveryStatus: "LIST_COLLECTED",
      url: id ? `https://www.zhipin.com/job_detail/${id}.html` : "",
      industry: compact(job.brandIndustry),
      financingStage: compact(job.brandStageName),
      companyScale: compact(job.brandScaleName),
      skills: normalizeStringArray(job.skills),
      welfare: normalizeStringArray(job.welfareList),
      keyword: compact(keyword),
      source: "boss-search-api",
      salarySource: "api",
      securityId: compact(job.securityId),
      lid: compact(job.lid),
      encryptBossId,
      encryptBrandId: compact(job.encryptBrandId)
    };
  }

  function diagnosticResult(type, details = {}) {
    const jobs = Array.isArray(details.jobs) ? details.jobs : [];
    return {
      success: Boolean(details.success),
      diagnosticType: type,
      apiCode: Number.isFinite(Number(details.apiCode)) ? Number(details.apiCode) : null,
      apiMessage: compact(details.apiMessage),
      httpStatus: Number(details.httpStatus || 0),
      jobs,
      candidateCount: Number(details.candidateCount ?? jobs.length ?? 0),
      missingSalaryCount: Number(details.missingSalaryCount || 0),
      fallbackUsed: false,
      collectorSource: details.collectorSource || (jobs.length ? "boss-search-api" : "none"),
      request: details.request || null
    };
  }

  async function requestInPage(request) {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      throw new Error("Chrome 扩展消息通道不可用");
    }
    const response = await chrome.runtime.sendMessage({
      source: "GET_JOBS_BOSS_CONTENT",
      type: "BOSS_API_PAGE_REQUEST",
      request: {
        path: request.path,
        params: request.params
      }
    });
    return response || { success: false, message: "Boss API 页面请求返回为空" };
  }

  function shouldFallback(type) {
    return FALLBACK_DIAGNOSTICS.has(String(type || ""));
  }

  function normalizeFilter(value) {
    return toList(value)
      .filter((item) => item !== "0" && item !== "不限")
      .filter((item, index, list) => list.indexOf(item) === index)
      .join(",");
  }

  function toList(value) {
    if (Array.isArray(value)) return value.map(compact).filter(Boolean);
    const raw = compact(value);
    if (!raw) return [];
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(compact).filter(Boolean);
      } catch {
        return raw.slice(1, -1).split(/[,，;；\n\r]+/).map(compact).filter(Boolean);
      }
    }
    return raw.split(/[,，;；\n\r]+/).map(compact).filter(Boolean);
  }

  function normalizeStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map(compact).filter(Boolean);
  }

  function normalizeInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : fallback;
  }

  function looksLikeLoginMessage(value) {
    return /登录|login|未登录|登录失效|请先登录/i.test(String(value || ""));
  }

  function looksLikeSecurityMessage(value) {
    return /安全验证|验证码|滑块|访问过于频繁|security|verify|captcha|异常访问/i.test(String(value || ""));
  }

  function compact(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  window.GetJobsBossApiCollector = Object.freeze({
    API_PATH,
    buildRequest,
    collect,
    collectWithFallback,
    mapJob,
    parsePageResult,
    shouldFallback
  });
})();
