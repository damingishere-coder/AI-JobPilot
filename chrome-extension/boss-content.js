(function () {
  const EXTENSION_VERSION = "2026-06-04-boss-page-status-1";
  if (window.__GET_JOBS_BOSS_CONTENT_VERSION__ === EXTENSION_VERSION) return;
  window.__GET_JOBS_BOSS_CONTENT__ = true;
  window.__GET_JOBS_BOSS_CONTENT_VERSION__ = EXTENSION_VERSION;

  const API_BASE = "http://localhost:8888";
  const SCAN_TASK_KEY = "__GET_JOBS_BOSS_SCAN_TASK__";
  const SCAN_CANCEL_KEY = "__GET_JOBS_BOSS_SCAN_CANCEL__";
  const SCAN_STATUS_KEY = "__GET_JOBS_BOSS_SCAN_STATUS__";
  const KEYWORD_CURSOR_KEY = "__GET_JOBS_BOSS_KEYWORD_CURSOR__";
  const SCAN_TASK_TTL_MS = 30 * 60 * 1000;
  const SEARCH_NAVIGATION_GRACE_MS = 60 * 1000;
  const SEARCH_NAVIGATION_RETRY_MS = 2500;
  const SEARCH_NAVIGATION_MAX_ATTEMPTS = 5;
  const SEARCH_PARAM_KEYS = ["city", "jobType", "salary", "experience", "degree", "scale", "industry", "stage", "query"];
  const JOB_CARD_SELECTORS = [
    "li.job-card-box",
    ".job-card-wrapper",
    ".job-card-body",
    ".job-list-box li",
    ".search-job-result li",
    "[ka^='search_list_']",
    "a[href*='/job_detail/']"
  ];
  const SEARCH_RESULT_SELECTORS = [
    ".job-list-box",
    ".search-job-result",
    ".job-card-wrapper",
    ".job-card-body",
    "li.job-card-box",
    "a[href*='/job_detail/']"
  ];
  let stopRequested = false;
  let activeScanPromise = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (window.__GET_JOBS_BOSS_CONTENT_VERSION__ !== EXTENSION_VERSION) return;

    if (message?.type === "PING_CONTENT") {
      sendResponse({ success: true, version: EXTENSION_VERSION });
      return;
    }
    if (message?.type === "GET_BOSS_CONTENT_VERSION") {
      sendResponse({ success: true, version: EXTENSION_VERSION });
      return;
    }
    if (message?.type === "BOSS_SCAN_STOP") {
      stopRequested = true;
      storeStopRequested();
      clearStoredScanTask();
      writeScanStatus({ isRunning: false, stopRequested: true, stage: "stopped", message: "已请求停止Boss扫描" });
      postProgress(message, "warning", "Boss Chrome扫描停止请求已接收，正在中断当前任务。", {
        operation: "scan",
        stage: "stopping"
      });
      sendResponse({ success: true, message: "已请求停止Boss扫描" });
      return;
    }
    if (message?.type === "BOSS_SCAN_STATUS") {
      const task = readStoredScanTask();
      const hasResumableTask = Boolean(task && isResumableScanTask(task));
      if (task && !hasResumableTask) {
        clearStoredScanTask();
        writeScanStatus({
          isRunning: false,
          stopRequested: false,
          stage: "idle",
          message: "Boss旧扫描任务已清理"
        });
      }
      const status = readScanStatus();
      sendResponse({
        success: true,
        ...status,
        runId: status.runId || task?.runId || "",
        hasStoredTask: hasResumableTask
      });
      return;
    }
    if (message?.type === "BOSS_PAGE_STATUS") {
      sendResponse(buildBossPageStatus());
      return;
    }
    if (message?.type === "BOSS_SCAN_START") {
      stopRequested = false;
      clearStopRequested();
      startScan(message);
      sendResponse({ success: true, message: "Boss Chrome扫描任务已启动。" });
      return;
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

  resumeStoredScanTaskIfActive();

  function startScan(message) {
    const task = normalizeScanTask(message);
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
    runScan(task).catch((error) => {
      clearStoredScanTask();
      writeScanStatus({
        isRunning: false,
        stopRequested: false,
        stage: "error",
        message: error.message || String(error),
        runId: task.runId,
        startedAt: task.startedAt,
        updatedAt: Date.now()
      });
      postProgress(task, "error", error.message || String(error), {
        operation: "scan",
        stage: "error"
      });
    });
  }

  function resumeStoredScanTaskIfActive() {
    const task = readStoredScanTask();
    if (isStopRequested()) {
      stopRequested = true;
      clearStoredScanTask();
      writeScanStatus({ isRunning: false, stopRequested: true, stage: "stopped", message: "Boss扫描已取消" });
      return;
    }
    if (!task || task.completed || stopRequested) return;
    if (!isResumableScanTask(task)) {
      clearStoredScanTask();
      writeScanStatus({
        isRunning: false,
        stopRequested: false,
        stage: "idle",
        message: "Boss旧扫描任务已过期或不适合恢复"
      });
      return;
    }

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
    runScan(task).catch((error) => {
      clearStoredScanTask();
      writeScanStatus({
        isRunning: false,
        stopRequested: false,
        stage: "error",
        message: error.message || String(error),
        runId: task.runId,
        startedAt: task.startedAt,
        updatedAt: Date.now()
      });
      postProgress(task, "error", error.message || String(error), {
        operation: "scan",
        stage: "error",
        keywordIndex: Number(task.currentIndex || 0) + 1,
        keywordTotal: scanKeywords(task).length,
        totalSaved: Number(task.totalSaved || 0)
      });
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
    const city = first(config.cityCode, "101280600");
    let currentIndex = normalizeTaskIndex(task.currentIndex, keywords.length);
    let totalSaved = Number(task.totalSaved || 0);

    if (!keywords.length) {
      throw new Error("Boss扫描缺少关键词，请先在Boss配置中填写关键词。");
    }

    if (isStopRequested()) {
      stopRequested = true;
    }

    for (let index = currentIndex; index < keywords.length; index++) {
      if (isStopRequested()) stopRequested = true;
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

      if (task.phase === "detail") {
        if (isStopRequested()) {
          stopRequested = true;
          break;
        }
        const detailResult = await continueBossDetailScan(task, keyword, runId, baseMeta);
        if (detailResult.pendingNavigation) return detailResult;
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
        stopRequested = true;
        break;
      }

      if (!isCurrentSearchPage(keyword, city, url)) {
        if (navigationAttempts >= SEARCH_NAVIGATION_MAX_ATTEMPTS) {
          const failedTaskState = {
            ...searchTaskState,
            navigationAttempts
          };
          task = skipSearchNavigationKeyword(failedTaskState, url, { resume: false });
          continue;
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
      if (isStopRequested()) {
        stopRequested = true;
        break;
      }
      postProgress(task, "info", "Boss搜索页已就绪，等待岗位列表加载。", {
        ...baseMeta,
        stage: "loading",
        currentUrl: window.location.href
      });
      const waitState = await waitForJobCards();
      if (isStopRequested()) {
        stopRequested = true;
        break;
      }
      if (handleBlockingState(task, waitState.diagnostics, baseMeta)) {
        stopRequested = true;
        break;
      }
      postProgress(task, "info", `Boss岗位列表加载检查完成，开始滚动采集。详情链接 ${waitState.diagnostics.detailLinks} 个，搜索结果容器 ${waitState.diagnostics.resultContainers} 个。`, {
        ...baseMeta,
        stage: "collecting",
        ...waitState.diagnostics
      });
      const searchJobLimit = normalizeSearchJobLimit(task.config?.searchJobLimit);
      await scrollForCards(searchJobLimit);
      if (isStopRequested()) {
        stopRequested = true;
        break;
      }

      const collectResult = collectJobs(keyword, task, baseMeta);
      const candidates = collectResult.jobs;
      postProgress(task, "info", `Boss Chrome卡片解析完成：节点 ${collectResult.nodeCount} 个，成功 ${collectResult.parsed} 个，跳过 ${collectResult.skipped} 个。`, {
        ...baseMeta,
        stage: "collecting",
        nodeCount: collectResult.nodeCount,
        parsed: collectResult.parsed,
        skipped: collectResult.skipped,
        errorCount: collectResult.errorCount
      });
      if (!candidates.length) {
        const diagnostics = buildListDiagnostics();
        if (handleBlockingState(task, diagnostics, baseMeta)) {
          stopRequested = true;
          break;
        }
        postProgress(task, "warning", `Boss Chrome未采集到岗位：${keyword}。当前URL=${diagnostics.currentUrl}，标题=${diagnostics.title}，详情链接=${diagnostics.detailLinks}，搜索结果容器=${diagnostics.resultContainers}，状态=${diagnostics.pageState}，首个卡片=${diagnostics.firstCardText}。可能未登录/安全验证/页面结构变化/筛选无结果。`, {
          ...baseMeta,
          stage: "empty",
          collected: 0,
          ...diagnostics
        });
        advanceKeywordCursor(task, index + 1, keyword);
        storeScanTask({ ...task, phase: "nextKeyword", currentIndex: index + 1, totalSaved });
        continue;
      }

      const dedupeResult = await filterDuplicateJobs(candidates, task, baseMeta);
      const freshCandidates = dedupeResult.jobs;
      const jobs = freshCandidates.slice(0, searchJobLimit);
      postProgress(task, dedupeResult.duplicateCount > 0 ? "info" : "success", `Boss重复岗位检查完成：候选 ${candidates.length} 个，已接触 ${dedupeResult.duplicateCount} 个，新岗位 ${freshCandidates.length} 个，将进入前 ${jobs.length}/${searchJobLimit} 个详情页。`, {
        ...baseMeta,
        stage: "dedupe",
        collected: candidates.length,
        duplicates: dedupeResult.duplicateCount,
        fresh: freshCandidates.length,
        searchJobLimit
      });
      if (!jobs.length) {
        postProgress(task, "warning", `Boss关键词 ${keyword} 的岗位都已扫描过，跳过本关键词。`, {
          ...baseMeta,
          stage: "dedupe",
          collected: candidates.length,
          duplicates: dedupeResult.duplicateCount,
          fresh: 0
        });
        advanceKeywordCursor(task, index + 1, keyword);
        storeScanTask({ ...task, phase: "nextKeyword", currentIndex: index + 1, totalSaved });
        continue;
      }

      const diagnostics = buildListDiagnostics();
      postProgress(task, "info", `Boss Chrome采集到 ${candidates.length} 个岗位，过滤重复后剩余 ${freshCandidates.length} 个，将按配置进入前 ${jobs.length}/${searchJobLimit} 个详情页做AI比对。详情链接 ${diagnostics.detailLinks} 个。`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
        candidates: candidates.length,
        fresh: freshCandidates.length,
        duplicates: dedupeResult.duplicateCount,
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
      postProgress(task, "info", `Boss Chrome正在查看详情 1/${jobs.length}：${jobs[0].title}`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
        detailIndex: 1,
        detailTotal: jobs.length
      });
      window.location.href = jobs[0].url;
      return { success: true, saved: totalSaved, pendingNavigation: true };
    }

    if (isStopRequested()) stopRequested = true;

    if (!stopRequested && !task.aiKeywordsLoaded) {
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

  function collectJobs(keyword, message, baseMeta) {
    const nodes = collectJobNodes();
    const jobs = [];
    let skipped = 0;
    let errorCount = 0;
    nodes.slice(0, Math.max(40, normalizeSearchJobLimit(message?.config?.searchJobLimit))).forEach((node, index) => {
      try {
        const job = parseCard(node, keyword);
        if (job.title && job.company && job.url) {
          jobs.push(job);
        } else {
          skipped += 1;
        }
      } catch (error) {
        skipped += 1;
        errorCount += 1;
        if (errorCount <= 3) {
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
      errorCount
    };
  }

  function collectJobNodes() {
    return unique(JOB_CARD_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll(selector))))
      .map((node) => node.matches?.("a[href*='/job_detail/']") ? jobCardRoot(node) : node)
      .filter(Boolean);
  }

  async function filterDuplicateJobs(jobs, message, baseMeta) {
    const list = Array.isArray(jobs) ? jobs : [];
    if (!list.length) return { jobs: [], duplicateCount: 0 };

    try {
      const res = await fetch(`${API_BASE}/api/boss/chrome/jobs/dedupe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: message?.runId, keyword: baseMeta.keyword, jobs: list.map(normalizeJobForDedupe) })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success || !Array.isArray(data.items)) throw new Error(data.message || "查重接口返回异常");

      const duplicateKeys = new Set(data.items.filter((item) => item.duplicate).map(dedupeItemKey));
      const freshJobs = list.filter((job) => isDeliveredStatus(job.deliveryStatus) || !duplicateKeys.has(dedupeJobKey(job)));
      return {
        jobs: freshJobs,
        duplicateCount: Number(data.duplicateCount ?? (list.length - freshJobs.length) ?? 0)
      };
    } catch (error) {
      postProgress(message, "warning", `Boss重复岗位检查失败，将继续扫描本页岗位：${error.message || String(error)}`, {
        ...baseMeta,
        stage: "dedupe",
        collected: list.length
      });
      return { jobs: list, duplicateCount: 0 };
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

  function parseCard(node, keyword) {
    const root = jobCardRoot(node);
    const link = root.querySelector("a[href*='/job_detail/']") || (node.matches?.("a[href*='/job_detail/']") ? node : null);
    const url = link ? new URL(link.getAttribute("href"), window.location.origin).href : "";
    const text = compact(root.innerText || "");
    const title = textOf(root, [".job-name", ".job-title", "[class*='job-name']", "a[href*='/job_detail/']"]) || firstLine(text);
    const company = textOf(root, [".company-name", "[class*='company-name']", ".boss-name", "[class*='brand-name']"]) || guessCompany(text);
    const salary = textOf(root, [".salary", ".job-salary", "[class*='salary']"]) || guessSalary(text);
    const jobLocation = textOf(root, [".job-area", ".company-location", "[class*='location']"]) || "";
    const id = extractBossId(url);
    const deliveryStatus = detectBossDeliveryStatus(root);
    return {
      id,
      title,
      company,
      salary,
      location: jobLocation,
      experience: "",
      degree: "",
      hrName: textOf(root, [".boss-name", "[class*='boss-name']"]),
      hrTitle: "",
      hrActive: "",
      description: text,
      deliveryStatus,
      url,
      keyword
    };
  }

  async function continueBossDetailScan(message, keyword, runId, baseMeta) {
    const jobs = Array.isArray(message.jobs) ? message.jobs : [];
    const detailIndex = Number(message.detailIndex || 0);
    const totalSaved = Number(message.totalSaved || 0);

    if (isStopRequested()) {
      stopRequested = true;
      clearStoredScanTask();
      return { success: true, totalSaved };
    }

    if (!jobs.length) {
      advanceKeywordCursor(message, Number(message.currentIndex || 0) + 1, keyword);
      storeScanTask({ ...message, phase: "", currentIndex: Number(message.currentIndex || 0) + 1, totalSaved });
      return { success: true, totalSaved };
    }

    const currentJob = jobs[detailIndex];
    if (currentJob) {
      const pageBlockDiagnostics = buildPageBlockDiagnostics();
      if (handleBlockingState(message, pageBlockDiagnostics, { ...baseMeta, stage: "details" })) {
        stopRequested = true;
        return { success: true, totalSaved };
      }
    }

    if (currentJob && !isSameUrl(window.location.href, currentJob.url)) {
      postProgress(message, "info", `Boss Chrome正在查看详情 ${detailIndex + 1}/${jobs.length}：${currentJob.title}`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
        detailIndex: detailIndex + 1,
        detailTotal: jobs.length
      });
      window.location.href = currentJob.url;
      return { success: true, totalSaved, pendingNavigation: true };
    }

    if (currentJob) {
      if (isStopRequested()) {
        stopRequested = true;
        clearStoredScanTask();
        return { success: true, totalSaved };
      }
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
      jobs[detailIndex] = enrichBossJobFromCurrentDetail(currentJob, message, baseMeta, detailIndex + 1, jobs.length);
    }

    const nextIndex = detailIndex + 1;
    if (isStopRequested()) stopRequested = true;
    if (!stopRequested && nextIndex < jobs.length) {
      const nextJob = jobs[nextIndex];
      storeScanTask({ ...message, jobs, detailIndex: nextIndex, totalSaved });
      postProgress(message, "info", `Boss Chrome正在查看详情 ${nextIndex + 1}/${jobs.length}：${nextJob.title}`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
        detailIndex: nextIndex + 1,
        detailTotal: jobs.length
      });
      window.location.href = nextJob.url;
      return { success: true, totalSaved, pendingNavigation: true };
    }

    const detailSummary = summarizeJobCollection(jobs);
    const submitJobs = jobs.filter(isSubmittableJob).map(normalizeJobForSubmit);
    if (isStopRequested()) {
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
    const res = await fetch(`${API_BASE}/api/boss/chrome/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, keyword, jobs: submitJobs, autoDeliver: isAutoDeliverEnabled(message) })
    });
    if (!res.ok) throw new Error(`Boss岗位提交失败：HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "Boss岗位提交失败");
    if (data.cancelled || isStopRequested()) {
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
      currentIndex: Number(message.currentIndex || 0) + 1,
      totalSaved: nextTotalSaved
    });
    advanceKeywordCursor(message, Number(message.currentIndex || 0) + 1, keyword);
    return { success: true, totalSaved: nextTotalSaved };
  }

  async function continueAutoDeliverScan(message, keyword, baseMeta) {
    const queue = Array.isArray(message.deliveryQueue) ? message.deliveryQueue : [];
    const deliveryIndex = Number(message.deliveryIndex || 0);
    const totalSaved = Number(message.totalSaved || 0);
    if (isStopRequested()) {
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
    if (isStopRequested()) {
      stopRequested = true;
      clearStoredScanTask();
      return { success: true, task: message, totalSaved };
    }
    await deliverOnCurrentPage(delivery, message);

    const nextIndex = deliveryIndex + 1;
    if (isStopRequested()) stopRequested = true;
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
    if (isStopRequested()) {
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
      const res = await fetch(`${API_BASE}/api/boss/ai-keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ existingKeywords: keywords, limit: 5 })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
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

  function enrichBossJobFromCurrentDetail(job, message, baseMeta, detailIndex, detailTotal) {
    const listDescription = job.description || "";
    try {
      const fields = extractBossDetailFields(job);
      return {
        ...job,
        title: fields.title || job.title,
        company: fields.company || job.company,
        salary: fields.salary || job.salary,
        location: fields.location || job.location,
        experience: fields.experience || job.experience,
        degree: fields.degree || job.degree,
        hrName: fields.hrName || job.hrName,
        hrTitle: fields.hrTitle || job.hrTitle || "",
        hrActive: fields.hrActive || job.hrActive || "",
        description: fields.description || listDescription,
        companyInfo: fields.companyInfo || job.companyInfo || "",
        companyAddress: fields.companyAddress || job.companyAddress || "",
        industry: fields.industry || job.industry || "",
        financingStage: fields.financingStage || job.financingStage || "",
        companyScale: fields.companyScale || job.companyScale || "",
        deliveryStatus: fields.deliveryStatus || job.deliveryStatus || "",
        recruitmentStatus: fields.recruitmentStatus || job.recruitmentStatus || "",
        url: window.location.href || job.url
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
    if (message?.respectScanStop && isStopRequested()) {
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
    await fetch(`${API_BASE}/api/boss/jobs/${task.id}/delivery-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success,
        message: success ? message : failure.failureReason,
        failureType: failure?.failureType,
        failureReason: failure?.failureReason
      })
    });
  }

  function postProgress(message, type, text, meta = {}) {
    if (!message.pageTabId) return;
    chrome.runtime.sendMessage({
      source: "GET_JOBS_PLATFORM",
      pageTabId: message.pageTabId,
      payload: { platform: "boss", type, message: text, timestamp: Date.now(), ...meta }
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
    sessionStorage.setItem(SCAN_TASK_KEY, JSON.stringify({
      ...normalizeScanTask(task),
      updatedAt: Date.now()
    }));
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

  function isResumableScanTask(task) {
    if (!task || task.type !== "BOSS_SCAN_START" || !task.runId) return false;
    if (task.completed || task.phase === "complete" || task.phase === "stopped" || task.phase === "error") return false;

    const lastActiveAt = Number(task.updatedAt || task.startedAt || 0);
    if (!lastActiveAt || Date.now() - lastActiveAt > SCAN_TASK_TTL_MS) return false;

    return isBossTaskPage(task);
  }

  function isBossTaskPage(task) {
    try {
      const current = new URL(window.location.href);
      if (!current.hostname.includes("zhipin.com")) return false;

      const phase = String(task.phase || "");
      if (phase === "detail") {
        const jobs = Array.isArray(task.jobs) ? task.jobs : [];
        const job = jobs[Number(task.detailIndex || 0)];
        if (buildPageBlockDiagnostics().hasBlockingState) return true;
        return Boolean(job?.url && isSameBossJobUrl(current.href, job.url)) || current.pathname.includes("/job_detail/");
      }
      if (phase === "searching" || phase === "collecting" || phase === "nextKeyword") {
        if (isBossSearchPath(current.pathname)) return true;
        return phase === "searching" && isSearchNavigationPending(task);
      }

      return false;
    } catch {
      return false;
    }
  }

  function storeStopRequested() {
    sessionStorage.setItem(SCAN_CANCEL_KEY, "1");
  }

  function clearStopRequested() {
    sessionStorage.removeItem(SCAN_CANCEL_KEY);
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

  function isStopRequested() {
    return stopRequested || sessionStorage.getItem(SCAN_CANCEL_KEY) === "1";
  }

  function writeScanStatus(nextStatus) {
    const previous = readScanStatus();
    sessionStorage.setItem(SCAN_STATUS_KEY, JSON.stringify({
      ...previous,
      ...nextStatus,
      updatedAt: Date.now()
    }));
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
    return match ? match[1] : "";
  }

  async function scrollForCards(searchJobLimit = 20) {
    const scrollRounds = Math.min(30, Math.max(6, Math.ceil(normalizeSearchJobLimit(searchJobLimit) / 10)));
    for (let i = 0; i < scrollRounds && !isStopRequested(); i++) {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.9));
      await humanPause(550, 950);
    }
    window.scrollTo(0, 0);
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
    return node.closest?.("li.job-card-box, .job-card-wrapper, .job-card-body, .job-list-box li, .search-job-result li, [ka^='search_list_'], li") || node;
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
    const detailLinks = document.querySelectorAll("a[href*='/job_detail/']").length;
    const firstCard = collectJobNodes()[0];
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
      resultContainers,
      selectorStats: stats,
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
    clearStoredScanTask();
    writeScanStatus({
      isRunning: false,
      stopRequested: true,
      stage: "blocked",
      message: `Boss页面出现${state}，扫描已暂停，请处理后重新开始。`,
      runId: task?.runId,
      startedAt: task?.startedAt,
      updatedAt: Date.now()
    });
    postProgress(task || {}, "warning", `Boss页面出现${state}，扫描已暂停，请在Chrome中处理验证码/登录/安全验证后重新开始。`, {
      ...meta,
      operation: "scan",
      stage: "blocked",
      currentUrl: diagnostics.currentUrl,
      pageState: diagnostics.pageState
    });
    return true;
  }

  function isSecurityPrompt(text) {
    return /安全验证|滑块|访问异常|身份验证|请完成验证|验证码|verify|captcha/i.test(text || "");
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
        skipSearchNavigationKeyword(stored, url);
        return;
      }

      const nextAttempts = Number(stored.navigationAttempts || attempts || 0) + 1;
      const retryTask = {
        ...stored,
        navigationAttempts: nextAttempts,
        navigationStartedAt: Date.now(),
        navigationRefreshAttempted: stored.navigationRefreshAttempted || nextAttempts === 3
      };
      storeScanTask(retryTask);
      if (nextAttempts === 3 && !stored.navigationRefreshAttempted) {
        postProgress(retryTask, "warning", `Boss搜索页跳转仍未完成，正在刷新当前页面后继续恢复：${retryTask.expectedKeyword || ""}。当前URL：${window.location.href}`, {
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
        window.location.reload();
        return;
      }
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

  function skipSearchNavigationKeyword(task, url, options = {}) {
    const keyword = task.expectedKeyword || scanKeywords(task)[Number(task.currentIndex || 0)] || "";
    const keywordTotal = scanKeywords(task).length;
    const nextTask = {
      ...task,
      phase: "nextKeyword",
      jobs: [],
      detailIndex: 0,
      currentIndex: Number(task.currentIndex || 0) + 1,
      navigationAttempts: 0,
      navigationStartedAt: 0,
      navigationRefreshAttempted: false,
      expectedKeyword: "",
      expectedSearchUrl: "",
      totalSaved: Number(task.totalSaved || 0)
    };
    advanceKeywordCursor(task, Number(task.currentIndex || 0) + 1, keyword);
    storeScanTask(nextTask);
    writeScanStatus({
      isRunning: true,
      stopRequested: false,
      stage: "searching",
      message: `Boss搜索页跳转失败，已跳过关键词：${keyword}，继续下一个关键词。`,
      runId: task.runId,
      keyword,
      keywordIndex: Number(task.currentIndex || 0) + 1,
      keywordTotal,
      totalSaved: Number(task.totalSaved || 0),
      startedAt: task.startedAt,
      updatedAt: Date.now()
    });
    postProgress(task, "warning", `Boss搜索页跳转失败，已跳过关键词：${keyword}，继续下一个关键词。`, {
      operation: "scan",
      stage: "searching",
      keyword,
      keywordIndex: Number(task.currentIndex || 0) + 1,
      keywordTotal,
      currentUrl: window.location.href,
      targetUrl: url,
      navigationAttempts: Number(task.navigationAttempts || 0),
      totalSaved: Number(task.totalSaved || 0)
    });
    if (options.resume !== false) {
      runScan(nextTask).catch((error) => {
        clearStoredScanTask();
        writeScanStatus({
          isRunning: false,
          stopRequested: false,
          stage: "error",
          message: error.message || String(error),
          runId: task.runId,
          startedAt: task.startedAt,
          updatedAt: Date.now()
        });
        postProgress(task, "error", error.message || String(error), {
          operation: "scan",
          stage: "error"
        });
      });
    }
    return nextTask;
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

  function extractBossDetailFields(job) {
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
      bossDetailDescription(),
      sections.jobRequirement,
      sections.jobDescription,
      sections.duty,
      bodyText
    );
    const companyInfo = firstNonEmpty(
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
      title: firstNonEmpty(textOf(document, [".job-title", ".job-name", ".name", "h1"]), job.title),
      company: firstNonEmpty(textOf(document, [".company-name", ".sider-company .name", ".company-card .name", "[class*='company-name']"]), job.company),
      salary: firstNonEmpty(textOf(document, [".salary", ".job-banner .salary", "[class*='salary']"]), guessSalary(bannerText || bodyText), job.salary),
      location: firstNonEmpty(tags.location, job.location),
      experience: firstNonEmpty(tags.experience, job.experience),
      degree: firstNonEmpty(tags.degree, job.degree),
      hrName: firstNonEmpty(textOf(document, [".boss-name", "[class*='boss-name']", ".boss-info .name", ".recruiter-name"]), hr.name, job.hrName),
      hrTitle: firstNonEmpty(textOf(document, [".boss-title", "[class*='boss-title']", ".boss-info .gray", ".recruiter-title"]), hr.title, job.hrTitle),
      hrActive: firstNonEmpty(textOf(document, [".boss-active-time", "[class*='active']"]), hr.active, job.hrActive),
      description: description === bodyText ? trimToUsefulLength(bodyText, 6000) : description,
      companyInfo: companyInfo === bodyText ? trimToUsefulLength(companyInfo, 2000) : companyInfo,
      companyAddress: firstNonEmpty(textOf(document, [".job-address", ".location-address", "[class*='address']"]), sections.address),
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
    return Boolean(compact(job?.title) && compact(job?.company) && compact(job?.url));
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

  function trimToUsefulLength(text, limit) {
    const value = compact(text || "");
    if (!value) return "";
    return value.length > limit ? value.slice(0, limit) : value;
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
