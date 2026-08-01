(function () {
  const EXTENSION_VERSION = "2026-08-01-consolidated-boss-api";
  const CONTENT_INSTANCE_ID = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.__GET_JOBS_BOSS_CONTENT__ = true;
  window.__GET_JOBS_BOSS_CONTENT_VERSION__ = EXTENSION_VERSION;
  window.__GET_JOBS_BOSS_CONTENT_INSTANCE_ID__ = CONTENT_INSTANCE_ID;

  const SCAN_TASK_KEY = "__GET_JOBS_BOSS_SCAN_TASK__";
  const SCAN_CANCEL_KEY = "__GET_JOBS_BOSS_SCAN_CANCEL__";
  const SHARED_SCAN_TASK_KEY = "__GET_JOBS_BOSS_SHARED_SCAN_TASK__";
  const SHARED_SCAN_CANCEL_KEY = "__GET_JOBS_BOSS_SHARED_SCAN_CANCEL__";
  const SCAN_STATUS_KEY = "__GET_JOBS_BOSS_SCAN_STATUS__";
  const KEYWORD_CURSOR_KEY = "__GET_JOBS_BOSS_KEYWORD_CURSOR__";
  const SUBMIT_BATCH_SIZE = 10;
  const SCAN_SUPPORT = window.GetJobsBossScanSupport || {};
  const SCAN_TASK_TTL_MS = SCAN_SUPPORT.DEFAULT_TASK_TTL_MS || 24 * 60 * 60 * 1000;
  const DETAIL_NAVIGATION_GUARD_MS = 800;
  const SEARCH_NAVIGATION_GRACE_MS = 15 * 1000;
  const SEARCH_NAVIGATION_RETRY_MS = 2500;
  const SEARCH_NAVIGATION_MAX_ATTEMPTS = 5;
  const DETAIL_NAVIGATION_MAX_ATTEMPTS = 3;
  const SEARCH_PARAM_KEYS = ["city", "jobType", "salary", "experience", "degree", "scale", "industry", "stage", "query"];
  const BOSS_SELECTORS = window.GetJobsBossSelectors || {};
  const JOB_CARD_SELECTORS = BOSS_SELECTORS.JOB_CARD_SELECTORS || ["a[href*='/job_detail/'], a[href*='job_detail']"];
  const SEARCH_RESULT_SELECTORS = BOSS_SELECTORS.SEARCH_RESULT_SELECTORS || JOB_CARD_SELECTORS;
  let stopRequested = false;
  let stopRequestedRunId = "";
  let activeScanRunId = "";
  let activeScanPromise = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isCurrentContentInstance()) return;
    if (message?.source !== "GET_JOBS_BACKGROUND") return;

    if (message?.type === "PING_CONTENT") {
      sendResponse({ success: true, version: EXTENSION_VERSION, instanceId: CONTENT_INSTANCE_ID });
      return;
    }
    if (message?.type === "GET_BOSS_CONTENT_VERSION") {
      sendResponse({ success: true, version: EXTENSION_VERSION, instanceId: CONTENT_INSTANCE_ID });
      return;
    }
    if (message?.type === "BOSS_SCAN_STOP") {
      const runId = normalizeScanRunId(message?.runId || activeScanRunId || readStoredScanTask()?.runId);
      activeScanRunId = runId || activeScanRunId;
      stopRequested = true;
      storeStopRequested(runId);
      clearStoredScanTask();
      writeScanStatus({ isRunning: false, stopRequested: true, stage: "stopped", message: "已请求停止Boss扫描", runId });
      postProgress(message, "warning", "Boss Chrome扫描停止请求已接收，正在中断当前任务。", {
        operation: "scan",
        stage: "stopping",
        runId
      });
      sendResponse({ success: true, message: "已请求停止Boss扫描" });
      return;
    }
    if (message?.type === "BOSS_SCAN_STATUS") {
      handleScanStatusMessage(sendResponse);
      return true;
    }
    if (message?.type === "BOSS_PAGE_STATUS") {
      sendResponse(buildBossPageStatus());
      return;
    }
    if (message?.type === "BOSS_DEBUG_COLLECT") {
      sendResponse(handleBossDebugCollect());
      return;
    }
    if (message?.type === "BOSS_COLLECT_CURRENT_PAGE") {
      handleBossCurrentPageCollect(message).then(sendResponse).catch((error) => {
        const diagnostics = collectBossDiagnostics();
        const reason = safeErrorMessage(error);
        postProgress(message, "error", `Boss当前页采集失败：${reason}。${formatBossDiagnostics(diagnostics)}`, {
          operation: "listCollect",
          stage: "error",
          ...diagnostics
        });
        sendResponse({
          success: false,
          message: `Boss当前页采集失败：${reason}`,
          ...diagnostics
        });
      });
      return true;
    }
    if (message?.type === "BOSS_API_POC_COLLECT") {
      handleBossApiPocCollect(message).then(sendResponse).catch((error) => {
        const reason = safeErrorMessage(error);
        postProgress(message, "error", `Boss API POC 执行失败：${reason}`, {
          operation: "apiPoc",
          stage: "error",
          diagnosticType: "API_REQUEST_FAILED"
        });
        sendResponse({
          success: false,
          message: `Boss API POC 执行失败：${reason}`,
          diagnosticType: "API_REQUEST_FAILED",
          fallbackUsed: false,
          collectorSource: "none",
          saved: 0,
          listCollected: 0
        });
      });
      return true;
    }
    if (message?.type === "BOSS_SCAN_START") {
      handleScanStartMessage(message, sendResponse);
      return true;
    }
    if (message?.type === "BOSS_DELIVER_CURRENT_V2") {
      prepareStandaloneDelivery();
      handleDeliverCurrentMessage(message, sendResponse);
      return true;
    }
    if (message?.type === "BOSS_DELIVER_ONE") {
      prepareStandaloneDelivery();
      deliverOne(message.task, message).then(sendResponse).catch((error) => {
        postProgress(message, "error", error.message || String(error), {
          operation: "deliver",
          stage: "error"
        });
        sendResponse({ success: false, message: error.message || String(error) });
      });
      return true;
    }
    if (message?.type === "BOSS_DELIVER_BATCH") {
      prepareStandaloneDelivery();
      deliverBatch(message.tasks || [], message).then(sendResponse).catch((error) => {
        postProgress(message, "error", error.message || String(error), {
          operation: "deliver",
          stage: "error"
        });
        sendResponse({ success: false, message: error.message || String(error) });
      });
      return true;
    }
  });

  setTimeout(() => {
    if (isCurrentContentInstance()) resumeStoredScanTaskIfActive().catch((error) => {
      console.warn("[GetJobs] Boss扫描任务恢复失败", error);
    });
  }, 50);

  function isCurrentContentInstance() {
    return window.__GET_JOBS_BOSS_CONTENT_INSTANCE_ID__ === CONTENT_INSTANCE_ID;
  }

  function handleBossDebugCollect() {
    const diagnostics = collectBossDiagnostics();
    const diagnosticType = diagnostics.isSecurityPage
      ? "SECURITY_VERIFICATION"
      : diagnostics.isLoginPage
        ? "LOGIN_REQUIRED"
        : !diagnostics.isSearchPage
          ? "WRONG_PAGE"
          : diagnostics.detailLinkCount > 0
            ? "PAGE_READY"
            : "SELECTOR_MISMATCH";
    const diagnostic = buildBossDiagnostic(diagnosticType, "diagnose", diagnostics);
    return {
      success: true,
      message: diagnostic.message,
      diagnosticType: diagnostic.type,
      impact: diagnostic.impact,
      suggestion: diagnostic.suggestion,
      ...diagnostics
    };
  }

  async function handleBossCurrentPageCollect(message) {
    const diagnostics = collectBossDiagnostics();
    if (diagnostics.isSecurityPage) {
      const text = `检测到Boss安全验证页，本工具不会绕过验证码。请在Chrome中手动完成验证后再采集。${formatBossDiagnostics(diagnostics)}`;
      postProgress(message, "warning", text, {
        operation: "listCollect",
        stage: "blocked",
        ...diagnostics
      });
      return { success: false, blocked: true, message: text, ...diagnostics };
    }
    if (diagnostics.isLoginPage) {
      const text = `检测到Boss登录页，请先在Chrome中手动登录后再采集。${formatBossDiagnostics(diagnostics)}`;
      postProgress(message, "warning", text, {
        operation: "listCollect",
        stage: "blocked",
        ...diagnostics
      });
      return { success: false, blocked: true, message: text, ...diagnostics };
    }

    // 关键检查：必须在Boss搜索结果页才能采集
    if (!diagnostics.isSearchPage) {
      const text = `当前不是Boss岗位搜索结果页，无法采集。请在Chrome中打开Boss搜索页（如 https://www.zhipin.com/web/geek/job?city=101280600&query=Java），再重新采集。当前页面：${diagnostics.currentUrl || window.location.href}`;
      postProgress(message, "warning", text, {
        operation: "listCollect",
        stage: "blocked",
        diagnosticType: "WRONG_PAGE",
        ...diagnostics
      });
      return { success: false, blocked: true, message: text, diagnosticType: "WRONG_PAGE", ...diagnostics };
    }

    const collector = window.GetJobsBossSearchCollector;
    if (!collector?.collectVisibleJobs) {
      throw new Error("Boss列表采集模块未加载，请在扩展管理页重新加载扩展并刷新Boss页面");
    }

    const result = collector.collectVisibleJobs({ keyword: message?.keyword });
    const resultSummary = summarizeBossListCollectResult(result);
    if (!result.jobs.length) {
      const diagnosticType = !diagnostics.isSearchPage
        ? "WRONG_PAGE"
        : diagnostics.detailLinkCount === 0
          ? "SELECTOR_MISMATCH"
          : "CARD_PARSE_FAILED";
      const diagnostic = buildBossDiagnostic(diagnosticType, "listCollect", diagnostics, resultSummary);
      const selectorDetails = diagnostics.selectorCounts
        ? Object.entries(diagnostics.selectorCounts).filter(([, c]) => c > 0).map(([s, c]) => `${s}=${c}`).join("，")
        : "所有选择器匹配为0";
      const fieldSelectorDetails = diagnostics.fieldSelectorCounts
        ? Object.entries(diagnostics.fieldSelectorCounts).filter(([, c]) => Object.values(c).some(v => v > 0)).map(([g, c]) => `${g}:${JSON.stringify(c)}`).join("，")
        : "";
      const text = `${diagnostic.message} ${formatBossDiagnostics(diagnostics)}；选择器匹配：${selectorDetails}；${fieldSelectorDetails ? `字段匹配：${fieldSelectorDetails}；` : ""}missingFieldCounts=${JSON.stringify(result.missingFieldCounts || {})}；bodyText=${(diagnostics.bodyTextLength || 0)}字符；scriptNodes=${diagnostics.scriptCount || 0}`;
      postProgress(message, "error", text, {
        operation: "listCollect",
        stage: "empty",
        diagnosticType: diagnostic.type,
        impact: diagnostic.impact,
        suggestion: diagnostic.suggestion,
        ...diagnostics,
        ...resultSummary
      });
      return {
        success: false,
        message: text,
        diagnosticType: diagnostic.type,
        impact: diagnostic.impact,
        suggestion: diagnostic.suggestion,
        ...diagnostics,
        ...resultSummary
      };
    }

    const runId = normalizeScanRunId(message?.runId) || `boss-list-${Date.now()}`;
    const dedupeResult = await filterDuplicateJobs(result.jobs, { ...message, runId }, {
      operation: "listCollect",
      keyword: result.keyword
    });
    const jobsToSave = dedupeResult.jobs;
    if (!jobsToSave.length) {
      const messageText = `Boss当前页采集完成：识别 ${result.parsedCount} 个岗位，全部属于无需补全的历史岗位，本次未新增数据。`;
      postProgress(message, "info", messageText, {
        operation: "listCollect",
        stage: "dedupe",
        runId,
        duplicates: dedupeResult.duplicateCount,
        enrich: dedupeResult.enrichCount,
        skippedDuplicates: dedupeResult.skipCount
      });
      return {
        success: true,
        message: messageText,
        runId,
        ...diagnostics,
        ...resultSummary,
        saved: 0,
        listCollected: 0,
        duplicateCount: dedupeResult.duplicateCount,
        enrichCount: dedupeResult.enrichCount,
        skipCount: dedupeResult.skipCount
      };
    }
    const data = await callBossLocalApi("chrome-jobs", {
      runId,
      keyword: result.keyword,
      collectionMode: "LIST_ONLY",
      autoDeliver: false,
      jobs: jobsToSave
    }, {
      pageTabId: message?.pageTabId,
      timeoutMs: 60000
    });

    if (!data.success) {
      throw new Error(data.message || "后端未接受Boss当前页岗位数据");
    }

    const missingMessage = Object.entries(result.missingFieldCounts || {})
      .filter(([, count]) => Number(count) > 0)
      .map(([field, count]) => `${field}=${count}`)
      .join("，");
    const successMessage = `Boss当前页采集完成：识别候选 ${result.candidateCount} 个，成功解析 ${result.parsedCount} 个，历史跳过 ${dedupeResult.skipCount} 个，后端入库 ${numberValue(data.saved)} 个，状态 LIST_COLLECTED，不进入AI分析。${missingMessage ? ` 缺失字段统计：${missingMessage}。` : ""}`;
    postProgress(message, "success", successMessage, {
      operation: "listCollect",
      stage: "listCollected",
      runId,
      saved: numberValue(data.saved),
      listCollected: numberValue(data.listCollected),
      duplicateCount: dedupeResult.duplicateCount,
      enrichCount: dedupeResult.enrichCount,
      skipCount: dedupeResult.skipCount,
      ...diagnostics,
      ...resultSummary
    });

    return {
      success: true,
      message: successMessage,
      runId,
      ...diagnostics,
      ...resultSummary,
      backend: data,
      saved: numberValue(data.saved),
      listCollected: numberValue(data.listCollected),
      duplicateCount: dedupeResult.duplicateCount,
      enrichCount: dedupeResult.enrichCount,
      skipCount: dedupeResult.skipCount
    };
  }

  async function handleBossApiPocCollect(message) {
    const diagnostics = collectBossDiagnostics();
    if (diagnostics.isSecurityPage) {
      return finishBlockedBossApiPoc(message, "SECURITY_VERIFICATION", "检测到 Boss 安全验证页。本工具不会绕过验证码，请手动完成验证后再测试。", diagnostics);
    }
    if (diagnostics.isLoginPage) {
      return finishBlockedBossApiPoc(message, "LOGIN_REQUIRED", "检测到 Boss 登录页，请先在当前 Chrome 中手动登录后再测试。", diagnostics);
    }
    if (!diagnostics.isSearchPage) {
      return finishBlockedBossApiPoc(message, "API_REQUEST_FAILED", "当前不是 Boss 岗位搜索结果页，请先打开一个正常搜索页。", diagnostics);
    }

    const collector = window.GetJobsBossApiCollector;
    if (!collector?.collectWithFallback) {
      throw new Error("Boss API 采集模块未加载，请重新加载扩展并刷新 Boss 页面");
    }

    const keyword = compact(message?.keyword);
    const cityCode = compact(message?.cityCode);
    const pageSize = Math.min(10, Math.max(1, Number(message?.pageSize || 10)));
    const runId = normalizeScanRunId(message?.runId) || `boss-api-poc-${Date.now()}`;
    const baseMeta = { operation: "apiPoc", keyword, cityCode, page: 1, pageSize, runId };
    postProgress(message, "info", `Boss API POC 开始：关键词=${keyword}，城市码=${cityCode}，页码=1，pageSize=${pageSize}。`, {
      ...baseMeta,
      stage: "requesting"
    });

    const result = await collector.collectWithFallback({
      keyword,
      cityCode,
      page: 1,
      pageSize,
      config: message?.config || {}
    }, async (apiResult) => {
      postProgress(message, "warning", `${bossApiDiagnosticMessage(apiResult)} 将按页面内嵌数据、DOM 卡片和点击卡片的顺序降级。`, {
        ...baseMeta,
        stage: "fallback",
        diagnosticType: apiResult.diagnosticType,
        apiCode: apiResult.apiCode,
        httpStatus: apiResult.httpStatus
      });
      const listResult = collectJobs(keyword, {
        ...message,
        config: { ...(message?.config || {}), searchJobLimit: pageSize }
      }, baseMeta, { maxNodes: pageSize });
      const listJobs = listResult.jobs.slice(0, pageSize);
      if (listJobs.length) {
        return {
          jobs: listJobs,
          collectorSource: listResult.embeddedParsed > 0 ? "boss-embedded-state" : "boss-dom-card",
          embeddedParsed: listResult.embeddedParsed,
          domParsed: Math.max(0, listJobs.length - listResult.embeddedParsed)
        };
      }

      const clickResult = await collectBossJobsFromClickableCards(keyword, message, baseMeta, pageSize, { maxClicks: pageSize });
      return {
        ...clickResult,
        jobs: clickResult.jobs.slice(0, pageSize).map((job) => ({
          ...job,
          source: "boss-click-fallback",
          salarySource: job.salarySource || "dom_untrusted"
        })),
        collectorSource: "boss-click-fallback"
      };
    });

    const diagnosticText = bossApiDiagnosticMessage(result);
    postProgress(message, result.success ? (result.diagnosticType === "API_SUCCESS" ? "success" : "warning") : "error", diagnosticText, {
      ...baseMeta,
      stage: result.success ? "collected" : "blocked",
      diagnosticType: result.diagnosticType,
      apiCode: result.apiCode,
      httpStatus: result.httpStatus,
      candidateCount: result.candidateCount,
      missingSalaryCount: result.missingSalaryCount,
      fallbackUsed: result.fallbackUsed,
      collectorSource: result.collectorSource
    });

    const candidates = (Array.isArray(result.jobs) ? result.jobs : []).slice(0, pageSize).map((job) => ({
      ...job,
      keyword,
      deliveryStatus: "LIST_COLLECTED"
    }));
    if (!result.success || !candidates.length) {
      return {
        success: false,
        message: diagnosticText,
        runId,
        diagnosticType: result.diagnosticType,
        apiCode: result.apiCode,
        apiMessage: result.apiMessage,
        httpStatus: result.httpStatus,
        candidateCount: candidates.length,
        missingSalaryCount: result.missingSalaryCount,
        fallbackUsed: result.fallbackUsed,
        collectorSource: result.collectorSource,
        saved: 0,
        listCollected: 0,
        ...diagnostics
      };
    }

    const dedupeResult = await filterDuplicateJobs(candidates, { ...message, runId }, baseMeta);
    if (!dedupeResult.jobs.length) {
      const messageText = `${diagnosticText} 识别 ${candidates.length} 个岗位，全部为无需补全的历史岗位，本次未新增。`;
      postProgress(message, "info", messageText, {
        ...baseMeta,
        stage: "dedupe",
        diagnosticType: result.diagnosticType,
        duplicates: dedupeResult.duplicateCount,
        skippedDuplicates: dedupeResult.skipCount
      });
      return {
        success: true,
        message: messageText,
        runId,
        diagnosticType: result.diagnosticType,
        apiCode: result.apiCode,
        apiMessage: result.apiMessage,
        httpStatus: result.httpStatus,
        candidateCount: candidates.length,
        missingSalaryCount: result.missingSalaryCount,
        fallbackUsed: result.fallbackUsed,
        collectorSource: result.collectorSource,
        saved: 0,
        listCollected: 0,
        duplicateCount: dedupeResult.duplicateCount,
        skipCount: dedupeResult.skipCount
      };
    }

    const data = await callBossLocalApi("chrome-jobs", {
      runId,
      keyword,
      collectionMode: "LIST_ONLY",
      autoDeliver: false,
      jobs: dedupeResult.jobs
    }, {
      pageTabId: message?.pageTabId,
      timeoutMs: 60000
    });
    if (!data.success) throw new Error(data.message || "后端未接受 Boss API POC 岗位数据");

    const successMessage = `${diagnosticText} 候选 ${candidates.length} 个，历史跳过 ${dedupeResult.skipCount} 个，后端入库 ${numberValue(data.saved)} 个，状态 LIST_COLLECTED，不进入 AI 分析。`;
    postProgress(message, "success", successMessage, {
      ...baseMeta,
      stage: "listCollected",
      diagnosticType: result.diagnosticType,
      apiCode: result.apiCode,
      httpStatus: result.httpStatus,
      candidateCount: candidates.length,
      missingSalaryCount: result.missingSalaryCount,
      fallbackUsed: result.fallbackUsed,
      collectorSource: result.collectorSource,
      saved: numberValue(data.saved),
      listCollected: numberValue(data.listCollected)
    });
    return {
      success: true,
      message: successMessage,
      runId,
      diagnosticType: result.diagnosticType,
      apiCode: result.apiCode,
      apiMessage: result.apiMessage,
      httpStatus: result.httpStatus,
      candidateCount: candidates.length,
      missingSalaryCount: result.missingSalaryCount,
      fallbackUsed: result.fallbackUsed,
      collectorSource: result.collectorSource,
      saved: numberValue(data.saved),
      listCollected: numberValue(data.listCollected),
      duplicateCount: dedupeResult.duplicateCount,
      enrichCount: dedupeResult.enrichCount,
      skipCount: dedupeResult.skipCount,
      backend: data
    };
  }

  function finishBlockedBossApiPoc(message, diagnosticType, text, diagnostics) {
    postProgress(message, "warning", text, {
      operation: "apiPoc",
      stage: "blocked",
      diagnosticType,
      ...diagnostics
    });
    return {
      success: false,
      blocked: true,
      message: text,
      diagnosticType,
      apiCode: null,
      apiMessage: "",
      httpStatus: 0,
      candidateCount: 0,
      missingSalaryCount: 0,
      fallbackUsed: false,
      collectorSource: "none",
      saved: 0,
      listCollected: 0,
      ...diagnostics
    };
  }

  function bossApiDiagnosticMessage(result) {
    const type = String(result?.diagnosticType || "API_REQUEST_FAILED");
    const catalog = {
      API_SUCCESS: "API_SUCCESS：Boss 搜索 API 返回正常，已获得结构化岗位和明文薪资。",
      API_EMPTY: "API_EMPTY：Boss 搜索 API 返回空岗位列表。",
      LOGIN_REQUIRED: "LOGIN_REQUIRED：Boss 登录状态已失效，请手动登录后再测试。",
      SECURITY_VERIFICATION: "SECURITY_VERIFICATION：Boss 要求安全验证，本工具不会绕过验证。",
      API_CODE_37: "API_CODE_37：Boss 搜索 API 返回 code 37，本次 POC 已停止且不会自动重试。",
      API_SCHEMA_CHANGED: "API_SCHEMA_CHANGED：Boss 搜索 API 响应结构与预期不一致。",
      API_REQUEST_FAILED: "API_REQUEST_FAILED：Boss 搜索 API 请求失败。",
      API_SALARY_MISSING: `API_SALARY_MISSING：API 返回岗位，但有 ${numberValue(result?.missingSalaryCount)} 个岗位缺少 salaryDesc。`
    };
    const suffix = [
      result?.apiCode !== null && result?.apiCode !== undefined && Number.isFinite(Number(result.apiCode)) ? `code=${Number(result.apiCode)}` : "",
      result?.apiMessage ? `message=${compact(result.apiMessage)}` : "",
      result?.httpStatus ? `httpStatus=${numberValue(result.httpStatus)}` : "",
      result?.fallbackUsed ? `fallback=${result.collectorSource || "unknown"}` : "",
      `jobs=${numberValue(result?.candidateCount)}`
    ].filter(Boolean).join("；");
    return `${catalog[type] || catalog.API_REQUEST_FAILED}${suffix ? ` ${suffix}` : ""}`;
  }

  function collectBossDiagnostics() {
    if (window.GetJobsBossDebug?.collect) {
      return window.GetJobsBossDebug.collect();
    }
    const currentUrl = window.location.href;
    const bodyText = String(document.body?.innerText || document.body?.textContent || "").trim();
    const compactText = compact(bodyText);
    return {
      currentUrl,
      title: document.title || "",
      isLoginPage: isStrongLoginPrompt(compactText, currentUrl),
      isSecurityPage: isSecurityPrompt(compactText),
      isSearchPage: isBossSearchPathSafe(currentUrl),
      detailLinkCount: document.querySelectorAll("a[href*='/job_detail/'], a[href*='job_detail']").length,
      selectorCounts: selectorStats(),
      firstCardText: compact(collectJobNodes()[0]?.innerText || collectJobNodes()[0]?.textContent || "").slice(0, 500)
    };
  }

  function isBossSearchPathSafe(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.includes("zhipin.com") && isBossSearchPath(parsed.pathname);
    } catch {
      return false;
    }
  }

  function formatBossDiagnostics(diagnostics) {
    return `currentUrl=${diagnostics.currentUrl || ""}；title=${diagnostics.title || ""}；detailLinkCount=${numberValue(diagnostics.detailLinkCount)}；selectorCounts=${JSON.stringify(diagnostics.selectorCounts || {})}；firstCardText=${diagnostics.firstCardText || ""}`;
  }

  function buildBossDiagnostic(type, stage, diagnostics = {}, details = {}) {
    const catalog = {
      PAGE_READY: ["页面可采集", "未发现阻塞问题。", "可以开始采集或完整扫描。"],
      LOGIN_REQUIRED: ["Boss登录状态已失效", "无法读取岗位列表或详情。", "请在Chrome的Boss页面完成登录，然后刷新页面并继续扫描。"],
      SECURITY_VERIFICATION: ["Boss要求安全验证", "扫描已暂停，当前岗位不会丢失。", "请手动完成验证码或安全验证，然后刷新页面或再次点击扫描。"],
      WRONG_PAGE: ["当前不是Boss岗位搜索结果页", "无法定位岗位卡片。", "请打开Boss岗位搜索结果页后重新诊断或采集。"],
      EMPTY_RESULTS: ["当前搜索条件没有岗位结果", "本关键词没有可入库岗位。", "可以调整关键词或筛选条件后重新扫描。"],
      SELECTOR_MISMATCH: ["Boss页面结构可能已经变化", "现有选择器没有识别到岗位卡片，扫描已暂停且保留断点。", "请保留当前页面并查看诊断数据，更新扩展选择器后可继续。"],
      CARD_PARSE_FAILED: ["Boss岗位卡片解析失败", "页面中存在候选节点，但必要字段不足，未写入错误数据。", "请查看缺失字段与选择器命中情况，更新解析规则后重试。"],
      DETAIL_PARSE_FAILED: ["Boss岗位详情解析失败", "该岗位详情不完整，暂不进入AI分析。", "请确认详情页已正常打开，再重试或更新详情选择器。"]
    };
    const [reason, impact, suggestion] = catalog[type] || ["Boss页面状态无法识别", "当前扫描结果不可靠。", "请刷新Boss页面并重新诊断。"];
    return {
      type,
      stage,
      reason,
      impact,
      suggestion,
      currentUrl: diagnostics.currentUrl || window.location.href,
      title: diagnostics.title || document.title || "",
      selectorCounts: diagnostics.selectorCounts || diagnostics.selectorStats || {},
      detailLinkCount: numberValue(diagnostics.detailLinkCount ?? diagnostics.detailLinks),
      candidateCount: numberValue(details.candidateCount ?? details.nodeCount),
      parsedCount: numberValue(details.parsedCount ?? details.parsed),
      missingFields: details.missingFields || details.missingFieldCounts || {},
      message: `原因：${reason}。影响：${impact} 下一步：${suggestion}`
    };
  }

  function buildLocalApiDiagnostic(error, stage) {
    const rawType = String(error?.code || "");
    const text = safeErrorMessage(error);
    const type = rawType
      || SCAN_SUPPORT.classifyLocalApiFailure?.(error)
      || (/Invalid CORS request|cors/i.test(text) ? "CORS_REJECTED"
        : /超时|timeout|abort/i.test(text) ? "LOCAL_API_TIMEOUT"
          : /无法连接|Failed to fetch|NetworkError|本地服务请求失败|6866端口/i.test(text) ? "LOCAL_SERVICE_UNAVAILABLE"
            : "LOCAL_API_ERROR");
    const catalog = {
      CORS_REJECTED: ["Chrome扩展请求被后端CORS规则拒绝", "岗位已采集但本批尚未入库，扫描断点已保留。", "重启更新后的本地服务并重新加载Chrome扩展，然后继续扫描。"],
      LOCAL_SERVICE_UNAVAILABLE: ["无法连接本地服务", "岗位暂时无法入库，扫描断点已保留。", "确认投递牛马本地服务和6866端口正常后，再次点击扫描继续。"],
      LOCAL_API_TIMEOUT: ["本地服务响应超时", "当前提交批次未确认完成，扫描断点已保留。", "确认本地服务仍在运行后继续扫描，系统会从当前批次恢复。"],
      LOCAL_API_FORBIDDEN: ["本地接口拒绝访问", "当前提交批次未入库。", "重新加载扩展并确认使用的是本项目本地页面。"],
      LOCAL_API_NOT_FOUND: ["本地接口不存在或版本不匹配", "扩展无法提交岗位。", "重启最新版本的本地服务并重新加载扩展。"],
      LOCAL_API_SERVER_ERROR: ["本地服务处理岗位时出错", "当前批次结果未确认，断点已保留。", "查看本地服务日志，修复后再次点击扫描继续。"],
      LOCAL_API_ERROR: ["本地接口请求失败", "当前批次没有可靠完成，断点已保留。", "检查本地服务日志后再次点击扫描继续。"]
    };
    const [reason, impact, suggestion] = catalog[type] || catalog.LOCAL_API_ERROR;
    return {
      type,
      stage,
      reason,
      impact,
      suggestion,
      message: `原因：${reason}。影响：${impact} 下一步：${suggestion}`
    };
  }

  function summarizeBossListCollectResult(result) {
    return {
      keyword: result?.keyword || "",
      candidateCount: numberValue(result?.candidateCount),
      parsedCount: numberValue(result?.parsedCount),
      skippedCount: numberValue(result?.skippedCount),
      missingFieldCounts: result?.missingFieldCounts || {},
      failures: Array.isArray(result?.failures) ? result.failures.slice(0, 20) : []
    };
  }

  async function handleScanStatusMessage(sendResponse) {
    const task = await readStoredScanTaskFromAnyStorage();
    const status = readScanStatus();
    const paused = Boolean(status.paused || (status.stage === "blocked" && status.resumable));
    const hasFreshTask = Boolean(task && isFreshScanTask(task));
    const hasResumableTask = Boolean(hasFreshTask || paused);
    if (task && !hasFreshTask && !paused) {
      clearStoredScanTask();
      writeScanStatus({
        isRunning: false,
        stopRequested: false,
        stage: "idle",
        message: "Boss旧扫描任务已清理"
      });
    }
    const nextStatus = readScanStatus();
    sendResponse({
      success: true,
      ...nextStatus,
      isRunning: Boolean(nextStatus.isRunning || hasFreshTask) && !paused,
      paused,
      resumable: Boolean(nextStatus.resumable || hasResumableTask),
      runId: nextStatus.runId || task?.runId || "",
      scanOwnerToken: task?.scanOwnerToken || "",
      hasStoredTask: hasResumableTask
    });
  }

  async function handleScanStartMessage(message, sendResponse) {
    const existingTask = await readStoredScanTaskFromAnyStorage();
    const status = readScanStatus();
    const incomingTask = normalizeScanTask(message);
    const configChanged = Boolean(
      existingTask?.keywordCursorKey
        && incomingTask.keywordCursorKey
        && existingTask.keywordCursorKey !== incomingTask.keywordCursorKey
    );
    const sameRun = isSameScanRun(existingTask, incomingTask);
    const shouldDiscardExisting = Boolean(existingTask && (!sameRun || configChanged));
    if (shouldDiscardExisting) {
      clearStoredScanTask();
      postProgress(message, "warning", configChanged
        ? "Boss扫描配置已变化，旧断点已放弃，将按新配置重新开始。"
        : "Boss检测到新的扫描任务，旧断点已清理，将按新关键词重新开始。", {
        operation: "scan",
        stage: "checkpointReset",
        diagnosticType: configChanged ? "CONFIG_CHANGED" : "NEW_RUN_DISCARDED_CHECKPOINT",
        previousRunId: existingTask?.runId || "",
        runId: incomingTask.runId || ""
      });
    }
    const resumableTask = shouldDiscardExisting ? null : existingTask;
    const canResumeExisting = Boolean(
      canResumeExistingScanTask(resumableTask, incomingTask, status, configChanged)
    );

    if (canResumeExisting) {
      activeScanRunId = normalizeScanRunId(resumableTask.runId);
      stopRequested = false;
      stopRequestedRunId = "";
      clearStopRequested();
      resumeStoredScanTaskIfActive(true).catch((error) => {
        writeScanStatus({
          isRunning: false,
          stopRequested: false,
          stage: "error",
          message: error.message || String(error),
          runId: activeScanRunId,
          updatedAt: Date.now()
        });
      });
      sendResponse({ success: true, message: "Boss Chrome扫描任务已恢复。", resumed: true, runId: activeScanRunId });
      return;
    }

    const runId = normalizeScanRunId(message?.runId) || `boss-${Date.now()}`;
    activeScanRunId = runId;
    stopRequested = false;
    stopRequestedRunId = "";
    clearStopRequested();
    startScan({ ...incomingTask, runId });
    sendResponse({ success: true, message: "Boss Chrome扫描任务已启动。", runId });
  }

  function startScan(message) {
    const task = normalizeScanTask(message);
    activeScanRunId = normalizeScanRunId(task.runId);
    storeScanTask(task);
    writeScanStatus({
      isRunning: true,
      stopRequested: false,
      stage: "received",
      message: "Boss Chrome扫描任务已接收",
      runId: task.runId,
      startedAt: task.startedAt,
      updatedAt: Date.now()
    });
    const keywords = scanKeywords(task);
    if (task.keywordCursorReset) {
      postProgress(task, "warning", "Boss搜索配置已变化，关键词历史已重置。", {
        operation: "scan",
        stage: "keywordCursor",
        keywordTotal: keywords.length
      });
    }
    if (keywords.length) {
      const startIndex = normalizeKeywordIndex(task.currentIndex, keywords.length);
      postProgress(task, "info", `Boss关键词历史：本次从第 ${startIndex + 1}/${keywords.length} 个关键词继续：${keywords[startIndex]}`, {
        operation: "scan",
        stage: "keywordCursor",
        keyword: keywords[startIndex],
        keywordIndex: startIndex + 1,
        keywordTotal: keywords.length
      });
    }
    postProgress(task, "info", `Boss Chrome扫描任务已接收，正在准备搜索页面。扩展版本：${EXTENSION_VERSION}`, {
      operation: "scan",
      stage: "received",
      extensionVersion: EXTENSION_VERSION,
      keywordTotal: keywords.length,
      collected: 0,
      analyzed: 0,
      saved: 0,
      waitingConfirm: 0
    });
    runScan(task).catch((error) => handleScanExecutionFailure(task, error));
  }

  async function resumeStoredScanTaskIfActive(force = false) {
    const storedTask = await readStoredScanTaskFromAnyStorage();
    if (!storedTask || storedTask.completed || stopRequested) return;
    const task = typeof SCAN_SUPPORT.prepareTaskForResume === "function"
      ? SCAN_SUPPORT.prepareTaskForResume(storedTask)
      : storedTask;
    activeScanRunId = normalizeScanRunId(task.runId);
    if (await hasStopRequested(task.runId)) {
      stopRequested = true;
      clearStoredScanTask();
      writeScanStatus({ isRunning: false, stopRequested: true, stage: "stopped", message: "Boss扫描已取消", runId: task.runId });
      return;
    }
    if (!isFreshScanTask(task) || !isBossUrl(window.location.href)) {
      clearStoredScanTask();
      writeScanStatus({
        isRunning: false,
        stopRequested: false,
        stage: "idle",
        message: "Boss旧扫描任务已过期或不适合恢复"
      });
      return;
    }

    storeScanTask(task);

    writeScanStatus({
      isRunning: true,
      stopRequested: false,
      stage: "resume",
      message: "Boss页面已重新加载，继续执行扫描任务",
      runId: task.runId,
      startedAt: task.startedAt,
      updatedAt: Date.now()
    });
    postProgress(task, "info", "Boss页面已重新加载，继续执行扫描任务。", {
      operation: "scan",
      stage: "resume",
      keywordIndex: Number(task.currentIndex || 0) + 1,
      keywordTotal: scanKeywords(task).length,
      totalSaved: Number(task.totalSaved || 0)
    });
    runScan(task).catch((error) => handleScanExecutionFailure(task, error));
  }

  function handleScanExecutionFailure(task, error) {
    const errorText = safeErrorMessage(error);
    const looksLikeLocalApiFailure = /^(CORS_|LOCAL_)/.test(String(error?.code || ""))
      || /Invalid CORS request|本地服务|本地接口|6866|Failed to fetch|NetworkError|请求超时/i.test(errorText);
    const diagnostic = looksLikeLocalApiFailure
      ? buildLocalApiDiagnostic(error, String(readStoredScanTask()?.phase || task?.phase || "error"))
      : {
          type: String(error?.code || "SCAN_ERROR"),
          impact: "本轮扫描已停止。",
          suggestion: "请根据错误信息修正配置或页面状态后重新开始扫描。",
          message: `原因：${errorText}。影响：本轮扫描已停止。下一步：请修正后重新开始扫描。`
        };
    const recoverable = [
      "CORS_REJECTED",
      "LOCAL_SERVICE_UNAVAILABLE",
      "LOCAL_API_TIMEOUT",
      "LOCAL_API_FORBIDDEN",
      "LOCAL_API_NOT_FOUND",
      "LOCAL_API_SERVER_ERROR",
      "LOCAL_API_ERROR",
      "SELECTOR_MISMATCH",
      "DETAIL_PARSE_FAILED"
    ].includes(diagnostic.type);
    const storedTask = readStoredScanTask() || task;
    if (recoverable && storedTask?.runId) {
      storeScanTask({
        ...storedTask,
        pausedAt: Date.now(),
        lastError: {
          type: diagnostic.type,
          message: safeErrorMessage(error),
          failedAt: Date.now()
        }
      });
    } else {
      clearStoredScanTask();
    }
    const message = recoverable
      ? `${diagnostic.message} 扫描断点将在24小时内保留。`
      : safeErrorMessage(error);
    writeScanStatus({
      isRunning: false,
      stopRequested: false,
      stage: recoverable ? "blocked" : "error",
      paused: recoverable,
      resumable: recoverable,
      diagnosticType: diagnostic.type,
      message,
      runId: storedTask?.runId || task?.runId,
      startedAt: storedTask?.startedAt || task?.startedAt,
      updatedAt: Date.now()
    });
    postProgress(storedTask || task || {}, recoverable ? "warning" : "error", message, {
      operation: "scan",
      stage: recoverable ? "blocked" : "error",
      paused: recoverable,
      resumable: recoverable,
      diagnosticType: diagnostic.type,
      impact: diagnostic.impact,
      suggestion: diagnostic.suggestion,
      keywordIndex: Number(storedTask?.currentIndex || 0) + 1,
      keywordTotal: scanKeywords(storedTask || task || {}).length,
      totalSaved: Number(storedTask?.totalSaved || task?.totalSaved || 0)
    });
  }

  async function runScan(message) {
    if (activeScanPromise) return activeScanPromise;

    activeScanPromise = runScanInternal(message).finally(() => {
      activeScanPromise = null;
    });
    return activeScanPromise;
  }

  async function runScanInternal(message) {
    let task = normalizeScanTask(message);
    const config = task.config || {};
    let keywords = scanKeywords(task);
    const runId = message.runId || String(Date.now());
    activeScanRunId = normalizeScanRunId(runId);
    const city = first(config.cityCode, "101280600");
    let currentIndex = normalizeTaskIndex(task.currentIndex, keywords.length);
    let totalSaved = Number(task.totalSaved || 0);

    if (!keywords.length) {
      throw new Error("Boss扫描缺少关键词，请先在Boss配置中填写关键词。");
    }

    if (await hasStopRequested(runId)) {
      stopRequested = true;
    }

    for (let index = currentIndex; index < keywords.length; index++) {
      if (isStopRequested(runId)) stopRequested = true;
      if (stopRequested) break;
      if (index > currentIndex || task.phase === "nextKeyword") {
        await humanPause(1500, 3000);
      }
      const keyword = keywords[index];
      markKeywordCursorCurrent(task, index, keyword);
      const url = buildSearchUrl(keyword, city, config);
      const navigationKey = buildNavigationKey(keyword, city);
      const navigationAttempts = task.navigationKey === navigationKey ? Number(task.navigationAttempts || 0) : 0;
      const nextNavigationAttempts = navigationAttempts + 1;
      const searchTaskState = {
        ...task,
        phase: "searching",
        currentIndex: index,
        totalSaved,
        navigationKey,
        navigationAttempts: nextNavigationAttempts,
        navigationStartedAt: Date.now(),
        expectedKeyword: keyword,
        expectedSearchUrl: url
      };
      const baseMeta = {
        operation: "scan",
        keyword,
        keywordIndex: index + 1,
        keywordTotal: keywords.length,
        totalSaved
      };
      writeScanStatus({
        isRunning: true,
        stopRequested: false,
        stage: "searching",
        message: `Boss Chrome正在搜索：${keyword}`,
        runId,
        keyword,
        keywordIndex: index + 1,
        keywordTotal: keywords.length,
        totalSaved,
        startedAt: task.startedAt,
        updatedAt: Date.now()
      });

      if (task.phase === "detail" || task.phase === "submitting") {
        if (isStopRequested(runId)) {
          stopRequested = true;
          break;
        }
        const detailResult = await continueBossDetailScan(task, keyword, runId, baseMeta);
        if (detailResult.pendingNavigation || detailResult.blocked) return detailResult;
        totalSaved = detailResult.totalSaved;
        if (!stopRequested) advanceKeywordCursor(task, index + 1, keyword);
        task = {
          ...task,
          phase: "nextKeyword",
          jobs: [],
          detailIndex: 0,
          currentIndex: index + 1,
          totalSaved
        };
        storeScanTask(task);
        continue;
      }

      const pageBlockDiagnostics = buildPageBlockDiagnostics();
      if (handleBlockingState(task, pageBlockDiagnostics, baseMeta)) {
        return { success: true, saved: totalSaved, blocked: true };
      }

      if (!isCurrentSearchPage(keyword, city, url)) {
        if (navigationAttempts >= SEARCH_NAVIGATION_MAX_ATTEMPTS) {
          const failedTaskState = {
            ...searchTaskState,
            navigationAttempts
          };
          return stopSearchNavigationFailure(failedTaskState, url);
        }
        postProgress(task, "info", `Boss Chrome准备打开搜索页：${keyword}（第 ${nextNavigationAttempts} 次导航），目标URL：${url}，当前URL：${window.location.href}`, {
          ...baseMeta,
          stage: "searching",
          currentUrl: window.location.href,
          targetUrl: url,
          navigationAttempts: nextNavigationAttempts
        });
        storeScanTask(searchTaskState);
        openSearchPage(url, searchTaskState);
        return { success: true, saved: totalSaved, pendingNavigation: true };
      }

      storeScanTask({ ...searchTaskState, phase: "collecting", navigationAttempts: 0, navigationStartedAt: 0 });
      postProgress(task, "info", `Boss Chrome开始搜索：${keyword}，当前URL：${window.location.href}`, {
        ...baseMeta,
        stage: "searching",
        currentUrl: window.location.href
      });
      await waitForPage();
      if (isStopRequested(runId)) {
        stopRequested = true;
        break;
      }
      postProgress(task, "info", "Boss搜索页已就绪，等待岗位列表加载。", {
        ...baseMeta,
        stage: "loading",
        currentUrl: window.location.href
      });
      const waitState = await waitForJobCards();
      if (isStopRequested(runId)) {
        stopRequested = true;
        break;
      }
      if (handleBlockingState(task, waitState.diagnostics, baseMeta)) {
        return { success: true, saved: totalSaved, blocked: true };
      }
      postProgress(task, "info", `Boss岗位列表加载检查完成，开始滚动采集。详情链接 ${waitState.diagnostics.detailLinks} 个，搜索结果容器 ${waitState.diagnostics.resultContainers} 个。`, {
        ...baseMeta,
        stage: "collecting",
        ...waitState.diagnostics
      });
      const searchJobLimit = normalizeSearchJobLimit(task.config?.searchJobLimit);
      await scrollForCards(searchJobLimit);
      if (isStopRequested(runId)) {
        stopRequested = true;
        break;
      }

      const collectResult = collectJobs(keyword, task, baseMeta, {
        maxNodes: bossDiscoveryCandidateLimit(searchJobLimit)
      });
      let candidates = collectResult.jobs;
      postProgress(task, "info", `Boss Chrome卡片解析完成：节点 ${collectResult.nodeCount} 个，页面脚本数据 ${collectResult.embeddedParsed || 0} 个，成功 ${collectResult.parsed} 个，跳过 ${collectResult.skipped} 个。搜索URL：${window.location.href}`, {
        ...baseMeta,
        stage: "collecting",
        currentUrl: window.location.href,
        targetUrl: url,
        nodeCount: collectResult.nodeCount,
        parsed: collectResult.parsed,
        embeddedParsed: collectResult.embeddedParsed || 0,
        skipped: collectResult.skipped,
        errorCount: collectResult.errorCount,
        missingSamples: collectResult.missingSamples
      });
      if (collectResult.nodeCount > 0 && collectResult.parsed === 0) {
        const sampleText = (collectResult.missingSamples || [])
          .map((item) => `第${item.index}张缺少${item.missing || "必要字段"}：${item.text || "无文本"}`)
          .join("；");
        postProgress(task, "warning", `Boss Chrome识别到岗位节点，但没有可进入详情页的候选岗位。${sampleText || "请检查Boss是否改版、登录是否失效或搜索结果是否为空。"}`, {
          ...baseMeta,
          stage: "collecting",
          nodeCount: collectResult.nodeCount,
          parsed: collectResult.parsed,
          skipped: collectResult.skipped,
          missingSamples: collectResult.missingSamples
        });
      }
      if (!candidates.length) {
        const clickFallbackResult = await collectBossJobsFromClickableCards(keyword, task, baseMeta, searchJobLimit);
        if (clickFallbackResult.jobs.length) {
          candidates = clickFallbackResult.jobs;
          postProgress(task, "success", `Boss Chrome通过点击卡片兜底采集到 ${candidates.length} 个岗位，将继续提交后台AI队列。点击 ${clickFallbackResult.clicked} 次，详情读取失败 ${clickFallbackResult.failed} 个。`, {
            ...baseMeta,
            stage: "collecting",
            collected: candidates.length,
            clicked: clickFallbackResult.clicked,
            failed: clickFallbackResult.failed
          });
        }
      }
      if (!candidates.length) {
        const diagnostics = buildListDiagnostics();
        if (handleBlockingState(task, diagnostics, baseMeta)) {
          return { success: true, saved: totalSaved, blocked: true };
        }
        if (!diagnostics.hasEmptyPrompt) {
          return pauseForPageStructureChange(task, diagnostics, {
            ...baseMeta,
            stage: "collecting",
            candidateCount: 0,
            parsedCount: collectResult.parsed || 0,
            missingFields: collectResult.missingSamples || []
          });
        }
        const emptyDiagnostic = buildBossDiagnostic("EMPTY_RESULTS", "collecting", diagnostics, {
          candidateCount: 0,
          parsedCount: 0
        });
        postProgress(task, "warning", emptyDiagnostic.message, {
          ...baseMeta,
          stage: "empty",
          diagnosticType: emptyDiagnostic.type,
          impact: emptyDiagnostic.impact,
          suggestion: emptyDiagnostic.suggestion,
          collected: 0,
          ...diagnostics
        });
        advanceKeywordCursor(task, index + 1, keyword);
        storeScanTask({ ...task, phase: "nextKeyword", currentIndex: index + 1, totalSaved });
        continue;
      }

      const discoveryResult = await collectFreshJobsForKeyword(keyword, task, baseMeta, searchJobLimit, candidates);
      candidates = discoveryResult.candidates;
      const freshCandidates = discoveryResult.jobs;
      const detailReadyCandidates = freshCandidates.filter(isDetailQueueJob);
      const invalidDetailCandidates = Math.max(0, freshCandidates.length - detailReadyCandidates.length);
      const jobs = detailReadyCandidates.slice(0, searchJobLimit);
      postProgress(task, discoveryResult.duplicateCount > 0 || discoveryResult.filteredCount > 0 ? "info" : "success", `Boss重复与条件检查完成：候选 ${discoveryResult.candidateCount} 个，学历不匹配 ${discoveryResult.filteredCount} 个，历史命中 ${discoveryResult.duplicateCount} 个，可补全 ${discoveryResult.enrichCount} 个，历史跳过 ${discoveryResult.skipCount} 个，新岗位 ${jobs.length}/${searchJobLimit} 个。`, {
        ...baseMeta,
        stage: "dedupe",
        collected: discoveryResult.candidateCount,
        conditionFiltered: discoveryResult.filteredCount,
        duplicates: discoveryResult.duplicateCount,
        enrich: discoveryResult.enrichCount,
        skippedDuplicates: discoveryResult.skipCount,
        fresh: freshCandidates.length,
        invalidDetailCandidates,
        searchJobLimit,
        discoveryRounds: discoveryResult.rounds,
        stoppedByStagnation: discoveryResult.stoppedByStagnation
      });
      if (!jobs.length) {
        postProgress(task, "warning", `Boss关键词 ${keyword} 已继续向下采集，但没有找到新的可分析岗位，跳过本关键词。`, {
          ...baseMeta,
          stage: "dedupe",
          collected: discoveryResult.candidateCount,
          conditionFiltered: discoveryResult.filteredCount,
          duplicates: discoveryResult.duplicateCount,
          invalidDetailCandidates,
          fresh: 0
        });
        advanceKeywordCursor(task, index + 1, keyword);
        storeScanTask({ ...task, phase: "nextKeyword", currentIndex: index + 1, totalSaved });
        continue;
      }

      const diagnostics = buildListDiagnostics();
      postProgress(task, "info", `Boss Chrome采集到 ${discoveryResult.candidateCount} 个候选岗位，学历过滤 ${discoveryResult.filteredCount} 个，历史跳过 ${discoveryResult.skipCount} 个，剩余 ${freshCandidates.length} 个可分析岗位，将进入前 ${jobs.length}/${searchJobLimit} 个详情页做AI比对。详情链接 ${diagnostics.detailLinks} 个。`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
        candidates: discoveryResult.candidateCount,
        conditionFiltered: discoveryResult.filteredCount,
        fresh: freshCandidates.length,
        invalidDetailCandidates,
        duplicates: discoveryResult.duplicateCount,
        skippedDuplicates: discoveryResult.skipCount,
        searchJobLimit,
        ...diagnostics
      });

      const detailTask = {
        ...task,
        currentIndex: index,
        totalSaved,
        navigationKey,
        phase: "detail",
        detailIndex: 0,
        jobs,
        searchUrl: url
      };
      storeScanTask(detailTask);
      return continueBossDetailScan(detailTask, keyword, runId, baseMeta);
    }

    if (isStopRequested(runId)) stopRequested = true;

    if (!stopRequested && shouldAppendAiKeywords(task) && !task.aiKeywordsLoaded) {
      const aiResult = await appendAiKeywords(task, keywords);
      task = aiResult.task;
      keywords = aiResult.keywords;
      if (Number(task.currentIndex || 0) < keywords.length) {
        return runScanInternal(task);
      }
    }

    if (!stopRequested) {
      advanceKeywordCursor(task, userKeywordCount(task), "");
    }
    clearStoredScanTask();
    const stopped = stopRequested;
    if (stopped) clearStopRequested();
    writeScanStatus({
      isRunning: false,
      stopRequested: stopped,
      stage: stopped ? "stopped" : "complete",
      message: stopped ? `Boss Chrome扫描已停止，已提交 ${totalSaved} 个岗位` : `Boss Chrome扫描完成，已提交 ${totalSaved} 个岗位`,
      runId,
      keywordTotal: keywords.length,
      totalSaved,
      saved: totalSaved,
      startedAt: task.startedAt,
      updatedAt: Date.now()
    });
    postProgress(task, stopped ? "warning" : "success", stopped ? `Boss Chrome扫描已停止，已提交 ${totalSaved} 个岗位` : `Boss Chrome扫描完成，已提交 ${totalSaved} 个岗位`, {
      operation: "scan",
      stage: stopped ? "stopped" : "complete",
      keywordTotal: keywords.length,
      totalSaved,
      saved: totalSaved
    });
    return { success: true, saved: totalSaved };
  }

  function buildSearchUrl(keyword, city, config) {
    const params = new URLSearchParams();
    params.set("city", city);
    if (config.jobType) params.set("jobType", config.jobType);
    addList(params, "salary", config.salary);
    addList(params, "experience", config.experience);
    addList(params, "degree", config.degree);
    addList(params, "scale", config.scale);
    addList(params, "industry", config.industry);
    addList(params, "stage", config.stage);
    params.set("query", keyword);
    return `https://www.zhipin.com/web/geek/job?${params.toString()}`;
  }

  function collectJobs(keyword, message, baseMeta, options = {}) {
    const nodes = collectJobNodes();
    const embeddedJobs = collectBossEmbeddedListJobs(keyword);
    const jobs = [];
    const seenJobs = new Set();
    let skipped = 0;
    let errorCount = 0;
    const missingSamples = [];
    const maxNodes = Math.max(1, Number(options.maxNodes || Math.max(40, normalizeSearchJobLimit(message?.config?.searchJobLimit))));
    const warnLimit = Number.isFinite(Number(options.warnLimit)) ? Number(options.warnLimit) : 3;
    embeddedJobs.forEach((job) => {
      const key = bossCandidateKey(job);
      if (!key || seenJobs.has(key)) return;
      seenJobs.add(key);
      jobs.push(job);
    });
    nodes.slice(0, maxNodes).forEach((node, index) => {
      try {
        const job = parseCard(node, keyword);
        const key = bossCandidateKey(job);
        if (isListCandidateJob(job) && key && !seenJobs.has(key)) {
          seenJobs.add(key);
          jobs.push(job);
        } else {
          skipped += 1;
          if (missingSamples.length < 3) {
            missingSamples.push({
              index: index + 1,
              missing: missingCardFields(job).join("、"),
              text: trimToUsefulLength(job?.description || compact(node?.innerText || node?.textContent || ""), 120)
            });
          }
        }
      } catch (error) {
        skipped += 1;
        errorCount += 1;
        if (warnLimit > 0 && errorCount <= warnLimit) {
          postProgress(message, "warning", `Boss Chrome跳过第 ${index + 1} 张岗位卡片：${error.message || String(error)}`, {
            ...baseMeta,
            stage: "collecting",
            cardIndex: index + 1
          });
        }
      }
    });
    return {
      jobs,
      nodeCount: nodes.length,
      parsed: jobs.length,
      skipped,
      errorCount,
      missingSamples,
      embeddedParsed: embeddedJobs.length
    };
  }

  function collectJobNodes() {
    const nodes = [];
    Array.from(document.querySelectorAll("a[href*='/job_detail/'], a[href*='job_detail']"))
      .map(jobCardRoot)
      .forEach((node) => nodes.push(node));
    JOB_CARD_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .map(jobCardRoot)
      .forEach((node) => nodes.push(node));
    return unique(nodes).filter(Boolean).filter(isLikelyJobCardNode);
  }

  function collectBossEmbeddedListJobs(keyword) {
    const states = extractBossListStates();
    const jobs = [];
    const seen = new Set();
    states.forEach((state) => {
      findBossListJobItems(state).forEach((item) => {
        const job = mapBossStateJob(item, keyword);
        const key = bossCandidateKey(job);
        if (!isListCandidateJob(job) || !key || seen.has(key)) return;
        seen.add(key);
        jobs.push(job);
      });
    });
    return jobs;
  }

  function extractBossListStates() {
    const states = [];
    Array.from(document.querySelectorAll("script[type='application/json'], script#__NEXT_DATA__, script")).forEach((script) => {
      const raw = String(script.textContent || "").trim();
      if (!raw || raw.length < 50) return;
      // 放宽匹配：除了 jobList/jobInfo/zpData，也匹配 encryptJobId/brandName/salaryDesc 等岗位特征字段
      const hasJobSignal = /jobList|jobInfo|zpData/i.test(raw);
      const hasJobFieldSignal = /\bencryptJobId\b|\bencryptId\b|\bjobId\b|\bsecurityId\b/i.test(raw)
        && /\bbrandName\b|\bcompanyName\b/i.test(raw);
      if (!hasJobSignal && !hasJobFieldSignal) return;
      const jsonTexts = [];
      if (raw.startsWith("{") || raw.startsWith("[")) jsonTexts.push(raw);
      const nextJson = extractJsonObjectAfter(raw, "__NEXT_DATA__");
      if (nextJson) jsonTexts.push(nextJson);
      const initialJson = extractJsonObjectAfter(raw, "__INITIAL_STATE__");
      if (initialJson) jsonTexts.push(initialJson);
      const zpJson = extractJsonObjectAfter(raw, "zpData");
      if (zpJson) jsonTexts.push(zpJson);
      jsonTexts.forEach((jsonText) => {
        try {
          states.push(JSON.parse(jsonText));
        } catch {
          // Executable scripts are ignored; DOM and click fallbacks remain available.
        }
      });
    });
    return states;
  }

  function findBossListJobItems(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 7) return [];
    if (Array.isArray(value)) {
      if (value.some(isBossStateJobItem)) return value.filter(isBossStateJobItem);
      return value.flatMap((item) => findBossListJobItems(item, depth + 1));
    }
    const out = [];
    Object.entries(value).forEach(([key, child]) => {
      if (Array.isArray(child) && /job|list|data|result/i.test(key) && child.some(isBossStateJobItem)) {
        out.push(...child.filter(isBossStateJobItem));
      } else if (child && typeof child === "object") {
        out.push(...findBossListJobItems(child, depth + 1));
      }
    });
    return out;
  }

  function isBossStateJobItem(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const title = bossStateText(item, ["jobName", "name", "title", "jobInfo.jobName"]);
    const company = bossStateText(item, ["brandName", "companyName", "brand.brandName", "brandComInfo.brandName", "jobInfo.brandName"]);
    const id = bossStateText(item, ["encryptJobId", "encryptId", "jobId", "securityId", "jobInfo.encryptId", "jobInfo.securityId"]);
    const url = bossStateText(item, ["jobUrl", "detailUrl", "url", "href"]);
    return Boolean(title && (company || id || url));
  }

  function mapBossStateJob(item, keyword) {
    const jobInfo = item.jobInfo || item.jobDetail || item.job || item;
    const brand = item.brandComInfo || item.brandInfo || item.brand || item.companyInfo || {};
    const bossInfo = item.bossInfo || item.recruiterInfo || item.userInfo || {};
    const id = compact(
      bossStateText(item, ["encryptJobId", "encryptId", "jobId", "securityId", "jobInfo.encryptId", "jobInfo.jobId", "jobInfo.securityId"])
        || jobInfo.encryptId
        || jobInfo.jobId
        || jobInfo.securityId
    );
    const rawUrl = bossStateText(item, ["jobUrl", "detailUrl", "url", "href"]);
    const url = normalizeBossJobUrl(rawUrl) || bossJobUrlFromId(id);
    return {
      id,
      title: compact(jobInfo.jobName || jobInfo.name || jobInfo.title || bossStateText(item, ["jobName", "name", "title"])),
      company: compact(brand.brandName || brand.companyName || brand.name || jobInfo.brandName || bossStateText(item, ["brandName", "companyName"])),
      salary: compact(jobInfo.salaryDesc || jobInfo.salary || jobInfo.salaryName || bossStateText(item, ["salaryDesc", "salary", "salaryName"])),
      location: compact(jobInfo.locationName || jobInfo.cityName || jobInfo.address || bossStateText(item, ["locationName", "cityName", "areaDistrict"])),
      experience: compact(jobInfo.experienceName || jobInfo.experience || bossStateText(item, ["experienceName", "experience"])),
      degree: compact(jobInfo.degreeName || jobInfo.degree || bossStateText(item, ["degreeName", "degree"])),
      hrName: compact(bossInfo.name || bossInfo.bossName || bossInfo.recruiterName),
      hrTitle: compact(bossInfo.title || bossInfo.position || bossInfo.identity),
      hrActive: compact(bossInfo.activeTimeDesc || bossInfo.activeTime || bossInfo.lastLoginTimeDesc),
      description: trimToUsefulLength(stripHtml(jobInfo.postDescription || jobInfo.description || jobInfo.jobDescription || ""), 8000),
      companyInfo: trimToUsefulLength(stripHtml(brand.introduce || brand.companyIntroduce || brand.description || ""), 3000),
      industry: compact(brand.industryName || brand.industry),
      financingStage: compact(brand.stageName || brand.financingStage || brand.financeStage),
      companyScale: compact(brand.scaleName || brand.scale),
      deliveryStatus: "",
      url,
      keyword,
      source: "boss-embedded-state",
      salarySource: "embedded_state"
    };
  }

  async function collectBossJobsFromClickableCards(keyword, message, baseMeta, searchJobLimit, options = {}) {
    const limit = normalizeSearchJobLimit(searchJobLimit);
    const maxClicks = Math.max(1, Number(options.maxClicks || Math.max(12, limit)));
    const nodes = collectJobNodes().slice(0, maxClicks);
    const jobs = [];
    const seen = new Set();
    let clicked = 0;
    let failed = 0;

    for (let index = 0; index < nodes.length && jobs.length < limit && !isStopRequested(message?.runId); index++) {
      const node = nodes[index];
      const target = findBossCardClickTarget(node);
      if (!target) {
        failed += 1;
        continue;
      }
      const listJob = parseCard(node, keyword);
      const beforeSignature = bossDetailSignature();
      postProgress(message, "info", `Boss Chrome列表卡片缺少详情链接，尝试点击第 ${index + 1}/${nodes.length} 张卡片读取详情。`, {
        ...baseMeta,
        stage: "collecting",
        cardIndex: index + 1,
        nodeCount: nodes.length
      });
      try {
        clickBossCardTarget(target);
        clicked += 1;
        await waitForBossDetailChange(beforeSignature, listJob, 5000);
        const enriched = await enrichBossJobFromCurrentDetail({
          ...listJob,
          url: listJob.url || bossJobUrlFromId(listJob.id),
          keyword
        }, message, baseMeta, jobs.length + 1, limit);
        const normalized = {
          ...enriched,
          url: normalizeBossJobUrl(enriched.url) || bossJobUrlFromId(enriched.id) || listJob.url
        };
        const key = bossCandidateKey(normalized);
        if (isSubmittableJob(normalized) && key && !seen.has(key)) {
          seen.add(key);
          jobs.push(normalized);
        } else {
          failed += 1;
        }
        if (isBossDetailPageUrl(window.location.href)) break;
      } catch (error) {
        failed += 1;
        postProgress(message, "warning", `Boss Chrome点击卡片读取详情失败：第 ${index + 1} 张，${error.message || String(error)}`, {
          ...baseMeta,
          stage: "details",
          cardIndex: index + 1
        });
      }
      await humanPause(350, 800);
    }
    return { jobs, clicked, failed };
  }

  async function collectFreshJobsForKeyword(keyword, message, baseMeta, searchJobLimit, initialCandidates = []) {
    const target = normalizeSearchJobLimit(searchJobLimit);
    const maxRounds = bossDiscoveryMaxRounds(target);
    const maxCandidates = bossDiscoveryCandidateLimit(target);
    const allCandidates = new Map();
    const processableJobs = new Map();
    const duplicateKeys = new Set();
    const enrichKeys = new Set();
    const skipKeys = new Set();
    const conditionFilteredKeys = new Set();
    let lastUniqueCount = -1;
    let lastScrollSignature = "";
    let stagnantRounds = 0;
    let stoppedByStagnation = false;
    let roundsRan = 0;

    addUniqueJobs(allCandidates, initialCandidates, maxCandidates);

    for (let round = 0; round < maxRounds && processableJobs.size < target && allCandidates.size < maxCandidates && !isStopRequested(); round++) {
      roundsRan = round + 1;
      if (round > 0) {
        await scrollForMoreBossCards(round);
        const collectResult = collectJobs(keyword, message, baseMeta, {
          maxNodes: maxCandidates,
          warnLimit: 0
        });
        addUniqueJobs(allCandidates, collectResult.jobs, maxCandidates);
      }

      const filterResult = filterJobsByScanConfig(Array.from(allCandidates.values()), message?.config || {});
      filterResult.rejected.forEach((job) => {
        const key = dedupeJobKey(job);
        if (key) conditionFilteredKeys.add(key);
      });

      const pendingDedupe = filterResult.jobs.filter((job) => {
        const key = dedupeJobKey(job);
        return key && !processableJobs.has(key) && !skipKeys.has(key);
      });
      const dedupeResult = await filterDuplicateJobs(pendingDedupe, message, baseMeta);
      const itemByKey = new Map((dedupeResult.items || []).map((item) => [dedupeItemKey(item), item]));

      pendingDedupe.forEach((job) => {
        const key = dedupeJobKey(job);
        if (!key) return;
        const item = itemByKey.get(key);
        const action = String(item?.action || (item?.duplicate ? "SKIP" : "NEW")).toUpperCase();
        if (item?.duplicate) duplicateKeys.add(key);
        if (action === "ENRICH") enrichKeys.add(key);
        if (action === "SKIP") {
          skipKeys.add(key);
          return;
        }
        processableJobs.set(key, job);
      });

      const currentScrollSignature = bossScrollSignature();
      const noNewCandidates = allCandidates.size === lastUniqueCount && currentScrollSignature === lastScrollSignature;
      stagnantRounds = noNewCandidates ? stagnantRounds + 1 : 0;
      lastUniqueCount = allCandidates.size;
      lastScrollSignature = currentScrollSignature;

      if (round > 0 || skipKeys.size || conditionFilteredKeys.size) {
        postProgress(message, "info", `Boss继续采集 ${keyword}：第 ${round + 1}/${maxRounds} 轮，候选 ${allCandidates.size} 个，学历不匹配 ${conditionFilteredKeys.size} 个，历史跳过 ${skipKeys.size} 个，可分析 ${processableJobs.size}/${target} 个。`, {
          ...baseMeta,
          stage: "collecting",
          discoveryRound: round + 1,
          collected: allCandidates.size,
          conditionFiltered: conditionFilteredKeys.size,
          skippedDuplicates: skipKeys.size,
          fresh: processableJobs.size,
          searchJobLimit: target
        });
      }

      if (stagnantRounds >= 2) {
        stoppedByStagnation = true;
        break;
      }
    }

    resetBossScrollPosition();
    return {
      candidates: Array.from(allCandidates.values()),
      jobs: Array.from(processableJobs.values()).slice(0, target),
      candidateCount: allCandidates.size,
      filteredCount: conditionFilteredKeys.size,
      duplicateCount: duplicateKeys.size,
      enrichCount: enrichKeys.size,
      skipCount: skipKeys.size,
      rounds: roundsRan,
      stoppedByStagnation
    };
  }

  function addUniqueJobs(target, jobs, maxSize) {
    (Array.isArray(jobs) ? jobs : []).forEach((job) => {
      if (target.size >= maxSize) return;
      if (!isListCandidateJob(job)) return;
      const key = dedupeJobKey(job);
      if (key && !target.has(key)) target.set(key, job);
    });
  }

  function filterJobsByScanConfig(jobs, config) {
    const accepted = [];
    const rejected = [];
    (Array.isArray(jobs) ? jobs : []).forEach((job) => {
      if (isJobAllowedByDegree(job, config)) accepted.push(job);
      else rejected.push(job);
    });
    return { jobs: accepted, rejected };
  }

  function isJobAllowedByDegree(job, config) {
    const selected = normalizeConfiguredDegrees(config?.degree);
    if (!selected.length || selected.some((item) => item === "不限" || item === "学历不限")) return true;
    const jobDegree = normalizeJobDegree(job?.degree);
    if (!jobDegree || jobDegree === "不限" || jobDegree === "学历不限") return true;
    if (selected.includes("本科") && (jobDegree === "硕士" || jobDegree === "博士")) return false;
    return selected.includes(jobDegree);
  }

  function normalizeConfiguredDegrees(value) {
    return uniqueStrings(toList(value).map(normalizeDegreeValue).filter(Boolean));
  }

  function normalizeDegreeValue(value) {
    const text = compact(value);
    if (!text) return "不限";
    const degreeName = typeof SCAN_SUPPORT.degreeNameForCode === "function"
      ? SCAN_SUPPORT.degreeNameForCode(text)
      : "";
    if (degreeName) return degreeName;
    return normalizeJobDegree(text) || text;
  }

  function normalizeJobDegree(value) {
    const text = compact(value);
    if (!text) return "";
    if (/学历不限|不限/.test(text)) return "学历不限";
    if (/博士/.test(text)) return "博士";
    if (/硕士|研究生/.test(text)) return "硕士";
    if (/本科/.test(text)) return "本科";
    if (/大专|专科/.test(text)) return "大专";
    if (/高中/.test(text)) return "高中";
    if (/中专|中技/.test(text)) return "中专/中技";
    if (/初中/.test(text)) return "初中及以下";
    return text;
  }

  function bossDiscoveryCandidateLimit(searchJobLimit) {
    const limit = normalizeSearchJobLimit(searchJobLimit);
    return Math.min(300, Math.max(80, limit * 8));
  }

  function bossDiscoveryMaxRounds(searchJobLimit) {
    const limit = normalizeSearchJobLimit(searchJobLimit);
    return Math.min(18, Math.max(6, Math.ceil(limit / 5) + 5));
  }

  async function scrollForMoreBossCards(round = 0) {
    const viewportHeight = Number(window.innerHeight || document.documentElement?.clientHeight || 0);
    const scrollStep = Math.max(520, Math.min(1100, Math.floor(viewportHeight * 0.95) || 720));
    scrollBossResults(scrollStep);
    await humanPause(650, 1100);
    if (round % 3 === 2) {
      scrollBossResults(scrollStep, { bottom: true });
      await humanPause(800, 1300);
    }
  }

  async function filterDuplicateJobs(jobs, message, baseMeta) {
    const list = Array.isArray(jobs) ? jobs : [];
    if (!list.length) return { jobs: [], duplicateCount: 0, enrichCount: 0, skipCount: 0, items: [] };

    try {
      const data = await callBossLocalApi("chrome-jobs-dedupe", {
        runId: message?.runId,
        keyword: baseMeta.keyword,
        jobs: list.map(normalizeJobForDedupe)
      }, {
        pageTabId: message?.pageTabId
      });
      if (!data.success || !Array.isArray(data.items)) throw new Error(data.message || "查重接口返回异常");

      const decisions = new Map(data.items.map((item) => [dedupeItemKey(item), String(item.action || (item.duplicate ? "SKIP" : "NEW"))]));
      const freshJobs = list.filter((job) => decisions.get(dedupeJobKey(job)) !== "SKIP");
      return {
        jobs: freshJobs,
        duplicateCount: Number(data.duplicateCount ?? 0),
        enrichCount: Number(data.enrichCount ?? data.items.filter((item) => item.action === "ENRICH").length),
        skipCount: Number(data.skipCount ?? data.items.filter((item) => item.action === "SKIP").length),
        items: data.items
      };
    } catch (error) {
      postProgress(message, "warning", `Boss重复岗位检查失败，将继续扫描本页岗位：${error.message || String(error)}`, {
        ...baseMeta,
        stage: "dedupe",
        collected: list.length
      });
      return {
        jobs: list,
        duplicateCount: 0,
        enrichCount: 0,
        skipCount: 0,
        items: list.map((job) => ({
          id: job?.id || extractBossId(job?.url),
          url: job?.url || "",
          title: job?.title || "",
          company: job?.company || "",
          duplicate: false,
          action: "NEW"
        }))
      };
    }
  }

  function dedupeItemKey(item) {
    return dedupeKey(item?.id, item?.company, item?.title, item?.url);
  }

  function dedupeJobKey(job) {
    return dedupeKey(job?.id, job?.company, job?.title, job?.url);
  }

  function normalizeJobForDedupe(job) {
    return {
      id: compact(job?.id || extractBossId(job?.url)),
      url: job?.url || "",
      title: compact(job?.title),
      company: compact(job?.company),
      deliveryStatus: normalizePlatformDeliveryStatus(job?.deliveryStatus),
      keyword: job?.keyword || ""
    };
  }

  function dedupeKey(id, company, title, url) {
    const bossId = compact(id || extractBossId(url));
    if (bossId) return `id:${bossId}`;
    return `ct:${compact(company).toLowerCase()}::${compact(title).toLowerCase()}`;
  }

  function bossCandidateKey(job) {
    const id = compact(job?.id || extractBossId(job?.url));
    if (id) return `id:${id}`;
    const url = compact(job?.url);
    if (url) return `url:${url}`;
    const title = compact(job?.title);
    const company = compact(job?.company);
    if (title || company) return `ct:${company.toLowerCase()}::${title.toLowerCase()}`;
    return "";
  }

  function parseCard(node, keyword) {
    const root = jobCardRoot(node);
    const link = findJobDetailLink(root, node);
    const text = compact(root.innerText || root.textContent || "");
    const lines = cardTextLines(root);
    let url = normalizeBossJobUrl(
      link?.getAttribute("href")
        || link?.href
        || attrText(root, ["data-url", "data-href", "href"])
        || extractJobUrlFromText(text)
    );
    const id = compact(
      extractBossId(url)
        || attrText(root, ["data-jobid", "data-job-id", "data-jid", "data-id", "data-encrypt-id"])
    );
    if (!url && id) url = `https://www.zhipin.com/job_detail/${id}.html`;
    const salary = textOf(root, [".salary", ".job-salary", "[class*='salary']"]) || guessSalary(text);
    const title = inferCardTitle(root, link, lines, text, salary);
    const company = inferCardCompany(root, lines, title, salary);
    const tags = inferCardTags(root, lines, text);
    const deliveryStatus = detectBossDeliveryStatus(root);
    return {
      id,
      title,
      company,
      salary,
      location: tags.location,
      experience: tags.experience,
      degree: tags.degree,
      hrName: textOf(root, [".boss-name", "[class*='boss-name']", "[class*='recruiter']"]),
      hrTitle: "",
      hrActive: "",
      description: text,
      deliveryStatus,
      url,
      keyword,
      source: "boss-dom-card",
      salarySource: "dom_untrusted"
    };
  }

  function isListCandidateJob(job) {
    const title = compact(job?.title);
    const url = normalizeBossJobUrl(job?.url);
    if (!isBossJobDetailUrl(url)) return false;
    if (!title || isInvalidBossCandidateTitle(title) || isBossNonJobNavigationTitle(title)) return false;
    return Boolean(compact(job?.company) || compact(job?.description));
  }

  function isDetailQueueJob(job) {
    return isListCandidateJob(job) && !job?.detailNavigationFailed;
  }

  function isInvalidBossCandidateTitle(title) {
    const text = compact(title);
    if (!text) return false;
    if (/^(职位搜索|搜索职位|职位列表|职位详情|找工作|招聘|首页|登录|注册|访问异常|安全验证)$/i.test(text)) return true;
    return /^(BOSS|Boss)直聘/.test(text) || /找工作.*招聘|招聘.*找工作/.test(text);
  }

  function missingCardFields(job) {
    const missing = [];
    if (!compact(job?.url) || !isBossJobDetailUrl(job.url)) missing.push("详情链接");
    if (!compact(job?.title)) missing.push("岗位名");
    if (!compact(job?.company)) missing.push("公司名");
    return missing;
  }

  function findBossCardClickTarget(root) {
    const link = findJobDetailLink(root, root);
    if (link && !isBossUnsafeCardAction(link)) return link;
    const selectors = [
      ".job-name",
      ".job-title",
      "[class*='job-name']",
      "[class*='job-title']",
      "[ka*='job-name']",
      ".job-card-body",
      "[class*='job-card-body']",
      "[class*='job-card-left']",
      "[class*='job-info']",
      "a[href]",
      "[role='button']",
      "button"
    ];
    for (const selector of selectors) {
      const node = Array.from(root?.querySelectorAll?.(selector) || [])
        .find((item) => item.offsetParent !== null && !isBossUnsafeCardAction(item));
      if (node) return node;
    }
    return isBossUnsafeCardAction(root) ? null : root;
  }

  function isBossUnsafeCardAction(node) {
    const text = compact([
      node?.innerText,
      node?.textContent,
      node?.getAttribute?.("aria-label"),
      node?.getAttribute?.("title"),
      node?.getAttribute?.("ka")
    ].filter(Boolean).join(" "));
    return /立即沟通|继续沟通|沟通|感兴趣|不感兴趣|收藏|投递|举报|屏蔽/.test(text);
  }

  function clickBossCardTarget(target) {
    if (!target) throw new Error("未找到可点击的岗位卡片区域");
    target.scrollIntoView?.({ block: "center", inline: "center" });
    target.focus?.();
    const options = { bubbles: true, cancelable: true, view: window };
    try {
      target.dispatchEvent(new PointerEvent("pointerdown", options));
    } catch {
      // Older Chromium pages may not expose PointerEvent in isolated worlds.
    }
    target.dispatchEvent(new MouseEvent("mouseover", options));
    target.dispatchEvent(new MouseEvent("mousedown", options));
    target.dispatchEvent(new MouseEvent("mouseup", options));
    try {
      target.dispatchEvent(new PointerEvent("pointerup", options));
    } catch {
      // Older Chromium pages may not expose PointerEvent in isolated worlds.
    }
    target.dispatchEvent(new MouseEvent("click", options));
    target.click?.();
  }

  async function waitForBossDetailChange(beforeSignature, job, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs && !isStopRequested()) {
      if (isBossDetailPageUrl(window.location.href)) return true;
      const nextSignature = bossDetailSignature();
      if (nextSignature && nextSignature !== beforeSignature && bossDetailLooksUseful(job)) return true;
      const latestDetailResource = latestBossDetailResourceName();
      if (latestDetailResource) return true;
      await sleep(250);
    }
    return false;
  }

  function bossDetailSignature() {
    const text = compact([
      textOf(document, [".job-detail", ".job-detail-section", ".job-sec", "[class*='job-detail']", "[class*='job-sec']"]),
      document.title,
      window.location.href
    ].filter(Boolean).join(" "));
    return text.slice(0, 500);
  }

  function bossDetailLooksUseful(job) {
    const text = compact(document.body?.innerText || "");
    if (!text) return false;
    return /职位描述|岗位职责|岗位要求|任职要求|工作内容|公司介绍/.test(text)
      || Boolean(compact(job?.title) && text.includes(compact(job.title)));
  }

  function latestBossDetailResourceName() {
    return Array.from(performance.getEntriesByType?.("resource") || [])
      .map((entry) => entry.name)
      .reverse()
      .find((name) => String(name || "").includes("/wapi/zpgeek/job/detail.json")) || "";
  }

  function findJobDetailLink(root, fallbackNode) {
    const selectors = "a[href*='/job_detail/'], a[href*='job_detail']";
    if (fallbackNode?.matches?.(selectors)) return fallbackNode;
    const direct = root?.querySelector?.(selectors);
    if (direct) return direct;
    return Array.from(root?.querySelectorAll?.("a[href], [data-url], [data-href]") || [])
      .find((node) => /job_detail/i.test(attrText(node, ["href", "data-url", "data-href"]) || "")) || null;
  }

  function normalizeBossJobUrl(value) {
    if (SCAN_SUPPORT.normalizeBossJobUrl) {
      return SCAN_SUPPORT.normalizeBossJobUrl(value, window.location.origin);
    }
    const raw = String(value || "").trim();
    if (!raw) return "";
    const match = raw.match(/https?:\/\/[^\s"'<>]*job_detail[^\s"'<>]*/i)
      || raw.match(/\/[^\s"'<>]*job_detail[^\s"'<>]*/i);
    const candidate = match ? match[0] : raw;
    if (!/job_detail/i.test(candidate)) return "";
    try {
      const parsed = new URL(candidate, window.location.origin);
      parsed.hash = "";
      if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("zhipin.com")) return "";
      if (!parsed.pathname.includes("/job_detail/")) return "";
      return parsed.href;
    } catch {
      return "";
    }
  }

  function bossJobUrlFromId(id) {
    const value = compact(id);
    return value ? `https://www.zhipin.com/job_detail/${value}.html` : "";
  }

  function isBossDetailPageUrl(url) {
    return isBossJobDetailUrl(url || window.location.href);
  }

  function isBossJobDetailUrl(url) {
    if (SCAN_SUPPORT.isBossJobDetailUrl) {
      return SCAN_SUPPORT.isBossJobDetailUrl(url, window.location.origin);
    }
    try {
      const parsed = new URL(url || window.location.href, window.location.origin);
      return parsed.protocol === "https:"
        && parsed.hostname.endsWith("zhipin.com")
        && parsed.pathname.includes("/job_detail/")
        && Boolean(extractBossId(parsed.href));
    } catch {
      return Boolean(extractBossId(url || ""));
    }
  }

  function isBossNonJobNavigationTitle(title) {
    if (SCAN_SUPPORT.isNonJobNavigationTitle) return SCAN_SUPPORT.isNonJobNavigationTitle(title);
    return /^(职位搜索|搜索职位|岗位搜索|搜索岗位|职位|岗位|工作搜索|公司搜索|搜索公司|全部职位|全部岗位|返回列表)$/.test(compact(title));
  }

  function extractJobUrlFromText(text) {
    const source = String(text || "");
    const match = source.match(/https?:\/\/[^\s"'<>]*job_detail[^\s"'<>]*/i)
      || source.match(/\/[^\s"'<>]*job_detail[^\s"'<>]*/i);
    return match ? match[0] : "";
  }

  function attrText(node, names) {
    for (const name of names) {
      const value = node?.getAttribute?.(name);
      if (value) return compact(value);
    }
    return "";
  }

  function cardTextLines(root) {
    return String(root?.innerText || root?.textContent || "")
      .split(/\n+/)
      .map(compact)
      .filter(Boolean)
      .filter((line, index, lines) => lines.indexOf(line) === index);
  }

  function inferCardTitle(root, link, lines, text, salary) {
    const title = firstNonEmpty(
      textOf(root, [".job-name", ".job-title", "[class*='job-name']", "[class*='job-title']", "[ka*='job-name']"]),
      compact(link?.innerText || link?.textContent || ""),
      attrText(link, ["title", "aria-label"]),
      lines.find((line) => isLikelyJobTitleLine(line, salary)),
      firstLine(text)
    );
    return cleanCardField(title, salary);
  }

  function inferCardCompany(root, lines, title, salary) {
    const company = firstNonEmpty(
      textOf(root, [".company-name", "[class*='company-name']", "[class*='brand-name']", "[class*='company-title']", "[ka*='company']"]),
      attrText(root, ["data-company", "data-company-name", "data-brand-name"]),
      lines.find((line) => isLikelyCompanyLine(line, title, salary)),
      guessCompany(lines.join(" "))
    );
    return cleanCardField(company, salary);
  }

  function inferCardTags(root, lines, text) {
    const tagText = firstNonEmpty(
      textOf(root, [".job-area", ".company-location", "[class*='location']", ".tag-list", "[class*='tag-list']", "[class*='job-tags']"]),
      lines.join(" "),
      text
    );
    return {
      location: firstMatch(tagText, /(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|长沙|重庆|天津|郑州|厦门|合肥|佛山|东莞|珠海|中山|全国|远程)[^\s，,。]*/),
      experience: firstMatch(tagText, /(经验不限|不限经验|在校\/应届|应届|[0-9]+-[0-9]+年|[0-9]+年以内|[0-9]+年以上)/),
      degree: firstMatch(tagText, /(学历不限|本科|大专|硕士|博士|高中|中专)/)
    };
  }

  function isLikelyJobTitleLine(line, salary) {
    const value = cleanCardField(line, salary);
    if (!value || value.length > 80) return false;
    if (isNoisyCardLine(value)) return false;
    if (isLikelyCompanyLine(value, "", salary)) return false;
    return /工程师|开发|运营|产品|经理|设计|测试|销售|顾问|算法|前端|后端|全栈|Java|Python|Go|C\+\+|Android|iOS|数据|实习|专员|主管|总监/i.test(value)
      || value.length <= 30;
  }

  function isLikelyCompanyLine(line, title, salary) {
    const value = cleanCardField(line, salary);
    if (!value || value === compact(title) || value.length > 80) return false;
    if (isNoisyCardLine(value)) return false;
    return /公司|集团|科技|网络|信息|咨询|有限|股份|软件|智能|数据|传媒|教育|金融|电子|电商|服务|中心|工作室|Inc\.?|Ltd\.?/i.test(value);
  }

  function isNoisyCardLine(line) {
    return /经验|学历|本科|大专|硕士|博士|薪|K|面议|招聘|刚刚|今日|活跃|在线|发布|收藏|感兴趣|立即沟通|继续沟通|已沟通|已投递/.test(line);
  }

  function cleanCardField(value, salary) {
    return compact(String(value || "").replace(salary || "", "").replace(/立即沟通|继续沟通|感兴趣|收藏/g, ""));
  }

  async function continueBossDetailScan(message, keyword, runId, baseMeta) {
    const jobs = Array.isArray(message.jobs) ? message.jobs : [];
    const detailIndex = Number(message.detailIndex || 0);
    const totalSaved = Number(message.totalSaved || 0);

    activeScanRunId = normalizeScanRunId(runId || message.runId || activeScanRunId);

    if (isStopRequested(runId)) {
      stopRequested = true;
      clearStoredScanTask();
      return { success: true, totalSaved };
    }

    if (!jobs.length) {
      advanceKeywordCursor(message, Number(message.currentIndex || 0) + 1, keyword);
      storeScanTask({ ...message, phase: "", currentIndex: Number(message.currentIndex || 0) + 1, totalSaved });
      return { success: true, totalSaved };
    }

    if (message.phase === "submitting") {
      const submitJobs = jobs.filter(isSubmittableJob).map(normalizeJobForSubmit);
      return submitCollectedBossJobs(submitJobs, message, keyword, runId, baseMeta, totalSaved);
    }

    const currentJob = jobs[detailIndex];
    if (currentJob && !isDetailQueueJob(currentJob)) {
      jobs[detailIndex] = markBossDetailNavigationFailed(
        currentJob,
        detailIndex + 1,
        jobs.length,
        "候选岗位不是有效详情页，已跳过"
      );
      postProgress(message, "warning", `Boss Chrome跳过无效候选 ${detailIndex + 1}/${jobs.length}：${compact(currentJob.title) || "未识别岗位名"}`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
        detailIndex: detailIndex + 1,
        detailTotal: jobs.length,
        currentUrl: window.location.href,
        targetUrl: currentJob.url || "",
        reason: "INVALID_DETAIL_CANDIDATE"
      });
      const nextTask = resetBossDetailNavigationState({
        ...message,
        jobs,
        detailIndex: detailIndex + 1,
        totalSaved
      });
      storeScanTask(nextTask);
      return continueBossDetailScan(nextTask, keyword, runId, baseMeta);
    }

    if (currentJob) {
      const pageBlockDiagnostics = buildPageBlockDiagnostics();
      if (handleBlockingState(message, pageBlockDiagnostics, { ...baseMeta, stage: "details" })) {
        return { success: true, totalSaved, blocked: true };
      }
    }

    if (currentJob && !isSameBossJobUrl(window.location.href, currentJob.url)) {
      const detailNavigationKey = bossDetailNavigationKey(currentJob);
      const previousKey = compact(message.detailNavigationKey);
      const previousAttempts = previousKey && previousKey === detailNavigationKey
        ? Number(message.detailNavigationAttempts || 0)
        : 0;
      if (previousAttempts >= DETAIL_NAVIGATION_MAX_ATTEMPTS) {
        jobs[detailIndex] = markBossDetailNavigationFailed(
          currentJob,
          detailIndex + 1,
          jobs.length,
          "详情页连续跳转失败，已跳过"
        );
        postProgress(message, "warning", `Boss Chrome详情页连续跳转失败，已跳过 ${detailIndex + 1}/${jobs.length}：${currentJob.title}`, {
          ...baseMeta,
          stage: "details",
          collected: jobs.length,
          detailIndex: detailIndex + 1,
          detailTotal: jobs.length,
          currentUrl: window.location.href,
          targetUrl: currentJob.url,
          navigationAttempts: previousAttempts,
          reason: "DETAIL_NAVIGATION_FAILED"
        });
        const nextTask = resetBossDetailNavigationState({
          ...message,
          jobs,
          detailIndex: detailIndex + 1,
          totalSaved
        });
        storeScanTask(nextTask);
        return continueBossDetailScan(nextTask, keyword, runId, baseMeta);
      }

      const nextAttempts = previousAttempts + 1;
      const navigationTask = {
        ...message,
        phase: "detail",
        jobs,
        detailIndex,
        totalSaved,
        detailNavigationKey,
        detailNavigationAttempts: nextAttempts,
        detailNavigationStartedAt: Date.now()
      };
      storeScanTask(navigationTask);
      postProgress(message, "info", `Boss Chrome正在查看详情 ${detailIndex + 1}/${jobs.length}：${currentJob.title}`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
        detailIndex: detailIndex + 1,
        detailTotal: jobs.length,
        navigationAttempts: nextAttempts,
        navigationAttemptLimit: DETAIL_NAVIGATION_MAX_ATTEMPTS,
        currentUrl: window.location.href,
        targetUrl: currentJob.url
      });
      const currentNavigation = await navigateToBossDetail(navigationTask, currentJob.url);
      if (currentNavigation.status === "pending") {
        return { success: true, totalSaved, pendingNavigation: true };
      }
      if (currentNavigation.status === "blocked") {
        jobs[detailIndex] = markBossDetailNavigationFailed(
          currentJob,
          detailIndex + 1,
          jobs.length,
          currentNavigation.message
        );
        postProgress(message, "warning", `Boss Chrome详情页跳转无响应，已跳过 ${detailIndex + 1}/${jobs.length}：${currentJob.title || "未知岗位"}`, {
          ...baseMeta,
          stage: "details",
          detailIndex: detailIndex + 1,
          detailTotal: jobs.length,
          currentUrl: window.location.href,
          targetUrl: currentJob.url,
          reason: currentNavigation.message
        });
        const nextTask = resetBossDetailNavigationState({
          ...message,
          jobs,
          detailIndex: detailIndex + 1,
          totalSaved
        });
        storeScanTask(nextTask);
        return continueBossDetailScan(nextTask, keyword, runId, baseMeta);
      }
    }

    if (currentJob) {
      if (isStopRequested(runId)) {
        stopRequested = true;
        clearStoredScanTask();
        return { success: true, totalSaved };
      }
      if (!isCurrentBossJobDetailPage(currentJob.url)) {
        jobs[detailIndex] = markBossDetailNavigationFailed(
          currentJob,
          detailIndex + 1,
          jobs.length,
          `当前页面不是目标Boss岗位详情页：${window.location.href}`
        );
        postProgress(message, "warning", `Boss Chrome跳过疑似非岗位详情页 ${detailIndex + 1}/${jobs.length}：${currentJob.title || "未知岗位"}`, {
          ...baseMeta,
          stage: "details",
          detailIndex: detailIndex + 1,
          detailTotal: jobs.length,
          currentUrl: window.location.href,
          targetUrl: currentJob.url
        });
      } else {
        await humanPause(900, 1800);
        writeScanStatus({
          isRunning: true,
          stopRequested: false,
          stage: "details",
          message: `Boss Chrome正在解析详情 ${detailIndex + 1}/${jobs.length}：${currentJob.title}`,
          keyword,
          keywordIndex: baseMeta.keywordIndex,
          keywordTotal: baseMeta.keywordTotal,
          detailIndex: detailIndex + 1,
          detailTotal: jobs.length,
          totalSaved,
          startedAt: message.startedAt,
          updatedAt: Date.now()
        });
        postProgress(message, "info", `Boss Chrome正在解析详情 ${detailIndex + 1}/${jobs.length}：${currentJob.title}`, {
          ...baseMeta,
          stage: "details",
          collected: jobs.length,
          detailIndex: detailIndex + 1,
          detailTotal: jobs.length
        });
        jobs[detailIndex] = await enrichBossJobFromCurrentDetail(currentJob, message, baseMeta, detailIndex + 1, jobs.length);
      }
    }

    const nextIndex = detailIndex + 1;
    if (isStopRequested(runId)) stopRequested = true;
    if (!stopRequested && nextIndex < jobs.length) {
      const nextTask = resetBossDetailNavigationState({ ...message, jobs, detailIndex: nextIndex, totalSaved });
      storeScanTask(nextTask);
      return continueBossDetailScan(nextTask, keyword, runId, baseMeta);
    }

    const detailSummary = summarizeJobCollection(jobs);
    const submitJobs = jobs.filter(isSubmittableJob).map(normalizeJobForSubmit);
    if (isStopRequested(runId)) {
      stopRequested = true;
      clearStoredScanTask();
      return { success: true, totalSaved };
    }
    postProgress(message, "info", `Boss Chrome已读取 ${jobs.length} 个岗位详情，准备提交后台AI队列。可提交 ${submitJobs.length} 个，详情不足 ${detailSummary.missingDescription} 个。`, {
      ...baseMeta,
      stage: "submitting",
      collected: jobs.length,
      submitted: submitJobs.length,
      missingTitle: detailSummary.missingTitle,
      missingCompany: detailSummary.missingCompany,
      missingDescription: detailSummary.missingDescription,
      missingHr: detailSummary.missingHr
    });
    if (!submitJobs.length) {
      postProgress(message, "warning", "Boss Chrome未找到可提交岗位：岗位名、公司名或详情链接缺失。", {
        ...baseMeta,
        stage: "empty",
        collected: jobs.length,
        ...detailSummary
      });
      storeScanTask({
        ...message,
        phase: "nextKeyword",
        jobs: [],
        detailIndex: 0,
        currentIndex: Number(message.currentIndex || 0) + 1,
        totalSaved
      });
      advanceKeywordCursor(message, Number(message.currentIndex || 0) + 1, keyword);
      return { success: true, totalSaved };
    }
    const submittingTask = {
      ...message,
      phase: "submitting",
      jobs,
      detailIndex: jobs.length - 1,
      detailNavigationKey: "",
      detailNavigationAttempts: 0,
      detailNavigationStartedAt: 0,
      submitBatchIndex: 0,
      submitSummary: null,
      totalSaved
    };
    storeScanTask(submittingTask);
    return submitCollectedBossJobs(submitJobs, submittingTask, keyword, runId, baseMeta, totalSaved);
  }

  function bossDetailNavigationKey(job) {
    return bossCandidateKey(job) || normalizeBossJobUrl(job?.url) || compact(job?.url);
  }

  function markBossDetailNavigationFailed(job, detailIndexOrReason, detailTotal, reason) {
    const hasDetailPosition = Number.isInteger(detailIndexOrReason);
    const failureReason = compact(hasDetailPosition ? reason : detailIndexOrReason) || "详情页跳转失败";
    return {
      ...job,
      ...(hasDetailPosition ? { detailIndex: detailIndexOrReason, detailTotal } : {}),
      detailNavigationFailed: true,
      detailSkipReason: failureReason,
      detailNavigationFailureReason: failureReason,
      description: job?.description || "",
      companyInfo: job?.companyInfo || ""
    };
  }

  function resetBossDetailNavigationState(task) {
    return {
      ...task,
      detailNavigationKey: "",
      detailNavigationAttempts: 0,
      detailNavigationStartedAt: 0
    };
  }

  function isCurrentBossJobDetailPage(targetUrl) {
    return Boolean(isBossJobDetailUrl(window.location.href) && isSameBossJobUrl(window.location.href, targetUrl));
  }

  async function navigateToBossDetail(message, targetUrl) {
    const normalizedTargetUrl = normalizeBossJobUrl(targetUrl);
    const beforeUrl = window.location.href;
    if (!normalizedTargetUrl || !isBossJobDetailUrl(normalizedTargetUrl)) {
      return { status: "blocked", targetUrl: normalizedTargetUrl, message: `岗位详情链接无效或不是Boss岗位页：${targetUrl || "空"}` };
    }
    if (isSameBossJobUrl(beforeUrl, normalizedTargetUrl)) {
      postProgress(message, "info", "Boss Chrome详情链接与当前页面相同，直接继续解析当前详情页。", {
        operation: "scan",
        stage: "details",
        currentUrl: beforeUrl,
        targetUrl: normalizedTargetUrl
      });
      return { status: "same", targetUrl: normalizedTargetUrl };
    }
    if (isStopRequested(message?.runId)) {
      stopRequested = true;
      return { status: "blocked", message: "Boss扫描已停止", targetUrl: normalizedTargetUrl };
    }

    const backgroundNavigation = await requestBackgroundNavigation(normalizedTargetUrl);
    if (!backgroundNavigation.success) {
      return { status: "blocked", message: backgroundNavigation.message || "后台未返回成功状态", targetUrl: normalizedTargetUrl };
    }
    await sleep(DETAIL_NAVIGATION_GUARD_MS);
    if (isStopRequested(message?.runId)) {
      stopRequested = true;
      return { status: "blocked", message: "Boss扫描已停止", targetUrl: normalizedTargetUrl };
    }
    return classifyBossDetailNavigation({
      currentUrl: beforeUrl,
      targetUrl: normalizedTargetUrl,
      afterUrl: window.location.href,
      backgroundSuccess: true
    });
  }

  function classifyBossDetailNavigation(input) {
    if (SCAN_SUPPORT.classifyBossDetailNavigation) {
      return SCAN_SUPPORT.classifyBossDetailNavigation(input, window.location.origin);
    }
    const targetUrl = normalizeBossJobUrl(input?.targetUrl);
    const currentUrl = String(input?.currentUrl || "");
    const afterUrl = String(input?.afterUrl || currentUrl || "");
    if (!targetUrl || !isBossJobDetailUrl(targetUrl)) {
      return { status: "blocked", targetUrl, message: `岗位详情链接无效或不是Boss岗位页：${input?.targetUrl || "空"}` };
    }
    if (currentUrl && isSameBossJobUrl(currentUrl, targetUrl)) return { status: "same", targetUrl };
    if (input?.backgroundSuccess === false) {
      return { status: "blocked", targetUrl, message: input?.message || "后台未返回成功状态" };
    }
    if (afterUrl && afterUrl !== currentUrl) return { status: "pending", targetUrl };
    return { status: "blocked", targetUrl, message: "已请求后台跳转，但页面URL未变化" };
  }

  async function submitCollectedBossJobs(submitJobs, message, keyword, runId, baseMeta, totalSaved) {
    const data = await submitBossJobsInBatches(submitJobs, message, baseMeta, {
      runId,
      keyword,
      autoDeliver: isAutoDeliverEnabled(message)
    });
    if (!data.success) throw new Error(data.message || "Boss岗位提交失败");
    if (data.cancelled || isStopRequested(runId)) {
      stopRequested = true;
      clearStoredScanTask();
      return { success: true, totalSaved: totalSaved + (data.saved || 0) };
    }
    const nextTotalSaved = totalSaved + (data.saved || 0);
    postProgress(message, "success", `Boss Chrome已提交后台AI队列：采集 ${data.received ?? submitJobs.length} 个，入库 ${data.saved ?? 0} 个，入队 ${data.queued ?? 0} 个，恢复已有分析 ${data.restored ?? 0} 个，跳过 ${data.skipped ?? 0} 个，信息不足 ${data.insufficient ?? 0} 个。`, {
      ...baseMeta,
      stage: "submitted",
      collected: data.received ?? submitJobs.length,
      saved: data.saved ?? 0,
      queued: data.queued ?? 0,
      skipped: data.skipped ?? 0,
      restored: data.restored ?? 0,
      insufficient: data.insufficient ?? 0,
      queueSize: data.queueSize ?? 0,
      totalSaved: nextTotalSaved
    });
    if (isAutoDeliverEnabled(message)) {
      postProgress(message, "warning", "扫描优先模式已启用：Boss扫描期间不会自动投递，AI通过岗位会进入待确认列表。", {
        ...baseMeta,
        stage: "submitted"
      });
    }
    storeScanTask({
      ...message,
      phase: "nextKeyword",
      jobs: [],
      detailIndex: 0,
      submitBatchIndex: 0,
      submitSummary: null,
      currentIndex: Number(message.currentIndex || 0) + 1,
      totalSaved: nextTotalSaved
    });
    advanceKeywordCursor(message, Number(message.currentIndex || 0) + 1, keyword);
    return { success: true, totalSaved: nextTotalSaved };
  }

  async function submitBossJobsInBatches(jobs, message, baseMeta, options) {
    const runId = normalizeScanRunId(options?.runId || message?.runId || activeScanRunId);
    const batches = chunkList(jobs, SUBMIT_BATCH_SIZE);
    const previousSummary = message?.submitSummary || {};
    const summary = {
      success: true,
      asyncAnalysis: true,
      received: numberValue(previousSummary.received),
      saved: numberValue(previousSummary.saved),
      queued: numberValue(previousSummary.queued),
      skipped: numberValue(previousSummary.skipped),
      insufficient: numberValue(previousSummary.insufficient),
      restored: numberValue(previousSummary.restored),
      autoDeliver: Boolean(options.autoDeliver),
      queueSize: numberValue(previousSummary.queueSize),
      analyses: []
    };
    const startBatchIndex = SCAN_SUPPORT.normalizeBatchIndex
      ? SCAN_SUPPORT.normalizeBatchIndex(message?.submitBatchIndex, batches.length)
      : Math.min(Math.max(numberValue(message?.submitBatchIndex), 0), batches.length);

    for (let index = startBatchIndex; index < batches.length; index++) {
      if (isStopRequested(runId)) {
        return { ...summary, cancelled: true };
      }

      const batch = batches[index];
      storeScanTask({
        ...message,
        phase: "submitting",
        jobs: message.jobs,
        submitBatchIndex: index,
        submitSummary: checkpointSubmitSummary(summary),
        lastSubmitError: null
      });
      postProgress(message, "info", `Boss Chrome正在提交后台AI队列：第 ${index + 1}/${batches.length} 批，${batch.length} 个岗位。`, {
        ...baseMeta,
        stage: "submitting",
        batchIndex: index + 1,
        batchTotal: batches.length,
        submitted: batch.length
      });

      let data;
      let batchAttempt = 0;
      const maxBatchAttempts = 2;
      while (batchAttempt < maxBatchAttempts) {
        batchAttempt++;
        try {
          data = await callBossLocalApi("chrome-jobs", {
            runId,
            keyword: options.keyword,
            jobs: batch,
            autoDeliver: options.autoDeliver
          }, {
            pageTabId: message?.pageTabId,
            timeoutMs: 60000
          });
          break; // 成功，跳出重试循环
        } catch (error) {
          if (batchAttempt < maxBatchAttempts) {
            postProgress(message, "warning", `Boss岗位提交第 ${index + 1}/${batches.length} 批失败，正在重试（${batchAttempt}/${maxBatchAttempts}）：${safeErrorMessage(error)}`, {
              ...baseMeta,
              stage: "submitting",
              batchIndex: index + 1,
              batchTotal: batches.length,
              retry: batchAttempt
            });
            await humanPause(800, 1500);
            continue;
          }
          // 最终失败：记录错误但跳过本批，继续提交其他批次
          const reason = safeErrorMessage(error);
          const diagnostic = buildLocalApiDiagnostic(error, "submitting");
          postProgress(message, "error", `Boss岗位第 ${index + 1}/${batches.length} 批提交失败（已重试），跳过本批继续：${diagnostic.message}`, {
            ...baseMeta,
            stage: "submitBatchSkipped",
            diagnosticType: diagnostic.type,
            batchIndex: index + 1,
            batchTotal: batches.length
          });
          storeScanTask({
            ...message,
            phase: "submitting",
            jobs: message.jobs,
            submitBatchIndex: index + 1,
            submitSummary: checkpointSubmitSummary(summary),
            lastSubmitError: { type: diagnostic.type, message: reason, failedAt: Date.now() }
          });
          // 跳过本批，继续下一个批次
          data = null;
          break;
        }
      }

      if (!data) {
        // 本批已跳过，继续下一批
        continue;
      }

      if (!data.success) {
        const diagnostic = buildLocalApiDiagnostic(new Error(data.message || "后台未返回原因"), "submitting");
        postProgress(message, "error", `Boss岗位第 ${index + 1}/${batches.length} 批后台处理失败，跳过本批继续：${diagnostic.message}`, {
          ...baseMeta,
          stage: "submitBatchSkipped",
          diagnosticType: diagnostic.type,
          batchIndex: index + 1,
          batchTotal: batches.length
        });
        storeScanTask({
          ...message,
          phase: "submitting",
          jobs: message.jobs,
          submitBatchIndex: index + 1,
          submitSummary: checkpointSubmitSummary(summary),
          lastSubmitError: { type: diagnostic.type, message: data.message || "后台未返回原因", failedAt: Date.now() }
        });
        continue;
      }

      summary.received += numberValue(data.received);
      summary.saved += numberValue(data.saved);
      summary.queued += numberValue(data.queued);
      summary.skipped += numberValue(data.skipped);
      summary.insufficient += numberValue(data.insufficient);
      summary.restored += numberValue(data.restored);
      summary.queueSize = numberValue(data.queueSize);
      if (Array.isArray(data.analyses)) summary.analyses.push(...data.analyses);
      storeScanTask({
        ...message,
        phase: "submitting",
        jobs: message.jobs,
        submitBatchIndex: index + 1,
        submitSummary: checkpointSubmitSummary(summary),
        lastSubmitError: null
      });

      postProgress(message, "info", `Boss Chrome第 ${index + 1}/${batches.length} 批已提交：入库 ${numberValue(data.saved)} 个，入队 ${numberValue(data.queued)} 个。`, {
        ...baseMeta,
        stage: "submitting",
        batchIndex: index + 1,
        batchTotal: batches.length,
        saved: summary.saved,
        queued: summary.queued,
        skipped: summary.skipped,
        insufficient: summary.insufficient
      });

      if (data.cancelled) {
        return { ...summary, cancelled: true };
      }
    }

    return summary;
  }

  function checkpointSubmitSummary(summary) {
    return {
      received: numberValue(summary?.received),
      saved: numberValue(summary?.saved),
      queued: numberValue(summary?.queued),
      skipped: numberValue(summary?.skipped),
      insufficient: numberValue(summary?.insufficient),
      restored: numberValue(summary?.restored),
      queueSize: numberValue(summary?.queueSize)
    };
  }

  async function continueAutoDeliverScan(message, keyword, baseMeta) {
    const queue = Array.isArray(message.deliveryQueue) ? message.deliveryQueue : [];
    const deliveryIndex = Number(message.deliveryIndex || 0);
    const totalSaved = Number(message.totalSaved || 0);
    const runId = normalizeScanRunId(message?.runId || activeScanRunId);
    if (isStopRequested(runId)) {
      stopRequested = true;
      clearStoredScanTask();
      return { success: true, task: message, totalSaved };
    }

    if (!queue.length || deliveryIndex >= queue.length) {
      const nextTask = {
        ...message,
        phase: "nextKeyword",
        deliveryQueue: [],
        deliveryIndex: 0,
        currentIndex: Number(message.currentIndex || 0) + 1,
        totalSaved
      };
      storeScanTask(nextTask);
      return { success: true, task: nextTask, totalSaved };
    }

    const delivery = queue[deliveryIndex];
    if (delivery?.url && !isSameBossJobUrl(window.location.href, delivery.url)) {
      postProgress(message, "info", `自动投递正在打开 ${deliveryIndex + 1}/${queue.length}：${delivery.companyName || ""} ${delivery.jobName || ""}`.trim(), {
        ...baseMeta,
        stage: "autoDeliver",
        keywordIndex: deliveryIndex + 1,
        keywordTotal: queue.length
      });
      storeScanTask({ ...message, phase: "autoDeliver", deliveryQueue: queue, deliveryIndex, totalSaved });
      window.location.href = delivery.url;
      return { success: true, task: message, totalSaved, pendingNavigation: true };
    }

    postProgress(message, "info", `自动投递正在联系 ${deliveryIndex + 1}/${queue.length}：${delivery.companyName || ""} ${delivery.jobName || ""}`.trim(), {
      ...baseMeta,
      stage: "autoDeliver",
      keywordIndex: deliveryIndex + 1,
      keywordTotal: queue.length
    });
    if (isStopRequested(runId)) {
      stopRequested = true;
      clearStoredScanTask();
      return { success: true, task: message, totalSaved };
    }
    await deliverOnCurrentPage(delivery, message);

    const nextIndex = deliveryIndex + 1;
    if (isStopRequested(runId)) stopRequested = true;
    if (!stopRequested && nextIndex < queue.length) {
      const nextDelivery = queue[nextIndex];
      const nextTask = { ...message, phase: "autoDeliver", deliveryQueue: queue, deliveryIndex: nextIndex, totalSaved };
      storeScanTask(nextTask);
      window.location.href = nextDelivery.url;
      return { success: true, task: nextTask, totalSaved, pendingNavigation: true };
    }

    const nextTask = {
      ...message,
      phase: "nextKeyword",
      deliveryQueue: [],
      deliveryIndex: 0,
      currentIndex: Number(message.currentIndex || 0) + 1,
      totalSaved
    };
    storeScanTask(nextTask);
    postProgress(message, "success", `自动投递阶段完成：${queue.length} 个 AI 通过岗位已处理。`, {
      ...baseMeta,
      stage: "autoDeliver",
      keywordTotal: queue.length
    });
    return { success: true, task: nextTask, totalSaved };
  }

  async function appendAiKeywords(task, existingKeywords) {
    if (isStopRequested(task?.runId)) {
      stopRequested = true;
      return { task: { ...task, aiKeywordsLoaded: true }, keywords: uniqueStrings(existingKeywords) };
    }
    const keywords = uniqueStrings(existingKeywords);
    postProgress(task, "info", "配置关键词已完成，正在请求 AI 补充 Boss 搜索关键词。", {
      operation: "scan",
      stage: "aiKeywords",
      keywordTotal: keywords.length,
      totalSaved: Number(task.totalSaved || 0)
    });
    try {
      const data = await callBossLocalApi("ai-keywords", { existingKeywords: keywords, limit: 5 }, {
        pageTabId: task?.pageTabId
      });
      const aiKeywords = uniqueStrings(data.keywords || []).filter((item) => !keywords.some((keyword) => sameKeyword(keyword, item))).slice(0, 5);
      const nextKeywords = keywords.concat(aiKeywords);
      const nextTask = {
        ...task,
        aiKeywordsLoaded: true,
        keywords: nextKeywords,
        config: { ...(task.config || {}), keywords: nextKeywords },
        currentIndex: keywords.length
      };
      storeScanTask(nextTask);
      postProgress(task, aiKeywords.length ? "info" : "warning", aiKeywords.length ? `AI补充关键词：${aiKeywords.join("、")}。` : "AI未生成新的Boss关键词，将结束扫描。", {
        operation: "scan",
        stage: "aiKeywords",
        keywordIndex: keywords.length + 1,
        keywordTotal: nextKeywords.length,
        totalSaved: Number(task.totalSaved || 0)
      });
      return { task: nextTask, keywords: nextKeywords };
    } catch (error) {
      const nextTask = { ...task, aiKeywordsLoaded: true, currentIndex: keywords.length };
      storeScanTask(nextTask);
      postProgress(task, "warning", `AI补充关键词失败，继续完成扫描：${error.message || String(error)}`, {
        operation: "scan",
        stage: "aiKeywords",
        keywordTotal: keywords.length,
        totalSaved: Number(task.totalSaved || 0)
      });
      return { task: nextTask, keywords };
    }
  }

  async function enrichBossJobFromCurrentDetail(job, message, baseMeta, detailIndex, detailTotal) {
    const listDescription = job.description || "";
    try {
      const jsonFields = await extractBossDetailJsonFields(job);
      const domFields = extractBossDetailFields(job);
      const resolvedId = jsonFields.id || job.id || extractBossId(job.url) || extractBossId(window.location.href);
      return {
        ...job,
        id: resolvedId,
        userId: jsonFields.userId || job.userId || "",
        title: jsonFields.title || domFields.title || job.title,
        company: jsonFields.company || domFields.company || job.company,
        salary: jsonFields.salary || domFields.salary || job.salary,
        location: jsonFields.location || domFields.location || job.location,
        experience: jsonFields.experience || domFields.experience || job.experience,
        degree: jsonFields.degree || domFields.degree || job.degree,
        hrName: jsonFields.hrName || domFields.hrName || job.hrName,
        hrTitle: jsonFields.hrTitle || domFields.hrTitle || job.hrTitle || "",
        hrActive: jsonFields.hrActive || domFields.hrActive || job.hrActive || "",
        description: jsonFields.description || domFields.description || listDescription,
        companyInfo: jsonFields.companyInfo || domFields.companyInfo || job.companyInfo || "",
        companyAddress: jsonFields.companyAddress || domFields.companyAddress || job.companyAddress || "",
        industry: jsonFields.industry || domFields.industry || job.industry || "",
        financingStage: jsonFields.financingStage || domFields.financingStage || job.financingStage || "",
        companyScale: jsonFields.companyScale || domFields.companyScale || job.companyScale || "",
        deliveryStatus: jsonFields.deliveryStatus || domFields.deliveryStatus || job.deliveryStatus || "",
        recruitmentStatus: jsonFields.recruitmentStatus || domFields.recruitmentStatus || job.recruitmentStatus || "",
        url: normalizeBossJobUrl(window.location.href) || normalizeBossJobUrl(job.url) || bossJobUrlFromId(resolvedId)
      };
    } catch (error) {
      postProgress(message, "warning", `Boss Chrome详情读取失败，改用列表文本：${job.title}`, {
        ...baseMeta,
        stage: "details",
        detailIndex,
        detailTotal,
        error: error.message || String(error)
      });
      return {
        ...job,
        description: listDescription
      };
    }
  }

  async function deliverOne(task, message) {
    if (!task?.url || !task?.id) throw new Error("投递任务缺少岗位链接或ID");
    postProgress(message, "info", `Boss Chrome准备投递当前岗位：${task.companyName || ""} ${task.jobName || ""}`.trim(), {
      operation: "deliver",
      stage: "checking",
      keyword: task.jobName || task.title || "",
      keywordTotal: 1,
      keywordIndex: 1
    });
    await waitForPage();
    if (!isSameBossJobUrl(window.location.href, task.url)) {
      return {
        success: false,
        message: "Boss投递需要先由扩展后台打开岗位详情页，请刷新扩展和页面后重试。"
      };
    }
    return deliverOnCurrentPage(task, message);
  }

  function handleDeliverCurrentMessage(message, sendResponse) {
    let responded = false;
    const respondOnce = (payload) => {
      if (responded) return;
      responded = true;
      try {
        sendResponse(payload);
      } catch (error) {
        console.warn("Boss deliver response failed", error);
      }
    };

    deliverOnCurrentPage(message.task, message, respondOnce).then((result) => {
      respondOnce(result);
    }).catch((error) => {
      postProgress(message, "error", error.message || String(error), {
        operation: "deliver",
        stage: "error"
      });
      respondOnce({ success: false, message: error.message || String(error) });
    });
  }

  async function deliverOnCurrentPage(task, message, earlyRespond) {
    if (!task?.url || !task?.id) {
      return { success: false, message: "投递任务缺少岗位链接或ID" };
    }
    await waitForPage();
    if (!isSameBossJobUrl(window.location.href, task.url)) {
      return { success: false, message: "当前Boss页面不是目标岗位详情页，已取消投递。" };
    }
    if (message?.respectScanStop && isStopRequested(message?.runId)) {
      stopRequested = true;
      return { success: false, message: "Boss扫描已停止" };
    }
    await sleep(1500);
    postProgress(message, "info", `Boss Chrome正在当前详情页投递：${task.companyName || ""} ${task.jobName || ""}`.trim(), {
      operation: "deliver",
      stage: "submitting",
      keyword: task.jobName || task.title || "",
      keywordIndex: Number(message.deliveryIndex || 1),
      keywordTotal: Number(message.deliveryTotal || 1)
    });
    const beforeUrl = window.location.href;
    const favoriteButton = findBossDeliverButton(["感兴趣"], ["不感兴趣"])
      || findClickable(["感兴趣", "收藏该岗位", "收藏"]);
    if (favoriteButton) {
      clickElement(favoriteButton);
      await sleep(600);
      postProgress(message, "info", "Boss Chrome已点击感兴趣。", {
        operation: "deliver",
        stage: "submitting"
      });
    }

    let chatButton = findBossDeliverButton(["立即沟通", "继续沟通", "沟通"], ["不感兴趣"])
      || findClickable(["立即沟通", "继续沟通", "沟通", "立即投递"]);
    if (!chatButton && favoriteButton) {
      chatButton = await waitForBossDeliverButton(["立即沟通", "继续沟通", "沟通"], ["不感兴趣"], 3500)
        || findClickable(["立即沟通", "继续沟通", "沟通", "立即投递"]);
    }
    if (!chatButton) {
      const failure = classifyDeliveryFailure("未找到立即沟通按钮");
      await postDeliveryResult(task, false, failure);
      postProgress(message, "warning", `Boss Chrome投递失败：${failure.failureReason}`, {
        operation: "deliver",
        stage: "error"
      });
      return { success: false, message: failure.failureReason, failureType: failure.failureType };
    }
    postProgress(message, "info", "Boss Chrome已找到沟通入口，准备点击立即沟通。", {
      operation: "deliver",
      stage: "submitting"
    });
    clickElement(chatButton);
    const successMessage = favoriteButton ? "Boss岗位已点击感兴趣并立即沟通" : "Boss岗位已点击立即沟通";
    const deliveryCheck = await waitForDeliveryOpened(beforeUrl, task, 9000);
    if (!deliveryCheck.success) {
      const failure = classifyDeliveryFailure(deliveryCheck.message);
      await postDeliveryResult(task, false, failure);
      postProgress(message, "warning", `Boss Chrome投递失败：${failure.failureReason}`, {
        operation: "deliver",
        stage: "error"
      });
      return { ...deliveryCheck, message: failure.failureReason, failureType: failure.failureType };
    }
    const greetingResult = await sendConfiguredGreeting(task, message);
    const finalMessage = greetingResult?.sent ? `${successMessage}，已发送开场白` : successMessage;
    await postDeliveryResult(task, true, finalMessage);
    earlyRespond?.({ success: true, message: finalMessage, early: true });
    postProgress(message, "success", buildDeliverySuccessMessage(favoriteButton, greetingResult), {
      operation: "deliver",
      stage: "complete",
      saved: 1
    });
    return { success: true, message: finalMessage };
  }

  async function sendConfiguredGreeting(task, message) {
    const greeting = compact(task?.greeting || "");
    if (!greeting) return { attempted: false, sent: false, message: "未配置开场白" };

    const input = await waitForChatInput(4500);
    if (!input) return { attempted: false, sent: false, message: "未出现聊天输入框" };

    writeChatInput(input, greeting);
    await sleep(400);
    const sendButton = findSendButton();
    if (!sendButton) {
      postProgress(message, "warning", "Boss Chrome已填入配置开场白，但未找到发送按钮。", {
        operation: "deliver",
        stage: "submitting"
      });
      return { attempted: true, sent: false, message: "未找到发送按钮" };
    }

    clickElement(sendButton);
    await sleep(600);
    postProgress(message, "info", "Boss Chrome已发送配置开场白。", {
      operation: "deliver",
      stage: "submitting"
    });
    return { attempted: true, sent: true, message: "已发送配置开场白" };
  }

  function buildDeliverySuccessMessage(favoriteButton, greetingResult) {
    const base = favoriteButton ? "Boss Chrome投递完成：已点击感兴趣并立即沟通。" : "Boss Chrome投递完成：已点击立即沟通。";
    if (greetingResult?.sent) return `${base}已发送配置开场白。`;
    if (greetingResult?.attempted) return `${base}配置开场白已填入但未发送。`;
    return base;
  }

  async function waitForChatInput(timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const input = findChatInput();
      if (input) return input;
      await sleep(250);
    }
    return null;
  }

  function findChatInput() {
    const selectors = [
      "div#chat-input.chat-input[contenteditable='true']",
      "[contenteditable='true'].chat-input",
      "[contenteditable='true'][id*='chat']",
      "textarea.input-area",
      "textarea"
    ];
    for (const selector of selectors) {
      const node = Array.from(document.querySelectorAll(selector)).find((el) => el.offsetParent !== null);
      if (node) return node;
    }
    return null;
  }

  function writeChatInput(input, text) {
    input.focus?.();
    input.click?.();
    if (String(input.tagName || "").toLowerCase() === "textarea") {
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    input.innerText = text;
    input.textContent = text;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
  }

  function findSendButton() {
    const selectors = [
      "div.send-message",
      "button[type='send'].btn-send",
      "button.btn-send",
      "[class*='send-message']",
      "[class*='btn-send']"
    ];
    for (const selector of selectors) {
      const node = Array.from(document.querySelectorAll(selector)).find((el) => el.offsetParent !== null);
      if (node) return node;
    }
    return findClickable(["发送"]);
  }

  async function deliverBatch(tasks, message) {
    let success = 0;
    let failed = 0;
    postProgress(message, "info", `Boss Chrome批量投递开始，共 ${tasks.length} 个待确认岗位。`, {
      operation: "deliver",
      stage: "received",
      keywordTotal: tasks.length,
      saved: 0
    });
    for (let index = 0; index < tasks.length; index++) {
      const task = tasks[index];
      postProgress(message, "info", `Boss Chrome批量投递进度：${index + 1}/${tasks.length}`, {
        operation: "deliver",
        stage: "submitting",
        keyword: task.jobName || task.title || "",
        keywordIndex: index + 1,
        keywordTotal: tasks.length,
        saved: success
      });
      const result = await deliverOne(task, message).catch(async (error) => {
        const failure = classifyDeliveryFailure(error.message || String(error));
        await postDeliveryResult(task, false, failure).catch(() => {});
        return { success: false, message: failure.failureReason, failureType: failure.failureType };
      });
      if (result.success) success += 1;
      else failed += 1;
    }
    postProgress(message, failed ? "warning" : "success", `Boss批量投递完成：成功${success}，失败${failed}`, {
      operation: "deliver",
      stage: "complete",
      keywordTotal: tasks.length,
      saved: success
    });
    return { success: true, message: `Boss批量投递完成：成功${success}，失败${failed}`, successCount: success, failedCount: failed };
  }

  async function postDeliveryResult(task, success, message) {
    const failure = success ? null : normalizeFailurePayload(message);
    await callBossLocalApi("delivery-result", {
      success,
      message: success ? message : failure.failureReason,
      failureType: failure?.failureType,
      failureReason: failure?.failureReason
    }, {
      params: { id: task.id },
      pageTabId: task?.pageTabId,
      timeoutMs: 15000
    });
  }

  async function callBossLocalApi(operation, body, options = {}) {
    const response = await chrome.runtime.sendMessage({
      source: "GET_JOBS_BOSS_CONTENT",
      type: "BOSS_LOCAL_API",
      operation,
      body,
      params: options.params || {},
      timeoutMs: options.timeoutMs,
      pageTabId: options.pageTabId
    });
    if (!response?.success) {
      const error = new Error(response?.message || "Boss本地服务请求失败");
      error.code = response?.errorType || "LOCAL_API_ERROR";
      error.httpStatus = response?.httpStatus;
      throw error;
    }
    return response.data || {};
  }

  function chunkList(list, size) {
    const items = Array.isArray(list) ? list : [];
    const chunkSize = Math.max(1, Number(size) || SUBMIT_BATCH_SIZE);
    const chunks = [];
    for (let index = 0; index < items.length; index += chunkSize) {
      chunks.push(items.slice(index, index + chunkSize));
    }
    return chunks;
  }

  function numberValue(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function safeErrorMessage(error) {
    return error?.message || String(error || "未知错误");
  }

  function postProgress(message, type, text, meta = {}) {
    chrome.runtime.sendMessage({
      source: "GET_JOBS_PLATFORM",
      pageTabId: message.pageTabId,
      payload: {
        platform: "boss",
        type,
        message: text,
        timestamp: Date.now(),
        runId: message?.runId || activeScanRunId || "",
        ...meta
      }
    });
  }

  function normalizeScanTask(message) {
    const config = message?.config || {};
    const keywords = uniqueStrings(toList(message?.keywords || config.keywords || config.keyword || "AI产品运营"));
    const cursorKeywords = uniqueStrings(message?.cursorKeywords || keywords);
    const searchJobLimit = normalizeSearchJobLimit(message?.searchJobLimit ?? config.searchJobLimit);
    const hasExplicitIndex = hasOwn(message, "currentIndex");
    const cursorState = resolveKeywordCursor(message, cursorKeywords, hasExplicitIndex);
    return {
      ...message,
      config: { ...config, keywords, searchJobLimit },
      keywords,
      cursorKeywords,
      source: "GET_JOBS_BACKGROUND",
      type: "BOSS_SCAN_START",
      currentIndex: cursorState.currentIndex,
      totalSaved: Number(message.totalSaved || 0),
      phase: message.phase || "searching",
      detailIndex: Number(message.detailIndex || 0),
      jobs: Array.isArray(message.jobs) ? message.jobs : [],
      aiKeywordsLoaded: Boolean(message.aiKeywordsLoaded),
      autoDeliver: isAutoDeliverEnabled(message),
      startedAt: message.startedAt || Date.now(),
      keywordCursorKey: cursorState.cursorKey,
      keywordCursorReset: cursorState.reset
    };
  }

  function normalizeSearchJobLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return 20;
    return Math.min(Math.floor(parsed), 200);
  }

  function storeScanTask(task) {
    const normalized = {
      ...normalizeScanTask(task),
      updatedAt: Date.now()
    };
    sessionStorage.setItem(SCAN_TASK_KEY, JSON.stringify(normalized));
    writeSharedScanTask(normalized);
  }

  function readStoredScanTask() {
    try {
      const raw = sessionStorage.getItem(SCAN_TASK_KEY);
      return raw ? normalizeScanTask(JSON.parse(raw)) : null;
    } catch {
      clearStoredScanTask();
      return null;
    }
  }

  function clearStoredScanTask() {
    sessionStorage.removeItem(SCAN_TASK_KEY);
    clearSharedScanTask();
  }

  async function readStoredScanTaskFromAnyStorage() {
    const sessionTask = readStoredScanTask();
    if (sessionTask) return sessionTask;

    const ownership = await readScanTabOwnership();
    if (!ownership?.isOwner) return null;

    const sharedTask = await readSharedScanTask();
    if (!sharedTask) return null;
    if (ownership.ownerToken && sharedTask.scanOwnerToken && ownership.ownerToken !== sharedTask.scanOwnerToken) {
      return null;
    }
    const normalized = normalizeScanTask(sharedTask);
    sessionStorage.setItem(SCAN_TASK_KEY, JSON.stringify(normalized));
    return normalized;
  }

  async function readScanTabOwnership() {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      return { success: false, isOwner: false };
    }
    try {
      return await chrome.runtime.sendMessage({
        source: "GET_JOBS_BOSS_CONTENT",
        type: "BOSS_SCAN_OWNER_STATUS"
      });
    } catch {
      return { success: false, isOwner: false };
    }
  }

  function writeSharedScanTask(task) {
    if (!canUseChromeStorage()) return;
    chrome.storage.local.set({ [SHARED_SCAN_TASK_KEY]: task }).catch((error) => {
      console.warn("[GetJobs] Boss共享扫描任务保存失败", error);
    });
  }

  async function readSharedScanTask() {
    if (!canUseChromeStorage()) return null;
    try {
      const result = await chrome.storage.local.get(SHARED_SCAN_TASK_KEY);
      const task = result?.[SHARED_SCAN_TASK_KEY];
      return task ? normalizeScanTask(task) : null;
    } catch (error) {
      console.warn("[GetJobs] Boss共享扫描任务读取失败", error);
      return null;
    }
  }

  function clearSharedScanTask() {
    if (!canUseChromeStorage()) return;
    chrome.storage.local.remove(SHARED_SCAN_TASK_KEY).catch((error) => {
      console.warn("[GetJobs] Boss共享扫描任务清理失败", error);
    });
  }

  function resolveKeywordCursor(message, keywords, hasExplicitIndex = false) {
    const cursorKey = buildKeywordCursorKey(message, keywords);
    const fallbackIndex = normalizeTaskIndex(message?.currentIndex, keywords.length);
    if (hasExplicitIndex || !keywords.length) {
      ensureKeywordCursor(cursorKey, keywords.length, fallbackIndex);
      return { currentIndex: fallbackIndex, cursorKey, reset: false };
    }

    const stored = readKeywordCursor(cursorKey);
    if (stored && stored.keywordTotal === keywords.length) {
      return {
        currentIndex: normalizeKeywordIndex(stored.nextIndex, keywords.length),
        cursorKey,
        reset: false
      };
    }

    const reset = Boolean(readAnyKeywordCursor());
    writeKeywordCursor(cursorKey, 0, keywords.length, "reset");
    return { currentIndex: 0, cursorKey, reset };
  }

  function markKeywordCursorCurrent(task, index, keyword = "") {
    const total = userKeywordCount(task);
    const parsed = Math.floor(Number(index));
    if (!total || !Number.isFinite(parsed) || parsed < 0 || parsed >= total) return;
    writeKeywordCursor(task?.keywordCursorKey || buildKeywordCursorKey(task, userConfiguredKeywords(task)), parsed, total, "current", keyword);
  }

  function advanceKeywordCursor(task, nextIndex, keyword = "") {
    const total = userKeywordCount(task);
    const parsed = Math.floor(Number(nextIndex));
    if (!total || !Number.isFinite(parsed) || parsed < 0 || parsed > total) return;
    writeKeywordCursor(task?.keywordCursorKey || buildKeywordCursorKey(task, userConfiguredKeywords(task)), normalizeKeywordIndex(parsed, total), total, "next", keyword);
  }

  function ensureKeywordCursor(cursorKey, keywordTotal, nextIndex = 0) {
    if (!cursorKey || !keywordTotal || readKeywordCursor(cursorKey)) return;
    writeKeywordCursor(cursorKey, nextIndex, keywordTotal, "init");
  }

  function readKeywordCursor(cursorKey) {
    try {
      const raw = localStorage.getItem(KEYWORD_CURSOR_KEY);
      if (!raw) return null;
      const state = JSON.parse(raw);
      if (!state || state.cursorKey !== cursorKey) return null;
      return state;
    } catch {
      localStorage.removeItem(KEYWORD_CURSOR_KEY);
      return null;
    }
  }

  function readAnyKeywordCursor() {
    try {
      const raw = localStorage.getItem(KEYWORD_CURSOR_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      localStorage.removeItem(KEYWORD_CURSOR_KEY);
      return null;
    }
  }

  function writeKeywordCursor(cursorKey, nextIndex, keywordTotal, state, keyword = "") {
    if (!cursorKey || !keywordTotal) return;
    localStorage.setItem(KEYWORD_CURSOR_KEY, JSON.stringify({
      cursorKey,
      nextIndex: normalizeKeywordIndex(nextIndex, keywordTotal),
      keywordTotal,
      state,
      keyword,
      updatedAt: Date.now()
    }));
  }

  function buildKeywordCursorKey(message, keywords) {
    const config = message?.config || {};
    const searchJobLimit = normalizeSearchJobLimit(message?.searchJobLimit ?? config.searchJobLimit);
    return stableKey({
      platform: "boss",
      keywords: uniqueStrings(keywords || message?.cursorKeywords || []),
      cityCode: normalizedList(config.cityCode),
      jobType: compact(config.jobType || ""),
      salary: normalizedList(config.salary),
      experience: normalizedList(config.experience),
      degree: normalizedList(config.degree),
      scale: normalizedList(config.scale),
      industry: normalizedList(config.industry),
      stage: normalizedList(config.stage),
      searchJobLimit
    });
  }

  function userConfiguredKeywords(task) {
    const cursorKeywords = uniqueStrings(task?.cursorKeywords || []);
    if (cursorKeywords.length) return cursorKeywords;
    return scanKeywords(task);
  }

  function userKeywordCount(task) {
    return userConfiguredKeywords(task).length;
  }

  function normalizedList(value) {
    return toList(value).map((item) => compact(item)).filter(Boolean);
  }

  function stableKey(value) {
    return JSON.stringify(value);
  }

  function normalizeKeywordIndex(value, total) {
    const count = Number(total);
    if (!Number.isFinite(count) || count <= 0) return 0;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    const index = Math.floor(parsed) % count;
    return index < 0 ? index + count : index;
  }

  function normalizeTaskIndex(value, total) {
    const count = Number(total);
    if (!Number.isFinite(count) || count <= 0) return 0;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(Math.max(Math.floor(parsed), 0), count);
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
  }

  function canResumeExistingScanTask(existingTask, incomingTask, status, configChanged) {
    const pageResumable = existingTask ? isResumableScanTask(existingTask) : false;
    if (SCAN_SUPPORT.canResumeScanTask) {
      return SCAN_SUPPORT.canResumeScanTask(existingTask, incomingTask, status, {
        configChanged,
        resumable: pageResumable,
        now: Date.now(),
        ttlMs: SCAN_TASK_TTL_MS
      });
    }
    return Boolean(
      !configChanged
        && isSameScanRun(existingTask, incomingTask)
        && existingTask
        && !existingTask.completed
        && isFreshScanTask(existingTask)
        && (pageResumable || status?.resumable || status?.stage === "blocked")
    );
  }

  function isSameScanRun(left, right) {
    if (SCAN_SUPPORT.sameScanRun) return SCAN_SUPPORT.sameScanRun(left, right);
    const leftRunId = normalizeScanRunId(left?.runId);
    const rightRunId = normalizeScanRunId(right?.runId);
    return Boolean(leftRunId && rightRunId && leftRunId === rightRunId);
  }

  function isResumableScanTask(task) {
    return Boolean(isFreshScanTask(task) && isBossUrl(window.location.href));
  }

  function isFreshScanTask(task) {
    if (SCAN_SUPPORT.isFreshTask) {
      return SCAN_SUPPORT.isFreshTask(task, Date.now(), SCAN_TASK_TTL_MS);
    }
    if (!task || task.type !== "BOSS_SCAN_START" || !task.runId) return false;
    if (task.completed || task.phase === "complete" || task.phase === "stopped" || task.phase === "error") return false;
    const lastActiveAt = Number(task.updatedAt || task.startedAt || 0);
    return Boolean(lastActiveAt && Date.now() - lastActiveAt <= SCAN_TASK_TTL_MS);
  }

  function isBossUrl(url) {
    try {
      return new URL(url).hostname.includes("zhipin.com");
    } catch {
      return false;
    }
  }

  function isBossTaskPage(task) {
    try {
      const current = new URL(window.location.href);
      if (!current.hostname.includes("zhipin.com")) return false;

      const phase = String(task.phase || "");
      const diagnostics = buildPageBlockDiagnostics();
      if (diagnostics.hasBlockingState) return true;
      if (phase === "detail") {
        const jobs = Array.isArray(task.jobs) ? task.jobs : [];
        const job = jobs[Number(task.detailIndex || 0)];
        return Boolean(job?.url && isSameBossJobUrl(current.href, job.url))
          || (!job?.url && current.pathname.includes("/job_detail/"));
      }
      if (phase === "submitting") {
        return true;
      }
      if (phase === "searching") {
        return isCurrentBossSearchTarget(task, current.href) || isPendingBossSearchNavigation(task, current);
      }
      if (phase === "collecting" || phase === "nextKeyword") {
        return isCurrentBossSearchTarget(task, current.href);
      }

      return false;
    } catch {
      return false;
    }
  }

  function isCurrentBossSearchTarget(task, currentHref) {
    const expected = task?.expectedSearchUrl || task?.searchUrl || "";
    return Boolean(expected && isSameSearchUrl(currentHref, expected));
  }

  function isPendingBossSearchNavigation(task, current) {
    const expected = task?.expectedSearchUrl || "";
    if (!expected || !isSearchNavigationPending(task)) return false;
    try {
      const target = new URL(expected, window.location.origin);
      return isBossSearchPath(target.pathname) && isBossSearchPath(current.pathname);
    } catch {
      return false;
    }
  }

  function storeStopRequested(runId = "") {
    const cancel = {
      requested: true,
      runId: normalizeScanRunId(runId || activeScanRunId),
      requestedAt: Date.now()
    };
    stopRequested = true;
    stopRequestedRunId = cancel.runId;
    sessionStorage.setItem(SCAN_CANCEL_KEY, JSON.stringify(cancel));
    writeSharedStopRequested(cancel);
  }

  function clearStopRequested() {
    stopRequested = false;
    stopRequestedRunId = "";
    sessionStorage.removeItem(SCAN_CANCEL_KEY);
    clearSharedStopRequested();
  }

  function prepareStandaloneDelivery() {
    stopRequested = false;
    clearStopRequested();
    const status = readScanStatus();
    if (status?.stopRequested || status?.stage === "stopped") {
      writeScanStatus({
        isRunning: false,
        stopRequested: false,
        stage: "idle",
        message: "Boss扫描停止状态已清理，正在执行投递"
      });
    }
  }

  function isStopRequested(runId = "") {
    const targetRunId = normalizeScanRunId(runId || activeScanRunId);
    if (stopRequested && stopRequestedRunId && targetRunId && stopRequestedRunId === targetRunId) return true;
    return stopRequestMatches(readSessionStopRequested(), targetRunId);
  }

  async function hasStopRequested(runId = "") {
    const targetRunId = normalizeScanRunId(runId || activeScanRunId);
    if (isStopRequested(targetRunId)) return true;

    const shared = await readSharedStopRequested();
    if (stopRequestMatches(shared, targetRunId)) {
      stopRequested = true;
      stopRequestedRunId = targetRunId;
      sessionStorage.setItem(SCAN_CANCEL_KEY, JSON.stringify(shared));
      return true;
    }
    return false;
  }

  function readSessionStopRequested() {
    const raw = sessionStorage.getItem(SCAN_CANCEL_KEY);
    if (!raw) return null;
    if (raw === "1") return { requested: true, legacy: true, runId: "" };
    try {
      return JSON.parse(raw);
    } catch {
      sessionStorage.removeItem(SCAN_CANCEL_KEY);
      return null;
    }
  }

  function stopRequestMatches(cancel, targetRunId) {
    if (!cancel?.requested || !targetRunId) return false;
    const cancelRunId = normalizeScanRunId(cancel.runId);
    return Boolean(cancelRunId && cancelRunId === targetRunId);
  }

  function writeSharedStopRequested(cancel) {
    if (!canUseChromeStorage() || !cancel?.runId) return;
    chrome.storage.local.set({ [SHARED_SCAN_CANCEL_KEY]: cancel }).catch((error) => {
      console.warn("[GetJobs] Boss共享停止标记保存失败", error);
    });
  }

  async function readSharedStopRequested() {
    if (!canUseChromeStorage()) return null;
    try {
      const result = await chrome.storage.local.get(SHARED_SCAN_CANCEL_KEY);
      return result?.[SHARED_SCAN_CANCEL_KEY] || null;
    } catch (error) {
      console.warn("[GetJobs] Boss共享停止标记读取失败", error);
      return null;
    }
  }

  function clearSharedStopRequested() {
    if (!canUseChromeStorage()) return;
    chrome.storage.local.remove(SHARED_SCAN_CANCEL_KEY).catch((error) => {
      console.warn("[GetJobs] Boss共享停止标记清理失败", error);
    });
  }

  function canUseChromeStorage() {
    return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
  }

  function normalizeScanRunId(value) {
    return String(value || "").trim();
  }

  function writeScanStatus(nextStatus) {
    const previous = readScanStatus();
    const merged = typeof SCAN_SUPPORT.mergeScanStatus === "function"
      ? SCAN_SUPPORT.mergeScanStatus(previous, nextStatus, Date.now())
      : { ...previous, ...nextStatus, updatedAt: Date.now() };
    sessionStorage.setItem(SCAN_STATUS_KEY, JSON.stringify(merged));
  }

  function readScanStatus() {
    try {
      const raw = sessionStorage.getItem(SCAN_STATUS_KEY);
      return raw ? JSON.parse(raw) : { isRunning: false, stopRequested: false, stage: "idle" };
    } catch {
      return { isRunning: false, stopRequested: false, stage: "idle" };
    }
  }

  function buildBossPageStatus() {
    const diagnostics = buildPageBlockDiagnostics();
    const onBossPage = location.hostname.includes("zhipin.com");
    const searchLike = isBossSearchPath(location.pathname) || document.querySelectorAll("a[href*='/job_detail/']").length > 0;
    const detailLike = /\/job_detail\//.test(location.pathname) || Boolean(textOf(document, [".job-title", ".job-name", ".job-banner"]));
    const deliveryStatus = detectBossDeliveryStatus(document);
    const usable = onBossPage && !diagnostics.hasLoginPrompt && !diagnostics.hasSecurityPrompt;
    const message = !onBossPage
      ? "未检测到Boss页面"
      : diagnostics.hasSecurityPrompt
        ? "Boss页面出现安全验证，请在Chrome中处理后再扫描"
        : diagnostics.hasLoginPrompt
          ? "Boss页面出现登录提示，请在Chrome中重新登录"
          : "Chrome中的Boss页面可用，可以扫描或投递";

    return {
      success: true,
      platform: "boss",
      isLoggedIn: usable,
      chromePageReady: usable,
      searchReady: usable && searchLike,
      currentUrl: diagnostics.currentUrl,
      title: diagnostics.title,
      pageState: diagnostics.pageState,
      hasLoginPrompt: diagnostics.hasLoginPrompt,
      hasSecurityPrompt: diagnostics.hasSecurityPrompt,
      searchLike,
      detailLike,
      deliveryStatus,
      message
    };
  }

  function findClickable(labels) {
    const all = Array.from(document.querySelectorAll("button, a, [role='button'], div, span"))
      .filter((el) => el.offsetParent !== null);
    const matched = all.filter((el) => {
      const text = compact([
        el.innerText,
        el.textContent,
        el.getAttribute?.("aria-label"),
        el.getAttribute?.("title")
      ].filter(Boolean).join(" "));
      return labels.some((label) => text.includes(label));
    });
    return matched.find((el) => /^(BUTTON|A)$/.test(el.tagName) || el.getAttribute?.("role") === "button") || matched[0];
  }

  function findBossDeliverButton(labels, blockedLabels = []) {
    const all = Array.from(document.querySelectorAll("button, a, [role='button']"))
      .filter((el) => el.offsetParent !== null);
    return all.find((el) => {
      const text = compact([
        el.innerText,
        el.textContent,
        el.getAttribute?.("aria-label"),
        el.getAttribute?.("title")
      ].filter(Boolean).join(" "));
      return labels.some((label) => text === label || text.includes(label))
        && !blockedLabels.some((label) => text.includes(label));
    }) || null;
  }

  async function waitForBossDeliverButton(labels, blockedLabels = [], timeoutMs = 3000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const button = findBossDeliverButton(labels, blockedLabels);
      if (button) return button;
      await sleep(250);
    }
    return null;
  }

  async function waitForDeliveryOpened(beforeUrl, task, timeoutMs = 9000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const failure = detectDeliveryFailure("");
      if (failure) return { success: false, message: failure };
      if (isBossChatPage(window.location.href)) {
        return { success: true, message: "已进入Boss沟通页" };
      }
      if (findChatInput()) {
        return { success: true, message: "已打开Boss聊天窗口" };
      }
      const continueButton = findBossDeliverButton(["继续沟通", "已沟通"], []);
      if (continueButton && (!isSameBossJobUrl(beforeUrl, window.location.href) || isSameBossJobUrl(window.location.href, task.url))) {
        return { success: true, message: "Boss沟通状态已更新" };
      }
      await sleep(300);
    }
    return { success: false, message: detectDeliveryFailure("点击立即沟通后未出现聊天窗口或沟通页") };
  }

  function detectDeliveryFailure(fallback) {
    const text = compact(document.body?.innerText || "");
    if (isSecurityPrompt(text)) return "Boss页面出现安全验证，请处理后重试";
    if (isStrongLoginPrompt(text, window.location.href)) return "Boss登录状态失效，请在Chrome中重新登录后重试";
    const reason = firstMatch(text, /(今日沟通.*?已用完|沟通次数.*?已用完|沟通上限|已达上限|账号异常|操作过于频繁|职位已关闭|停止招聘|职位不存在|该职位.*?不存在|暂不接受沟通|无法与该职位沟通|请先完善在线简历|请上传简历|请先完成实名认证)/);
    return reason || fallback || "";
  }

  function classifyDeliveryFailure(message) {
    const text = compact([message, document.body?.innerText || "", window.location.href || ""].filter(Boolean).join(" "));
    let failureType = "UNKNOWN_ERROR";
    if (isStrongLoginPrompt(text, window.location.href) || /(登录|重新登录|未登录|扫码|账号登录)/.test(text)) {
      failureType = "LOGIN_EXPIRED";
    } else if (isSecurityPrompt(text) || /(安全验证|验证码|滑块|验证|风控|实名认证|账号异常|操作过于频繁)/.test(text)) {
      failureType = "PLATFORM_VERIFICATION";
    } else if (/(职位已关闭|停止招聘|职位不存在|该职位.*不存在|岗位关闭|已下线|暂停招聘)/.test(text)) {
      failureType = "JOB_CLOSED";
    } else if (/(已投递|已申请|已沟通|继续沟通|重复投递)/.test(text)) {
      failureType = "ALREADY_DELIVERED";
    } else if (/(未找到.*按钮|按钮不可点击|无法点击|不可点击|未出现聊天窗口|未出现沟通页|暂不接受沟通|无法与该职位沟通)/.test(text)) {
      failureType = "BUTTON_UNCLICKABLE";
    } else if (/(网络|超时|timeout|fetch|HTTP|请求失败|连接失败|未返回结果|发送失败)/i.test(text)) {
      failureType = "NETWORK_ERROR";
    }
    return { failureType, failureReason: message || "Boss投递失败" };
  }

  function normalizeFailurePayload(message) {
    if (message && typeof message === "object") {
      const reason = message.failureReason || message.message || "Boss投递失败";
      return { failureType: message.failureType || classifyDeliveryFailure(reason).failureType, failureReason: reason };
    }
    return classifyDeliveryFailure(String(message || "Boss投递失败"));
  }

  function isBossChatPage(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.hostname.includes("zhipin.com") && /chat|im|message/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function findBossActionButton(kind) {
    const buttons = Array.from(document.querySelectorAll("button, a, [role='button'], div, span"))
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ el, rect: el.getBoundingClientRect(), text: compact(el.innerText || el.textContent || "") }))
      .filter((item) => item.rect.width >= 120 && item.rect.height >= 40 && item.rect.top < Math.max(360, window.innerHeight * 0.45));
    if (!buttons.length) return null;

    const leftSide = buttons.filter((item) => item.rect.left < window.innerWidth * 0.35);
    if (kind === "favorite") {
      return leftSide
        .filter((item) => item.rect.left < window.innerWidth * 0.22)
        .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0]?.el || null;
    }

    return leftSide
      .filter((item) => item.rect.left >= window.innerWidth * 0.15)
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0]?.el || null;
  }

  function clickElement(el) {
    el.scrollIntoView?.({ block: "center", inline: "center" });
    const rect = el.getBoundingClientRect();
    const options = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", options));
    } catch {
      el.dispatchEvent(new MouseEvent("pointerdown", options));
    }
    el.dispatchEvent(new MouseEvent("mousedown", options));
    el.dispatchEvent(new MouseEvent("mouseup", options));
    try {
      el.dispatchEvent(new PointerEvent("pointerup", options));
    } catch {
      // Some older pages may not expose PointerEvent.
    }
    el.dispatchEvent(new MouseEvent("click", options));
    el.click?.();
  }

  function extractBossId(url) {
    const match = String(url || "").match(/\/job_detail\/([^/?#]+)/);
    if (match) return compact(match[1]).replace(/\.html$/i, "");
    try {
      const parsed = new URL(url, window.location.origin);
      return compact(
        parsed.searchParams.get("jobId")
          || parsed.searchParams.get("encryptId")
          || parsed.searchParams.get("securityId")
          || ""
      );
    } catch {
      return "";
    }
  }

  async function scrollForCards(searchJobLimit = 20) {
    const scrollRounds = Math.min(30, Math.max(6, Math.ceil(normalizeSearchJobLimit(searchJobLimit) / 10)));
    const viewportHeight = Number(window.innerHeight || document.documentElement?.clientHeight || 0);
    const scrollStep = Math.max(480, Math.min(900, Math.floor(viewportHeight * 0.9) || 640));
    for (let i = 0; i < scrollRounds && !isStopRequested(); i++) {
      scrollBossResults(scrollStep);
      await humanPause(550, 950);
    }
    resetBossScrollPosition();
  }

  function scrollBossResults(delta, options = {}) {
    const targets = bossScrollableContainers();
    if (options.bottom) {
      window.scrollTo(0, Number(document.documentElement?.scrollHeight || document.body?.scrollHeight || 0));
      targets.forEach((target) => {
        target.scrollTop = target.scrollHeight;
        dispatchBossScrollEvents(target);
      });
      return;
    }
    window.scrollBy(0, delta);
    targets.forEach((target) => {
      target.scrollTop = Math.min(target.scrollHeight, Number(target.scrollTop || 0) + delta);
      dispatchBossScrollEvents(target);
    });
  }

  function resetBossScrollPosition() {
    window.scrollTo(0, 0);
    bossScrollableContainers().forEach((target) => {
      target.scrollTop = 0;
      dispatchBossScrollEvents(target);
    });
  }

  function bossScrollSignature() {
    const pageHeight = Number(document.documentElement?.scrollHeight || document.body?.scrollHeight || 0);
    const pageTop = Number(window.scrollY || window.pageYOffset || 0);
    const containers = bossScrollableContainers().map((target) => `${Math.round(target.scrollTop || 0)}:${target.scrollHeight || 0}`);
    return [pageTop, pageHeight, ...containers].join("|");
  }

  function bossScrollableContainers() {
    const selectors = [
      ".job-list-box",
      ".search-job-result",
      "[class*='job-list']",
      "[class*='search-job-result']",
      "[class*='scroll']"
    ];
    return unique(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))))
      .filter((node) => node && node !== document.body && node !== document.documentElement)
      .filter((node) => Number(node.scrollHeight || 0) > Number(node.clientHeight || 0) + 40);
  }

  function dispatchBossScrollEvents(target) {
    try {
      target.dispatchEvent(new Event("scroll", { bubbles: true }));
      target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 240 }));
    } catch {
      target.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
  }

  async function waitForJobCards() {
    let diagnostics = buildListDiagnostics();
    for (let i = 0; i < 30 && !isStopRequested(); i++) {
      diagnostics = buildListDiagnostics();
      if (collectJobNodes().length > 0 || diagnostics.resultContainers > 0 || diagnostics.hasBlockingState) {
        return { ready: true, diagnostics };
      }
      await sleep(500);
    }
    return { ready: false, diagnostics: buildListDiagnostics() };
  }

  function toList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
    const raw = String(value || "").trim();
    if (!raw) return [];
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map((item) => String(item || "").trim()).filter(Boolean);
      } catch {
        // Fall through to delimiter parsing for bracket lists like [a,b].
      }
      return raw.slice(1, -1).split(/[,，;；\n\r]+/).map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
    return raw.split(/[,，;；\n\r]+/).map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }

  function scanKeywords(message) {
    const config = message?.config || {};
    return uniqueStrings(toList(message?.keywords || config.keywords || config.keyword || "AI产品运营"));
  }

  function first(value, fallback) {
    const list = toList(value);
    return list[0] && list[0] !== "0" ? list[0] : fallback;
  }

  function addList(params, key, value) {
    const list = toList(value).filter((item) => item !== "0" && item !== "不限");
    if (list.length) params.set(key, list.join(","));
  }

  function isCurrentSearchPage(keyword, city, expectedUrl = "") {
    try {
      const current = new URL(window.location.href);
      if (!current.hostname.includes("zhipin.com")) return false;
      if (!isBossSearchPath(current.pathname)) return false;
      if (expectedUrl) return isSameSearchUrl(current.href, expectedUrl);
      const query = current.searchParams.get("query") || "";
      const currentCity = current.searchParams.get("city") || "";
      return compact(decodeURIComponent(query)) === compact(keyword) && (!city || !currentCity || currentCity === city);
    } catch {
      return false;
    }
  }

  function isSameSearchUrl(left, right) {
    try {
      const leftUrl = new URL(left, window.location.origin);
      const rightUrl = new URL(right, window.location.origin);
      return leftUrl.origin === rightUrl.origin
        && sameBossSearchPath(leftUrl.pathname, rightUrl.pathname)
        && SEARCH_PARAM_KEYS.every((key) => (leftUrl.searchParams.get(key) || "") === (rightUrl.searchParams.get(key) || ""));
    } catch {
      return String(left || "") === String(right || "");
    }
  }

  function jobCardRoot(node) {
    if (!node) return node;
    const detailSelector = "a[href*='/job_detail/'], a[href*='job_detail']";
    const detailLink = node.matches?.(detailSelector) ? node : node.querySelector?.(detailSelector);
    if (detailLink) {
      return detailLink.closest?.("li.job-card-box, .job-card-wrapper, [class*='job-card-wrapper'], [class*='job-card-box'], .job-list-box > li, .search-job-result > li, [ka^='search_list_']")
        || detailLink.closest?.("[class*='job-card']")
        || detailLink.closest?.("li")
        || node;
    }

    let current = node;
    while (current && current !== document.body) {
      if (current.querySelector?.(detailSelector)) return current;
      current = current.parentElement;
    }
    return node.closest?.("li.job-card-box, .job-card-wrapper, [class*='job-card'], [ka^='search_list_']")
      || node;
  }

  function isLikelyJobCardNode(node) {
    if (!node || node === document.body || node === document.documentElement) return false;
    const text = compact(node.innerText || node.textContent || "");
    if (!text) return false;
    if (findJobDetailLink(node, node)) return true;
    if (attrText(node, ["data-jobid", "data-job-id", "data-jid", "data-encrypt-id"])) return true;
    return Boolean(text.length >= 8 && /工程师|开发|运营|产品|经理|设计|测试|销售|顾问|算法|前端|后端|全栈|实习|专员/i.test(text));
  }

  function selectorStats() {
    const stats = {};
    JOB_CARD_SELECTORS.forEach((selector) => {
      stats[selector] = document.querySelectorAll(selector).length;
    });
    return stats;
  }

  function buildListDiagnostics() {
    const bodyText = compact(document.body?.innerText || "");
    const currentUrl = window.location.href;
    const stats = selectorStats();
    const resultContainers = SEARCH_RESULT_SELECTORS.reduce((sum, selector) => sum + document.querySelectorAll(selector).length, 0);
    const detailLinks = document.querySelectorAll(BOSS_SELECTORS.DETAIL_LINK_SELECTOR || "a[href*='/job_detail/'], a[href*='job_detail']").length;
    const jobNodes = collectJobNodes();
    const embeddedJobs = collectBossEmbeddedListJobs("");
    const clickableCards = jobNodes.filter(findBossCardClickTarget).length;
    const firstCard = jobNodes[0];
    const firstCardText = compact(firstCard?.innerText || firstCard?.textContent || "").slice(0, 160);
    const hasLoginPrompt = isStrongLoginPrompt(bodyText, currentUrl);
    const hasSecurityPrompt = isSecurityPrompt(bodyText);
    const hasEmptyPrompt = /暂无|没有找到|未找到|无搜索结果|换个关键词|调整筛选/.test(bodyText);
    const pageState = hasSecurityPrompt
      ? "安全验证"
      : hasLoginPrompt
        ? "登录提示"
        : hasEmptyPrompt
          ? "暂无结果"
          : detailLinks > 0 || resultContainers > 0
            ? "已出现搜索结果容器"
            : "未知";
    return {
      currentUrl,
      title: document.title || "",
      detailLinks,
      detailLinkCount: detailLinks,
      resultContainers,
      jobNodes: jobNodes.length,
      embeddedJobs: embeddedJobs.length,
      clickableCards,
      selectorStats: stats,
      selectorCounts: stats,
      pageState,
      firstCardText,
      hasLoginPrompt,
      hasSecurityPrompt,
      hasEmptyPrompt,
      hasBlockingState: hasLoginPrompt || hasSecurityPrompt || hasEmptyPrompt
    };
  }

  function buildPageBlockDiagnostics() {
    const bodyText = compact(document.body?.innerText || "");
    const currentUrl = window.location.href;
    const hasLoginPrompt = isStrongLoginPrompt(bodyText, currentUrl);
    const hasSecurityPrompt = isSecurityPrompt(bodyText);
    return {
      currentUrl,
      title: document.title || "",
      pageState: hasSecurityPrompt ? "安全验证" : hasLoginPrompt ? "登录提示" : "正常",
      hasLoginPrompt,
      hasSecurityPrompt,
      hasEmptyPrompt: false,
      hasBlockingState: hasLoginPrompt || hasSecurityPrompt
    };
  }

  function handleBlockingState(task, diagnostics, meta = {}) {
    if (!diagnostics || !(diagnostics.hasSecurityPrompt || diagnostics.hasLoginPrompt)) return false;
    const state = diagnostics.hasSecurityPrompt ? "安全验证" : "登录提示";
    const diagnostic = buildBossDiagnostic(
      diagnostics.hasSecurityPrompt ? "SECURITY_VERIFICATION" : "LOGIN_REQUIRED",
      "blocked",
      diagnostics
    );
    if (task?.runId) {
      activeScanRunId = normalizeScanRunId(task.runId);
      storeScanTask({
        ...task,
        blockedAt: Date.now(),
        blockState: state
      });
    }
    writeScanStatus({
      isRunning: false,
      stopRequested: false,
      stage: "blocked",
      paused: true,
      resumable: Boolean(task?.runId),
      diagnosticType: diagnostic.type,
      message: diagnostic.message,
      runId: task?.runId,
      startedAt: task?.startedAt,
      updatedAt: Date.now()
    });
    postProgress(task || {}, "warning", diagnostic.message, {
      ...meta,
      operation: "scan",
      stage: "blocked",
      paused: true,
      resumable: Boolean(task?.runId),
      diagnosticType: diagnostic.type,
      impact: diagnostic.impact,
      suggestion: diagnostic.suggestion,
      currentUrl: diagnostics.currentUrl,
      pageState: diagnostics.pageState
    });
    return true;
  }

  function pauseForPageStructureChange(task, diagnostics, details = {}) {
    const diagnostic = buildBossDiagnostic("SELECTOR_MISMATCH", details.stage || "collecting", diagnostics, details);
    const checkpoint = {
      ...task,
      phase: task?.phase || "collecting",
      pausedAt: Date.now(),
      lastError: {
        type: diagnostic.type,
        message: diagnostic.reason,
        failedAt: Date.now()
      }
    };
    storeScanTask(checkpoint);
    writeScanStatus({
      isRunning: false,
      stopRequested: false,
      stage: "blocked",
      paused: true,
      resumable: true,
      diagnosticType: diagnostic.type,
      message: diagnostic.message,
      runId: task?.runId,
      keyword: details.keyword,
      keywordIndex: details.keywordIndex,
      keywordTotal: details.keywordTotal,
      totalSaved: Number(task?.totalSaved || 0),
      startedAt: task?.startedAt,
      updatedAt: Date.now()
    });
    postProgress(task || {}, "error", diagnostic.message, {
      ...details,
      operation: "scan",
      stage: "blocked",
      paused: true,
      resumable: true,
      diagnosticType: diagnostic.type,
      impact: diagnostic.impact,
      suggestion: diagnostic.suggestion,
      currentUrl: diagnostic.currentUrl,
      title: diagnostic.title,
      selectorCounts: diagnostic.selectorCounts,
      detailLinkCount: diagnostic.detailLinkCount,
      candidateCount: diagnostic.candidateCount,
      parsedCount: diagnostic.parsedCount,
      missingFields: diagnostic.missingFields
    });
    return {
      success: false,
      blocked: true,
      resumable: true,
      diagnosticType: diagnostic.type,
      message: diagnostic.message,
      saved: Number(task?.totalSaved || 0),
      totalSaved: Number(task?.totalSaved || 0)
    };
  }

  function isSecurityPrompt(text) {
    const hasNormalContent = hasNormalBossPageContent();
    const hasChallengeUi = hasVisibleBossSecurityUi();
    if (typeof SCAN_SUPPORT.isBossSecurityPage === "function") {
      return SCAN_SUPPORT.isBossSecurityPage({
        url: window.location.href,
        title: document.title || "",
        text,
        hasNormalContent,
        hasChallengeUi
      });
    }
    return hasChallengeUi || (!hasNormalContent && /请.{0,12}(?:完成|进行|通过).{0,8}验证|请.{0,8}(?:拖动|按住).{0,8}滑块|访问异常/.test(text || ""));
  }

  function hasNormalBossPageContent() {
    const path = String(window.location.pathname || "");
    if (/\/job_detail\//.test(path)) {
      return Boolean(document.querySelector(".job-banner, .job-detail, .job-detail-box, .job-detail-container, [class*='job-detail']"));
    }
    if (isBossSearchPath(path)) {
      return document.querySelectorAll("a[href*='/job_detail/'], a[href*='job_detail']").length > 0;
    }
    return false;
  }

  function hasVisibleBossSecurityUi() {
    const selectors = [
      "iframe[src*='captcha' i]",
      "iframe[src*='verify' i]",
      "[class*='geetest' i]",
      "[id*='geetest' i]",
      "[class*='captcha' i]",
      "[id*='captcha' i]",
      "[class*='verify-slider' i]",
      "[id*='verify-slider' i]",
      "[class*='security-check' i]",
      "[id*='security-check' i]"
    ];
    if (selectors.some((selector) => Array.from(document.querySelectorAll(selector)).some(isVisibleElement))) return true;
    const instructionMatcher = SCAN_SUPPORT.isBossSecurityInstructionText;
    if (typeof instructionMatcher !== "function") return false;
    const overlays = document.querySelectorAll("[role='dialog'], [aria-modal='true'], [class*='dialog' i], [class*='modal' i]");
    return Array.from(overlays).some((node) => isVisibleElement(node) && instructionMatcher(node.innerText || node.textContent || ""));
  }

  function isVisibleElement(node) {
    if (!node || typeof node.getBoundingClientRect !== "function") return false;
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle?.(node);
    return rect.width > 0
      && rect.height > 0
      && style?.display !== "none"
      && style?.visibility !== "hidden"
      && style?.opacity !== "0";
  }

  function isStrongLoginPrompt(text, url) {
    const current = String(url || "");
    if (/passport|login|user\/login|扫码登录|二维码登录/.test(current)) return true;
    return /请登录后|登录后查看|扫码登录|二维码登录|请扫码|未登录/.test(text || "");
  }

  function buildNavigationKey(keyword, city) {
    return `${keyword}::${city}`;
  }

  function isBossSearchPath(pathname) {
    return pathname === "/web/geek/job" || pathname === "/web/geek/jobs";
  }

  function sameBossSearchPath(left, right) {
    if (isBossSearchPath(left) && isBossSearchPath(right)) return true;
    return left === right;
  }

  function openSearchPage(url, task) {
    const attempts = Number(task.navigationAttempts || 1);
    scheduleSearchNavigationRetry(url, task, attempts);
    requestBackgroundNavigation(url).then((response) => {
      if (response?.success) return;
      navigateSearchPageInCurrentFrame(url, attempts);
    }).catch(() => {
      navigateSearchPageInCurrentFrame(url, attempts);
    });

    window.setTimeout(() => {
      const stored = readStoredScanTask();
      if (!stored || stored.runId !== task.runId || stored.navigationKey !== task.navigationKey) return;
      if (!isSearchNavigationPending(stored) || isSameSearchUrl(window.location.href, url)) return;
      navigateSearchPageInCurrentFrame(url, attempts);
    }, 350);
  }

  function requestBackgroundNavigation(url) {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      return Promise.resolve({ success: false });
    }
    return chrome.runtime.sendMessage({
      source: "GET_JOBS_BOSS_CONTENT",
      type: "BOSS_NAVIGATE_TAB",
      url
    });
  }

  function navigateSearchPageInCurrentFrame(url, attempts) {
    if (attempts > 1) {
      window.location.replace(url);
    } else {
      window.location.assign(url);
    }
  }

  function scheduleSearchNavigationRetry(url, task, attempts) {
    window.setTimeout(() => {
      const stored = readStoredScanTask();
      if (!stored || stored.runId !== task.runId || stored.navigationKey !== task.navigationKey) return;
      if (!isSearchNavigationPending(stored) || isSameSearchUrl(window.location.href, url)) return;

      if (attempts >= SEARCH_NAVIGATION_MAX_ATTEMPTS) {
        stopSearchNavigationFailure(stored, url);
        return;
      }

      const nextAttempts = Number(stored.navigationAttempts || attempts || 0) + 1;
      const retryTask = {
        ...stored,
        navigationAttempts: nextAttempts,
        navigationStartedAt: Date.now()
      };
      storeScanTask(retryTask);
      postProgress(retryTask, "warning", `Boss搜索页跳转未完成，正在重试打开搜索页：${retryTask.expectedKeyword || ""}。当前URL：${window.location.href}`, {
        operation: "scan",
        stage: "searching",
        keyword: retryTask.expectedKeyword || "",
        keywordIndex: Number(retryTask.currentIndex || 0) + 1,
        keywordTotal: scanKeywords(retryTask).length,
        currentUrl: window.location.href,
        targetUrl: url,
        navigationAttempts: nextAttempts,
        totalSaved: Number(retryTask.totalSaved || 0)
      });
      openSearchPage(url, retryTask);
    }, SEARCH_NAVIGATION_RETRY_MS);
  }

  function stopSearchNavigationFailure(task, url) {
    const keyword = task.expectedKeyword || scanKeywords(task)[Number(task.currentIndex || 0)] || "";
    const keywordTotal = scanKeywords(task).length;
    const totalSaved = Number(task.totalSaved || 0);
    const navigationAttempts = Number(task.navigationAttempts || 0);
    const diagnostic = buildBossDiagnostic("WRONG_PAGE", "navigationFailed", {
      currentUrl: window.location.href,
      title: document.title || "",
      selectorCounts: {},
      detailLinkCount: 0
    });
    const message = `Boss搜索页打开失败：${keyword}。${diagnostic.message} 扫描断点将在24小时内保留。`;
    storeScanTask({
      ...task,
      pausedAt: Date.now(),
      lastError: {
        type: "NAVIGATION_FAILED",
        message,
        failedAt: Date.now()
      }
    });
    writeScanStatus({
      isRunning: false,
      stopRequested: false,
      stage: "blocked",
      paused: true,
      resumable: true,
      diagnosticType: "NAVIGATION_FAILED",
      message,
      runId: task.runId,
      keyword,
      keywordIndex: Number(task.currentIndex || 0) + 1,
      keywordTotal,
      totalSaved,
      saved: totalSaved,
      startedAt: task.startedAt,
      updatedAt: Date.now()
    });
    postProgress(task, "error", message, {
      operation: "scan",
      stage: "blocked",
      paused: true,
      resumable: true,
      diagnosticType: "NAVIGATION_FAILED",
      impact: "搜索页没有成功打开，本关键词尚未完成。",
      suggestion: "确认Boss页面可以正常访问后，再次点击扫描继续。",
      keyword,
      keywordIndex: Number(task.currentIndex || 0) + 1,
      keywordTotal,
      currentUrl: window.location.href,
      targetUrl: url,
      navigationAttempts,
      totalSaved,
      saved: totalSaved
    });
    return { success: false, message, navigationFailed: true, blocked: true, resumable: true, saved: totalSaved, totalSaved };
  }

  function isSearchNavigationPending(task) {
    if (String(task?.phase || "") !== "searching" || !task?.expectedSearchUrl) return false;
    const startedAt = Number(task.navigationStartedAt || task.updatedAt || 0);
    return Boolean(startedAt && Date.now() - startedAt < SEARCH_NAVIGATION_GRACE_MS);
  }

  function isAutoDeliverEnabled(message) {
    const value = message?.autoDeliver ?? message?.config?.autoDeliver ?? message?.config?.auto_deliver;
    return value === true || value === 1 || value === "1" || value === "true";
  }

  function shouldAppendAiKeywords(task) {
    const config = task?.config || {};
    const value = task?.appendAiKeywords
      ?? task?.expandAiKeywords
      ?? config.appendAiKeywords
      ?? config.expandAiKeywords
      ?? config.enableAiKeywords;
    return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
  }

  function uniqueStrings(values) {
    const out = [];
    toList(values).forEach((item) => {
      if (!out.some((existing) => sameKeyword(existing, item))) out.push(item);
    });
    return out;
  }

  function sameKeyword(left, right) {
    return compact(left).toLowerCase() === compact(right).toLowerCase();
  }

  function textOf(root, selectors) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      const text = compact(node?.innerText || node?.textContent || "");
      if (text) return text;
    }
    return "";
  }

  function bossDetailDescription() {
    const selectors = [
      ".job-detail-section .text",
      ".job-detail-section",
      ".job-description",
      ".job-sec .job-sec-text",
      ".job-sec .text",
      ".job-sec-text",
      ".job-detail-section",
      ".job-detail",
      ".detail-content",
      "[class*='job-detail']",
      "[class*='job-sec']"
    ];
    const parts = selectors
      .map((selector) => textOf(document, [selector]))
      .filter(Boolean);
    return compact(unique(parts).join("\n"));
  }

  async function extractBossDetailJsonFields(job) {
    const urls = bossDetailApiUrls(job);
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          method: "GET",
          credentials: "include",
          headers: { "Accept": "application/json,text/plain,*/*" }
        });
        if (!response.ok) continue;
        const text = await response.text();
        const data = JSON.parse(text);
        const fields = parseBossDetailJson(data, job);
        if (fields.title || fields.company || fields.description) return fields;
      } catch {
        // Boss sometimes blocks direct detail-json replays; DOM extraction below remains the fallback.
      }
    }
    return extractBossEmbeddedJsonFields(job);
  }

  function extractBossEmbeddedJsonFields(job) {
    const scripts = Array.from(document.querySelectorAll("script[type='application/json'], script#__NEXT_DATA__, script"));
    for (const script of scripts) {
      const raw = String(script.textContent || "").trim();
      if (!raw || raw.length < 50) continue;
      // 放宽匹配：除了 jobInfo/zpData/brandComInfo，也匹配岗位详情特征字段
      const hasDetailSignal = /jobInfo|zpData|brandComInfo/i.test(raw);
      const hasDetailFieldSignal = /\bencryptJobId\b|\bencryptId\b/i.test(raw)
        && /(?:postDescription|jobDescription|description|salaryDesc|jobName|brandName)/i.test(raw);
      if (!hasDetailSignal && !hasDetailFieldSignal) continue;
      try {
        const data = JSON.parse(raw);
        const fields = parseBossDetailJson(data, job);
        if (fields.title || fields.company || fields.description) return fields;
      } catch {
        // Non-JSON scripts are ignored; DOM extraction remains available.
      }
    }
    return {};
  }

  function bossDetailApiUrls(job) {
    const urls = [];
    const addUrl = (value) => {
      try {
        const parsed = new URL(value, window.location.origin);
        if (parsed.hostname.includes("zhipin.com") && parsed.pathname.includes("/wapi/zpgeek/job/detail.json")) {
          urls.push(parsed.href);
        }
      } catch {
        // Ignore invalid candidates.
      }
    };

    Array.from(performance.getEntriesByType?.("resource") || [])
      .map((entry) => entry.name)
      .filter((name) => String(name || "").includes("/wapi/zpgeek/job/detail.json"))
      .reverse()
      .forEach(addUrl);

    [window.location.href, job?.url].forEach((value) => {
      try {
        const parsed = new URL(value, window.location.origin);
        if (!parsed.hostname.includes("zhipin.com")) return;
        if (!parsed.pathname.includes("/job_detail/")) return;
        const query = parsed.search || "";
        if (query) addUrl(`${parsed.origin}/wapi/zpgeek/job/detail.json${query}`);
      } catch {
        // Ignore invalid detail URLs.
      }
    });

    return uniqueStrings(urls).slice(0, 5);
  }

  function parseBossDetailJson(data, job) {
    const zpData = findBossDetailPayload(data) || data?.zpData || data?.data?.zpData || data?.data || data || {};
    const jobInfo = zpData.jobInfo || zpData.jobDetail || zpData.job || {};
    const brand = zpData.brandComInfo || zpData.brandInfo || zpData.companyInfo || zpData.brand || {};
    const bossInfo = zpData.bossInfo || zpData.recruiterInfo || zpData.userInfo || {};
    const id = compact(
      jobInfo.encryptId
        || jobInfo.jobId
        || jobInfo.securityId
        || extractBossId(window.location.href)
        || extractBossId(job?.url)
    );
    return {
      id,
      userId: compact(jobInfo.encryptUserId || bossInfo.encryptUserId || bossInfo.encryptBossId || bossInfo.userId),
      title: compact(jobInfo.jobName || jobInfo.name || jobInfo.title),
      company: compact(brand.brandName || brand.companyName || brand.name || jobInfo.brandName),
      salary: compact(jobInfo.salaryDesc || jobInfo.salary || jobInfo.salaryName),
      location: compact(jobInfo.locationName || jobInfo.cityName || jobInfo.address),
      experience: compact(jobInfo.experienceName || jobInfo.experience),
      degree: compact(jobInfo.degreeName || jobInfo.degree),
      hrName: compact(bossInfo.name || bossInfo.bossName || bossInfo.recruiterName),
      hrTitle: compact(bossInfo.title || bossInfo.position || bossInfo.identity),
      hrActive: compact(bossInfo.activeTimeDesc || bossInfo.activeTime || bossInfo.lastLoginTimeDesc),
      description: trimToUsefulLength(jobInfo.postDescription || jobInfo.description || jobInfo.jobDescription || "", 8000),
      companyInfo: trimToUsefulLength(brand.introduce || brand.companyIntroduce || brand.description || "", 3000),
      companyAddress: compact(jobInfo.address || jobInfo.locationAddress || brand.address),
      industry: compact(brand.industryName || brand.industry),
      financingStage: compact(brand.stageName || brand.financingStage || brand.financeStage),
      companyScale: compact(brand.scaleName || brand.scale),
      deliveryStatus: "",
      recruitmentStatus: compact(jobInfo.jobStatusDesc || jobInfo.statusDesc)
    };
  }

  function findBossDetailPayload(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 6) return null;
    if (value.zpData && typeof value.zpData === "object") return value.zpData;
    if (value.jobInfo || value.jobDetail || value.brandComInfo || value.bossInfo) return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findBossDetailPayload(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    for (const key of Object.keys(value)) {
      const found = findBossDetailPayload(value[key], depth + 1);
      if (found) return found;
    }
    return null;
  }

  function extractBossDetailFields(job) {
    const modularDetail = window.GetJobsBossDetailCollector?.collectCurrentDetail?.(job) || {};
    const bodyText = compact(document.body?.innerText || "");
    const sections = parseBossTextSections(bodyText);
    const tags = bossDetailTags();
    const bannerText = textOf(document, [
      ".job-banner",
      ".job-primary",
      ".job-detail-header",
      "[class*='job-banner']",
      "[class*='job-primary']"
    ]);
    const hr = extractHrInfo(bodyText);
    const companyFacts = extractCompanyFacts(bodyText);
    const description = firstNonEmpty(
      modularDetail.description,
      bossDetailDescription(),
      sections.jobRequirement,
      sections.jobDescription,
      sections.duty,
      bodyText
    );
    const companyInfo = firstNonEmpty(
      modularDetail.companyInfo,
      textOf(document, [
        ".job-sec.company-info",
        ".company-info",
        ".sider-company",
        ".company-detail",
        "[class*='company-info']"
      ]),
      sections.companyInfo
    );

    return {
      title: firstNonEmpty(modularDetail.title, textOf(document, [".job-title", ".job-name", ".name", "h1"]), job.title),
      company: firstNonEmpty(modularDetail.company, textOf(document, [".company-name", ".sider-company .name", ".company-card .name", "[class*='company-name']"]), job.company),
      salary: firstNonEmpty(modularDetail.salary, textOf(document, [".salary", ".job-banner .salary", "[class*='salary']"]), guessSalary(bannerText || bodyText), job.salary),
      location: firstNonEmpty(modularDetail.location, tags.location, job.location),
      experience: firstNonEmpty(modularDetail.experience, tags.experience, job.experience),
      degree: firstNonEmpty(modularDetail.degree, tags.degree, job.degree),
      hrName: firstNonEmpty(modularDetail.hrName, textOf(document, [".boss-name", "[class*='boss-name']", ".boss-info .name", ".recruiter-name"]), hr.name, job.hrName),
      hrTitle: firstNonEmpty(modularDetail.hrTitle, textOf(document, [".boss-title", "[class*='boss-title']", ".boss-info .gray", ".recruiter-title"]), hr.title, job.hrTitle),
      hrActive: firstNonEmpty(modularDetail.hrActive, textOf(document, [".boss-active-time", "[class*='active']"]), hr.active, job.hrActive),
      description: description === bodyText ? trimToUsefulLength(bodyText, 6000) : description,
      companyInfo: companyInfo === bodyText ? trimToUsefulLength(companyInfo, 2000) : companyInfo,
      companyAddress: firstNonEmpty(modularDetail.companyAddress, textOf(document, [".job-address", ".location-address", "[class*='address']"]), sections.address),
      industry: firstNonEmpty(companyFacts.industry, textOf(document, [".company-tags", ".sider-company [class*='industry']"])),
      financingStage: companyFacts.financingStage,
      companyScale: companyFacts.companyScale,
      deliveryStatus: detectBossDeliveryStatus(document),
      recruitmentStatus: firstNonEmpty(textOf(document, [".job-status", "[class*='job-status']"]), firstMatch(bodyText, /(招聘中|急招|停止招聘|已关闭|暂停招聘)/))
    };
  }

  function detectBossDeliveryStatus(root = document) {
    const text = compact([
      ...Array.from(root.querySelectorAll?.("button, a, [role='button']") || [])
        .filter((el) => el.offsetParent !== null)
        .map((el) => [el.innerText, el.textContent, el.getAttribute?.("aria-label"), el.getAttribute?.("title")].filter(Boolean).join(" ")),
      root === document ? "" : root.innerText
    ].filter(Boolean).join(" "));
    if (/(继续沟通|已沟通|已投递|已申请)/.test(text)) return "已投递";
    return "";
  }

  function parseBossTextSections(text) {
    const normalized = compact(text);
    return {
      jobRequirement: sectionBetween(normalized, ["职位描述", "岗位职责", "岗位要求", "任职要求", "工作内容"], ["公司介绍", "工商信息", "团队介绍", "工作地址", "BOSS信息", "看准"]),
      jobDescription: sectionBetween(normalized, ["职位描述", "岗位描述"], ["公司介绍", "工作地址", "工商信息", "BOSS信息"]),
      duty: sectionBetween(normalized, ["岗位职责", "工作职责", "工作内容"], ["任职要求", "公司介绍", "工作地址"]),
      companyInfo: sectionBetween(normalized, ["公司介绍", "公司简介", "关于我们"], ["工商信息", "工作地址", "BOSS信息", "职位描述"]),
      address: sectionBetween(normalized, ["工作地址", "公司地址", "办公地址"], ["职位描述", "公司介绍", "工商信息", "BOSS信息"])
    };
  }

  function sectionBetween(text, startLabels, endLabels) {
    if (!text) return "";
    let start = -1;
    let labelLength = 0;
    for (const label of startLabels) {
      const index = text.indexOf(label);
      if (index >= 0 && (start < 0 || index < start)) {
        start = index;
        labelLength = label.length;
      }
    }
    if (start < 0) return "";
    let end = text.length;
    for (const label of endLabels) {
      const index = text.indexOf(label, start + labelLength);
      if (index > start && index < end) end = index;
    }
    return trimToUsefulLength(text.slice(start + labelLength, end), 6000);
  }

  function extractHrInfo(text) {
    const source = compact(text);
    const bossBlock = sectionBetween(source, ["BOSS信息", "招聘者", "联系人"], ["职位描述", "公司介绍", "工作地址", "工商信息"]);
    const active = firstMatch(bossBlock || source, /(刚刚活跃|今日活跃|[0-9]+小时前活跃|[0-9]+天前活跃|[0-9]+周前活跃|[0-9]+月前活跃|[0-9]+年前活跃|在线)/);
    const name = firstGroupMatch(bossBlock, /([\u4e00-\u9fa5A-Za-z]{1,12})(?:\s+)(?:HR|招聘|人事|经理|主管|负责人|顾问|猎头|招聘者)/);
    const title = firstMatch(bossBlock || source, /(HR|招聘专员|招聘经理|人事|人事经理|技术负责人|部门负责人|猎头顾问|顾问|经理|主管)/);
    return { name, title, active };
  }

  function extractCompanyFacts(text) {
    const source = compact(text);
    return {
      industry: firstMatch(source, /(互联网|电子商务|人工智能|企业服务|软件服务|计算机软件|游戏|金融|医疗健康|教育培训|广告营销|文化传媒|物流|新能源|智能硬件|数据服务)/),
      financingStage: firstMatch(source, /(未融资|天使轮|A轮|B轮|C轮|D轮及以上|已上市|不需要融资)/),
      companyScale: firstMatch(source, /([0-9]+-[0-9]+人|[0-9]+人以上|少于[0-9]+人)/)
    };
  }

  function summarizeJobCollection(jobs) {
    return jobs.reduce((acc, job) => {
      if (!compact(job?.title)) acc.missingTitle += 1;
      if (!compact(job?.company)) acc.missingCompany += 1;
      if (!compact(job?.description) || compact(job.description).length < 30) acc.missingDescription += 1;
      if (!compact(job?.hrName)) acc.missingHr += 1;
      return acc;
    }, { missingTitle: 0, missingCompany: 0, missingDescription: 0, missingHr: 0 });
  }

  function isSubmittableJob(job) {
    return Boolean(
      !job?.detailNavigationFailed
        && compact(job?.title)
        && !isInvalidBossCandidateTitle(job?.title)
        && !isBossNonJobNavigationTitle(job?.title)
        && compact(job?.company)
        && isBossJobDetailUrl(normalizeBossJobUrl(job?.url))
    );
  }

  function normalizeJobForSubmit(job) {
    return {
      ...job,
      title: compact(job.title),
      company: compact(job.company),
      deliveryStatus: normalizePlatformDeliveryStatus(job.deliveryStatus),
      description: trimToUsefulLength(job.description || "", 8000),
      companyInfo: trimToUsefulLength(job.companyInfo || "", 3000),
      keyword: job.keyword || ""
    };
  }

  function normalizePlatformDeliveryStatus(status) {
    return isDeliveredStatus(status) ? "已投递" : "";
  }

  function isDeliveredStatus(status) {
    return compact(status) === "已投递";
  }

  function firstNonEmpty(...values) {
    for (const value of values) {
      const text = compact(value || "");
      if (text) return text;
    }
    return "";
  }

  function bossStateText(source, paths) {
    for (const path of paths) {
      const value = readStatePath(source, path);
      if (value === null || value === undefined) continue;
      if (typeof value === "object") continue;
      const text = compact(String(value));
      if (text && text !== "null" && text !== "undefined") return text;
    }
    return "";
  }

  function readStatePath(source, path) {
    return String(path || "").split(".").reduce((current, key) => {
      if (current === null || current === undefined) return undefined;
      return current[key];
    }, source);
  }

  function extractJsonObjectAfter(text, marker) {
    const source = String(text || "");
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) return "";
    const start = source.indexOf("{", markerIndex);
    if (start < 0) return "";
    return balancedJsonSlice(source, start);
  }

  function balancedJsonSlice(text, start) {
    let depth = 0;
    let inString = false;
    let quote = "";
    let escaped = false;
    for (let index = start; index < text.length; index++) {
      const ch = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          inString = false;
        }
        continue;
      }
      if (ch === "\"" || ch === "'") {
        inString = true;
        quote = ch;
        continue;
      }
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(start, index + 1);
      }
    }
    return "";
  }

  function trimToUsefulLength(text, limit) {
    const value = compact(text || "");
    if (!value) return "";
    return value.length > limit ? value.slice(0, limit) : value;
  }

  function stripHtml(text) {
    return compact(String(text || "").replace(/<[^>]+>/g, " "));
  }

  function bossDetailTags() {
    const text = compact(document.body?.innerText || "");
    const tagText = textOf(document, [
      ".job-primary .tag-list",
      ".job-banner .tag-list",
      ".job-tags",
      ".job-request",
      "[class*='tag-list']"
    ]);
    const tags = compact(tagText).split(/\s+/).filter(Boolean);
    const matchedLocation = tags.find((item) => /北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|长沙|重庆|天津|郑州|厦门|合肥|佛山|东莞|珠海|中山|全国|远程/.test(item)) || "";
    const experience = tags.find((item) => /经验|在校|应届|不限/.test(item)) || "";
    const degree = tags.find((item) => /本科|大专|硕士|博士|学历不限|高中|中专/.test(item)) || "";
    return {
      location: matchedLocation || firstMatch(text, /(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|长沙|重庆|天津|郑州|厦门|合肥|佛山|东莞|珠海|中山|全国|远程)[^\s，,。]*/),
      experience: experience || firstMatch(text, /(经验不限|不限经验|在校\/应届|应届|[0-9]+-[0-9]+年|[0-9]+年以内|[0-9]+年以上)/),
      degree: degree || firstMatch(text, /(学历不限|本科|大专|硕士|博士|高中|中专)/)
    };
  }

  function firstMatch(text, pattern) {
    const match = String(text || "").match(pattern);
    return match ? match[0] : "";
  }

  function firstGroupMatch(text, pattern) {
    const match = String(text || "").match(pattern);
    return match ? (match[1] || match[0]) : "";
  }

  function isSameUrl(left, right) {
    try {
      const leftUrl = new URL(left, window.location.origin);
      const rightUrl = new URL(right, window.location.origin);
      return leftUrl.origin === rightUrl.origin && leftUrl.pathname === rightUrl.pathname;
    } catch {
      return String(left || "") === String(right || "");
    }
  }

  function isSameBossJobUrl(left, right) {
    const leftId = extractBossId(left);
    const rightId = extractBossId(right);
    if (leftId && rightId) return leftId === rightId;
    return isSameUrl(left, right);
  }

  function compact(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function firstLine(text) {
    return compact(text).split(" ")[0] || "";
  }

  function guessSalary(text) {
    const match = String(text || "").match(/\d+\s*-\s*\d+K(?:·\d+薪)?|\d+K(?:·\d+薪)?|面议/i);
    return match ? match[0].replace(/\s+/g, "") : "";
  }

  function guessCompany(text) {
    const parts = compact(text).split(" ");
    return parts.length > 1 ? parts[1] : "";
  }

  function unique(nodes) {
    return Array.from(new Set(nodes));
  }

  function waitForPage() {
    if (document.readyState === "complete" || document.readyState === "interactive") return Promise.resolve();
    return new Promise((resolve) => window.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tick = () => {
        if (isStopRequested() || Date.now() - startedAt >= ms) {
          resolve();
          return;
        }
        setTimeout(tick, Math.min(200, ms - (Date.now() - startedAt)));
      };
      tick();
    });
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function humanPause(minMs, maxMs) {
    return sleep(randomInt(minMs, maxMs));
  }
})();
