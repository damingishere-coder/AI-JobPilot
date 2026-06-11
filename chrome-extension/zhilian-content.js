(function () {
  const EXTENSION_VERSION = "2026-06-09-zhilian-reinject-listener-1";
  const CONTENT_INSTANCE_ID = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.__GET_JOBS_ZHILIAN_CONTENT__ = true;
  window.__GET_JOBS_ZHILIAN_CONTENT_VERSION__ = EXTENSION_VERSION;
  window.__GET_JOBS_ZHILIAN_CONTENT_INSTANCE_ID__ = CONTENT_INSTANCE_ID;

  const API_BASE = "http://localhost:8888";
  const SCAN_TASK_KEY = "__GET_JOBS_ZHILIAN_SCAN_TASK__";
  const SHARED_SCAN_TASK_KEY = "__GET_JOBS_ZHILIAN_SHARED_SCAN_TASK__";
  const SCAN_CANCEL_KEY = "__GET_JOBS_ZHILIAN_SCAN_CANCEL__";
  const SHARED_SCAN_CANCEL_KEY = "__GET_JOBS_ZHILIAN_SHARED_SCAN_CANCEL__";
  const SCAN_STATUS_KEY = "__GET_JOBS_ZHILIAN_SCAN_STATUS__";
  const KEYWORD_CURSOR_KEY = "__GET_JOBS_ZHILIAN_KEYWORD_CURSOR__";
  const SCAN_TASK_TTL_MS = 30 * 60 * 1000;
  const DETAIL_NAVIGATION_GUARD_MS = 800;
  const JOB_LINK_SELECTORS = [
    "a[href*='jobs.zhaopin.com']",
    "a[href*='jobdetail']",
    "a[href*='job_detail']",
    "a[href*='positiondetail']",
    "a[href*='/job/']",
    "a[href*='/jobs/']",
    "[class*='joblist'] a[href]",
    "[class*='jobList'] a[href]",
    "[class*='job-card'] a[href]",
    "[class*='jobCard'] a[href]",
    "[class*='position'] a[href]",
    "[class*='Position'] a[href]"
  ];
  const JOB_CARD_ROOT_SELECTORS = [
    "[class*='joblist-box__item']",
    "[class*='joblistBox__item']",
    "[class*='joblist-item']",
    "[class*='jobListItem']",
    "[class*='job-card']",
    "[class*='jobCard']",
    "[class*='position-card']",
    "[class*='positionCard']",
    "[class*='position-item']",
    "[class*='positionItem']",
    "[class*='iteminfo']",
    "li"
  ];
  const JOB_TITLE_SELECTORS = [
    "[class*='jobname']",
    "[class*='jobName']",
    "[class*='job-title']",
    "[class*='jobTitle']",
    "[class*='position-name']",
    "[class*='positionName']",
    "[class*='positionname']",
    "a[href*='jobdetail']",
    "a[href*='job_detail']",
    "a[href*='/job/']",
    "a[href*='jobs.zhaopin.com']"
  ];
  const COMPANY_NAME_SELECTORS = [
    "[class*='compname']",
    "[class*='company-name']",
    "[class*='companyName']",
    "[class*='companyname']",
    "[class*='company'] a",
    "a[href*='company']",
    "a[href*='gongsi']",
    "a[href*='qiye']"
  ];
  const SALARY_SELECTORS = [
    "[class*='salary']",
    "[class*='job-salary']",
    "[class*='jobSalary']",
    "[class*='jobsalary']"
  ];
  let stopRequested = false;
  let activeScanPromise = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (window.__GET_JOBS_ZHILIAN_CONTENT_INSTANCE_ID__ !== CONTENT_INSTANCE_ID) return;
    if (message?.source !== "GET_JOBS_BACKGROUND") return;
    const messageType = normalizeRuntimeMessageType(message?.type);
    if (messageType === "PING_CONTENT") {
      sendResponse({ success: true, version: EXTENSION_VERSION, instanceId: CONTENT_INSTANCE_ID });
      return;
    }
    if (messageType === "GET_ZHILIAN_CONTENT_VERSION") {
      sendResponse({ success: true, version: EXTENSION_VERSION, instanceId: CONTENT_INSTANCE_ID });
      return;
    }
    if (messageType === "ZHILIAN_SCAN_STOP") {
      handleScanStopMessage(message).then(sendResponse).catch((error) => {
        sendResponse({ success: false, message: error.message || String(error) });
      });
      return true;
    }
    if (messageType === "ZHILIAN_SCAN_STATUS") {
      handleScanStatusMessage(sendResponse);
      return true;
    }
    if (messageType === "ZHILIAN_SCAN_START") {
      handleScanStartMessage(message).then(sendResponse).catch((error) => {
        sendResponse({ success: false, message: error.message || String(error) });
      });
      return true;
    }
    if (messageType === "ZHILIAN_DELIVER_CURRENT") {
      handleDeliverCurrentMessage(message, sendResponse);
      return true;
    }
    if (messageType === "ZHILIAN_DELIVER_ONE") {
      deliverOne(message.task, message).then(sendResponse).catch((error) => sendResponse({ success: false, message: error.message || String(error) }));
      return true;
    }
    if (messageType === "ZHILIAN_DELIVER_BATCH") {
      deliverBatch(message.tasks || [], message).then(sendResponse).catch((error) => sendResponse({ success: false, message: error.message || String(error) }));
      return true;
    }
  });

  resumeStoredScanTaskIfActive().catch((error) => {
    console.warn("[GetJobs] 智联扫描任务恢复失败", error);
  });

  function normalizeRuntimeMessageType(type) {
    return String(type || "").replace(/_V2$/, "");
  }

  async function handleScanStopMessage(message) {
    stopRequested = true;
    await storeStopRequested(message?.runId);
    clearStoredScanTask();
    writeScanStatus({
      isRunning: false,
      stopRequested: true,
      stage: "stopped",
      message: "已请求停止智联扫描",
      runId: message?.runId || readScanStatus().runId || "",
      updatedAt: Date.now()
    });
    postProgress(message, "warning", "智联 Chrome扫描停止请求已接收，正在中断当前任务。", {
      operation: "scan",
      stage: "stopping"
    });
    return { success: true, message: "已请求停止智联扫描" };
  }

  async function handleScanStartMessage(message) {
    stopRequested = false;
    await clearStopRequested();
    startScan(message).catch((error) => {
      postProgress(message, "error", error.message || String(error), {
        operation: "scan",
        stage: "error"
      });
    });
    return { success: true, message: "智联 Chrome扫描任务已启动。" };
  }

  async function handleScanStatusMessage(sendResponse) {
    if (await hasStopRequested()) {
      stopRequested = true;
      clearStoredScanTask();
      writeScanStatus({
        isRunning: false,
        stopRequested: true,
        stage: "stopped",
        message: "智联扫描已取消"
      });
    }
    const task = await readStoredScanTaskFromAnyStorage();
    const hasResumableTask = Boolean(task && isResumableScanTask(task));
    if (task && !hasResumableTask) {
      clearStoredScanTask();
      writeScanStatus({
        isRunning: false,
        stopRequested: false,
        stage: "idle",
        message: "智联旧扫描任务已清理"
      });
    }
    const status = readScanStatus();
    sendResponse({
      success: true,
      ...status,
      runId: status.runId || task?.runId || "",
      hasStoredTask: hasResumableTask
    });
  }

  async function startScan(message) {
    const task = normalizeScanTask(message);
    await storeScanTask(task);
    writeScanStatus({
      isRunning: true,
      stopRequested: false,
      stage: "received",
      message: "智联 Chrome扫描任务已接收",
      runId: task.runId,
      startedAt: task.startedAt,
      updatedAt: Date.now()
    });
    const keywords = scanKeywords(task);
    if (task.keywordCursorReset) {
      postProgress(task, "warning", "智联搜索配置已变化，关键词历史已重置。", {
        operation: "scan",
        stage: "keywordCursor",
        keywordTotal: keywords.length
      });
    }
    if (keywords.length) {
      const startIndex = normalizeKeywordIndex(task.currentIndex, keywords.length);
      postProgress(task, "info", `智联关键词历史：本次从第 ${startIndex + 1}/${keywords.length} 个关键词继续：${keywords[startIndex]}`, {
        operation: "scan",
        stage: "keywordCursor",
        keyword: keywords[startIndex],
        keywordIndex: startIndex + 1,
        keywordTotal: keywords.length
      });
    }
    postProgress(task, "info", `智联 Chrome扫描任务已接收，正在准备搜索页面。扩展版本：${EXTENSION_VERSION}`, {
      operation: "scan",
      stage: "received",
      extensionVersion: EXTENSION_VERSION,
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
        stage: "error"
      });
    });
  }

  async function resumeStoredScanTaskIfActive() {
    if (await hasStopRequested()) {
      stopRequested = true;
      clearStoredScanTask();
      writeScanStatus({
        isRunning: false,
        stopRequested: true,
        stage: "stopped",
        message: "智联扫描已取消"
      });
      return;
    }
    const task = await readStoredScanTaskFromAnyStorage();
    if (await hasStopRequested()) {
      stopRequested = true;
      clearStoredScanTask();
      writeScanStatus({ isRunning: false, stopRequested: true, stage: "stopped", message: "智联扫描已取消" });
      return;
    }
    if (!task || task.completed || stopRequested) return;
    if (!isResumableScanTask(task)) {
      clearStoredScanTask();
      writeScanStatus({
        isRunning: false,
        stopRequested: false,
        stage: "idle",
        message: "智联旧扫描任务已过期或不适合恢复"
      });
      return;
    }

    writeScanStatus({
      isRunning: true,
      stopRequested: false,
      stage: "resume",
      message: "智联页面已重新加载，继续执行扫描任务",
      runId: task.runId,
      startedAt: task.startedAt,
      updatedAt: Date.now()
    });
    postProgress(task, "info", "智联页面已重新加载，继续执行扫描任务。", {
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
        stage: "error"
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
    const keywords = scanKeywords(task);
    const runId = task.runId || String(Date.now());
    let totalSaved = Number(task.totalSaved || 0);
    const startIndex = normalizeTaskIndex(task.currentIndex, keywords.length);

    if (!keywords.length) {
      throw new Error("智联扫描缺少关键词，请先在智联配置中填写关键词。");
    }

    if (await hasStopRequested()) {
      stopRequested = true;
    }

    for (let keywordIndex = startIndex; keywordIndex < keywords.length; keywordIndex++) {
      if (await hasStopRequested()) stopRequested = true;
      if (stopRequested) break;
      if (keywordIndex > startIndex || task.phase === "nextKeyword") {
        await humanPause(1500, 3000);
        if (await hasStopRequested()) {
          stopRequested = true;
          break;
        }
      }
      const keyword = keywords[keywordIndex];
      markKeywordCursorCurrent(task, keywordIndex, keyword);
      const searchPage = Math.max(1, Number(task.searchPage || 1));
      const searchUrl = buildSearchUrl(keyword, config, searchPage);
      const baseTask = {
        ...task,
        source: "GET_JOBS_BACKGROUND",
        type: "ZHILIAN_SCAN_START",
        phase: "searching",
        currentIndex: keywordIndex,
        totalSaved,
        searchUrl,
        expectedKeyword: keyword
      };
      const baseMeta = {
        operation: "scan",
        keyword,
        keywordIndex: keywordIndex + 1,
        keywordTotal: keywords.length,
        totalSaved
      };
      writeScanStatus({
        isRunning: true,
        stopRequested: false,
        stage: "searching",
        message: `智联 Chrome正在搜索：${keyword}`,
        runId,
        keyword,
        keywordIndex: keywordIndex + 1,
        keywordTotal: keywords.length,
        totalSaved,
        startedAt: task.startedAt,
        updatedAt: Date.now()
      });

      if (task.phase === "detail") {
        const detailResult = await continueZhilianDetailScan(task, keyword, runId, baseMeta);
        if (detailResult.pendingNavigation) return { success: true, saved: totalSaved, pendingNavigation: true };
        totalSaved = detailResult.totalSaved;
        if (!stopRequested) advanceKeywordCursor(task, keywordIndex + 1, keyword);
        task = {
          ...task,
          phase: "nextKeyword",
          jobs: [],
          detailIndex: 0,
          currentIndex: keywordIndex + 1,
          totalSaved
        };
        await storeScanTask(task);
        continue;
      }

      if (!isCurrentSearchPage(keyword, config, searchPage)) {
        postProgress(task, "info", `智联 Chrome准备打开搜索页：${keyword}，目标URL：${searchUrl}，当前URL：${window.location.href}`, {
          ...baseMeta,
          stage: "searching",
          currentUrl: window.location.href,
          targetUrl: searchUrl
        });
        await storeScanTask(baseTask);
        window.location.assign(searchUrl);
        return { success: true, saved: totalSaved, pendingNavigation: true };
      }

      await storeScanTask({ ...baseTask, phase: "collecting" });
      postProgress(task, "info", `智联 Chrome开始搜索：${keyword}，当前URL：${window.location.href}`, {
        ...baseMeta,
        stage: "searching",
        currentUrl: window.location.href
      });
      await waitForPage();
      if (await hasStopRequested()) {
        stopRequested = true;
        break;
      }
      await sleep(2200);
      if (await hasStopRequested()) {
        stopRequested = true;
        break;
      }
      const searchJobLimit = normalizeSearchJobLimit(task.config?.searchJobLimit);
      const collectionResult = await collectJobsAcrossSearchPages(task, baseTask, keyword, config, searchJobLimit, baseMeta, totalSaved);
      if (collectionResult.pendingNavigation) {
        return { success: true, saved: totalSaved, pendingNavigation: true };
      }
      if (collectionResult.stopped) {
        stopRequested = true;
        break;
      }
      if (collectionResult.empty) {
        advanceKeywordCursor(task, keywordIndex + 1, keyword);
        await storeScanTask({ ...baseTask, phase: "nextKeyword", currentIndex: keywordIndex + 1, totalSaved });
        continue;
      }
      const jobs = collectionResult.jobs;

      postProgress(task, "info", `智联 Chrome已按配置采集 ${collectionResult.candidateCount} 个候选岗位，将进入 ${jobs.length}/${searchJobLimit} 个详情页做AI比对`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
        searchJobLimit,
        pagesScanned: collectionResult.pagesScanned
      });
      const detailTask = {
        ...baseTask,
        phase: "detail",
        detailIndex: 0,
        jobs,
        collectedJobs: [],
        searchPage: 1,
        pagesScanned: 0
      };
      await storeScanTask(detailTask);
      postProgress(task, "info", `智联 Chrome正在查看详情 1/${jobs.length}：${jobs[0].title}`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
        detailIndex: 1,
        detailTotal: jobs.length
      });
      const firstNavigation = await navigateToDetail(task, jobs[0].url);
      if (firstNavigation.status === "pending") {
        return { success: true, saved: totalSaved, pendingNavigation: true };
      }
      if (firstNavigation.status === "blocked") {
        jobs[0] = markDetailNavigationFailed(jobs[0], 1, jobs.length, firstNavigation.message);
        postProgress(task, "warning", `智联 Chrome详情页跳转无响应，已跳过 1/${jobs.length}：${jobs[0].title}`, {
          ...baseMeta,
          stage: "details",
          detailIndex: 1,
          detailTotal: jobs.length,
          currentUrl: window.location.href,
          targetUrl: jobs[0].url,
          reason: firstNavigation.message
        });
        detailTask.jobs = jobs;
        detailTask.detailIndex = 1;
      }
      const detailResult = await continueZhilianDetailScan(detailTask, keyword, runId, baseMeta);
      if (detailResult.pendingNavigation) return { success: true, saved: totalSaved, pendingNavigation: true };
      totalSaved = detailResult.totalSaved;
      if (!stopRequested) advanceKeywordCursor(task, keywordIndex + 1, keyword);
      task = {
        ...task,
        phase: "nextKeyword",
        jobs: [],
        collectedJobs: [],
        searchPage: 1,
        pagesScanned: 0,
        detailIndex: 0,
        currentIndex: keywordIndex + 1,
        totalSaved
      };
      await storeScanTask(task);
      continue;
    }

    if (!stopRequested) {
      advanceKeywordCursor(task, keywords.length, "");
    }
    clearStoredScanTask();
    const stopped = stopRequested;
    if (stopped) await clearStopRequested();
    writeScanStatus({
      isRunning: false,
      stopRequested: stopped,
      stage: stopped ? "stopped" : "complete",
      message: stopped ? `智联 Chrome扫描已停止，已提交 ${totalSaved} 个岗位` : `智联 Chrome扫描完成，已提交 ${totalSaved} 个岗位`,
      runId,
      keywordTotal: keywords.length,
      totalSaved,
      saved: totalSaved,
      startedAt: task.startedAt,
      updatedAt: Date.now()
    });
    postProgress(task, stopped ? "warning" : "success", stopped ? `智联 Chrome扫描已停止，已提交 ${totalSaved} 个岗位` : `智联 Chrome扫描完成，已提交 ${totalSaved} 个岗位`, {
      operation: "scan",
      stage: stopped ? "stopped" : "complete",
      keywordTotal: keywords.length,
      totalSaved,
      saved: totalSaved
    });
    return { success: true, saved: totalSaved };
  }

  function collectJobs(keyword, message, baseMeta) {
    const entries = collectJobEntries();
    const jobs = [];
    const seenJobUrls = new Set();
    let skipped = 0;
    let errorCount = 0;
    let duplicated = 0;
    entries.slice(0, Math.max(40, normalizeSearchJobLimit(message?.config?.searchJobLimit))).forEach((entry, index) => {
      try {
        const job = parseJobEntry(entry, keyword);
        const urlKey = normalizeJobUrlKey(job);
        if (job.title && job.url && !seenJobUrls.has(urlKey)) {
          seenJobUrls.add(urlKey);
          jobs.push(job);
        } else {
          if (job.url && seenJobUrls.has(urlKey)) duplicated += 1;
          skipped += 1;
        }
      } catch (error) {
        skipped += 1;
        errorCount += 1;
        if (errorCount <= 3) {
          postProgress(message, "warning", `智联 Chrome跳过第 ${index + 1} 个岗位链接：${error.message || String(error)}`, {
            ...baseMeta,
            stage: "collecting",
            cardIndex: index + 1
          });
        }
      }
    });
    return {
      jobs,
      nodeCount: entries.length,
      parsed: jobs.length,
      skipped,
      errorCount,
      duplicated
    };
  }

  async function collectJobsAcrossSearchPages(task, baseTask, keyword, config, searchJobLimit, baseMeta, totalSaved) {
    let collectedJobs = normalizeCollectedJobs(task.collectedJobs);
    const seenJobUrls = new Set(collectedJobs.map((job) => normalizeJobUrlKey(job)).filter(Boolean));
    let pageNumber = Math.max(1, Number(task.searchPage || currentSearchPageNumber() || 1));
    let pagesScanned = Number(task.pagesScanned || 0);
    let lastDiagnostics = null;

    while (collectedJobs.length < searchJobLimit && pagesScanned < 50) {
      if (await hasStopRequested()) {
        return { stopped: true, jobs: collectedJobs.slice(0, searchJobLimit), candidateCount: collectedJobs.length, pagesScanned };
      }

      if (!isCurrentSearchPage(keyword, config, pageNumber)) {
        const pageUrl = buildSearchUrl(keyword, config, pageNumber);
        postProgress(task, "info", `智联 Chrome准备打开第 ${pageNumber} 页继续采集：${keyword}，目标URL：${pageUrl}`, {
          ...baseMeta,
          stage: "collecting",
          pageNumber,
          collected: collectedJobs.length,
          searchJobLimit,
          targetUrl: pageUrl
        });
        await storeScanTask({
          ...baseTask,
          phase: "collecting",
          searchPage: pageNumber,
          pagesScanned,
          collectedJobs,
          totalSaved
        });
        window.location.assign(pageUrl);
        return { pendingNavigation: true, jobs: collectedJobs.slice(0, searchJobLimit), candidateCount: collectedJobs.length, pagesScanned };
      }

      const waitState = await waitForJobCards();
      if (await hasStopRequested()) {
        return { stopped: true, jobs: collectedJobs.slice(0, searchJobLimit), candidateCount: collectedJobs.length, pagesScanned };
      }
      lastDiagnostics = waitState.diagnostics;
      if (handleBlockingState(task, waitState.diagnostics, { ...baseMeta, pageNumber })) {
        return { stopped: true, jobs: collectedJobs.slice(0, searchJobLimit), candidateCount: collectedJobs.length, pagesScanned };
      }

      postProgress(task, "info", `智联第 ${pageNumber} 页加载完成，开始滚动采集。详情链接 ${waitState.diagnostics.detailLinks} 个，岗位节点 ${waitState.diagnostics.jobNodes} 个。`, {
        ...baseMeta,
        stage: "collecting",
        pageNumber,
        collected: collectedJobs.length,
        searchJobLimit,
        ...waitState.diagnostics
      });

      await scrollForCards(searchJobLimit - collectedJobs.length);
      if (await hasStopRequested()) {
        return { stopped: true, jobs: collectedJobs.slice(0, searchJobLimit), candidateCount: collectedJobs.length, pagesScanned };
      }

      const collectResult = collectJobs(keyword, task, { ...baseMeta, pageNumber });
      let added = 0;
      for (const job of collectResult.jobs) {
        const key = normalizeJobUrlKey(job);
        if (!key || seenJobUrls.has(key)) continue;
        seenJobUrls.add(key);
        collectedJobs.push(job);
        added += 1;
        if (collectedJobs.length >= searchJobLimit) break;
      }
      pagesScanned += 1;

      postProgress(task, collectResult.parsed > 0 ? "info" : "warning", `智联第 ${pageNumber} 页解析完成：候选节点 ${collectResult.nodeCount} 个，成功 ${collectResult.parsed} 个，本页新增 ${added} 个，累计 ${collectedJobs.length}/${searchJobLimit} 个，跳过 ${collectResult.skipped} 个，重复 ${collectResult.duplicated} 个。`, {
        ...baseMeta,
        stage: "collecting",
        pageNumber,
        collected: collectedJobs.length,
        searchJobLimit,
        nodeCount: collectResult.nodeCount,
        parsed: collectResult.parsed,
        added,
        skipped: collectResult.skipped,
        duplicated: collectResult.duplicated,
        errorCount: collectResult.errorCount,
        pagesScanned
      });

      await storeScanTask({
        ...baseTask,
        phase: "collecting",
        searchPage: pageNumber,
        pagesScanned,
        collectedJobs,
        totalSaved
      });

      if (collectedJobs.length >= searchJobLimit) break;

      const nextPageNumber = pageNumber + 1;
      if (!hasNextSearchPage(nextPageNumber)) {
        postProgress(task, "info", `智联 Chrome已无下一页，本关键词采集结束：累计 ${collectedJobs.length}/${searchJobLimit} 个岗位进入详情/AI流程。`, {
          ...baseMeta,
          stage: "collecting",
          collected: collectedJobs.length,
          searchJobLimit,
          pageNumber,
          pagesScanned
        });
        break;
      }
      pageNumber = nextPageNumber;
    }

    const jobs = collectedJobs.slice(0, searchJobLimit);
    if (!jobs.length) {
      const diagnostics = lastDiagnostics || buildListDiagnostics();
      if (handleBlockingState(task, diagnostics, baseMeta)) {
        return { stopped: true, empty: true, jobs: [], candidateCount: 0, pagesScanned };
      }
      postProgress(task, "warning", `智联 Chrome未采集到岗位：${keyword}。当前URL=${diagnostics.currentUrl}，标题=${diagnostics.title}，详情链接=${diagnostics.detailLinks}，岗位节点=${diagnostics.jobNodes}，状态=${diagnostics.pageState}。可能未登录/安全验证/页面结构变化/筛选无结果。`, {
        ...baseMeta,
        stage: "empty",
        collected: 0,
        searchJobLimit,
        ...diagnostics
      });
      return { empty: true, jobs: [], candidateCount: 0, pagesScanned };
    }

    return { jobs, candidateCount: collectedJobs.length, pagesScanned, empty: false };
  }

  function normalizeCollectedJobs(value) {
    if (!Array.isArray(value)) return [];
    const jobs = [];
    const seen = new Set();
    value.forEach((job) => {
      if (!job || !job.url) return;
      const key = normalizeJobUrlKey(job);
      if (!key || seen.has(key)) return;
      seen.add(key);
      jobs.push(job);
    });
    return jobs;
  }

  function currentSearchPageNumber() {
    try {
      const parsed = new URL(window.location.href);
      const match = parsed.pathname.match(/\/p(\d+)(?:\/|$)/i);
      const page = match ? Number(match[1]) : 1;
      return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    } catch {
      return 1;
    }
  }

  function hasNextSearchPage(nextPageNumber) {
    const diagnostics = buildListDiagnostics();
    if (diagnostics.hasEmptyPrompt) return false;
    const nextSelectors = [
      "a.soupager__btn:has-text('下一页')",
      "a[class*='pager']:not([class*='disable'])",
      "button[class*='next']",
      "a[aria-label*='下一页']",
      "button[aria-label*='下一页']"
    ];
    for (const selector of nextSelectors) {
      try {
        const nodes = Array.from(document.querySelectorAll(selector));
        const next = nodes.find((node) => /下一页|next/i.test(compact(node.innerText || node.textContent || node.getAttribute("aria-label") || "")));
        if (!next) continue;
        const cls = String(next.getAttribute("class") || "").toLowerCase();
        const disabled = next.disabled
          || next.getAttribute("disabled") != null
          || next.getAttribute("aria-disabled") === "true"
          || /disable|disabled/.test(cls);
        if (!disabled) return true;
      } catch {
        // Try the next selector.
      }
    }
    return diagnostics.detailLinks > 0 && nextPageNumber <= 50;
  }

  function collectJobEntries() {
    const links = unique(JOB_LINK_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll(selector))))
      .filter((link) => isZhilianJobDetailUrl(resolveZhilianJobUrl(link)));
    const entries = [];
    const seen = new Set();
    links.forEach((link) => {
      const url = resolveZhilianJobUrl(link);
      const key = normalizeUrlKey(url);
      if (!key || seen.has(key)) return;
      seen.add(key);
      entries.push({
        link,
        root: zhilianJobCardRoot(link),
        url
      });
    });
    return entries;
  }

  function parseJobEntry(entry, keyword) {
    const link = entry.link;
    const root = entry.root || zhilianJobCardRoot(link);
    const text = compact(root.innerText || link.innerText || "");
    const url = entry.url || resolveZhilianJobUrl(link);
    if (!isZhilianJobDetailUrl(url)) {
      throw new Error("非岗位详情链接");
    }
    const linkText = compact(link.innerText || link.textContent || link.getAttribute("title") || "");
    const title = cleanJobTitle(textOf(root, JOB_TITLE_SELECTORS)) || cleanJobTitle(linkText) || cleanJobTitle(firstLine(text));
    const company = textOf(root, COMPANY_NAME_SELECTORS) || guessZhilianCompany(text, title);
    return {
      id: extractUrlId(url),
      title,
      company,
      salary: textOf(root, SALARY_SELECTORS) || guessSalary(text),
      location: guessZhilianLocation(text),
      experience: firstMatch(text, /(经验不限|不限经验|在校\/应届|应届|[0-9]+-[0-9]+年|[0-9]+年以内|[0-9]+年以上)/),
      degree: firstMatch(text, /(学历不限|本科|大专|硕士|博士|高中|中专)/),
      deliveryStatus: detectZhilianDeliveryStatus(root),
      description: stripCompanyOnlyText(text),
      url,
      keyword
    };
  }

  async function continueZhilianDetailScan(message, keyword, runId, baseMeta = {}) {
    const jobs = Array.isArray(message.jobs) ? message.jobs : [];
    const detailIndex = Number(message.detailIndex || 0);
    const totalSaved = Number(message.totalSaved || 0);

    if (await hasStopRequested()) {
      stopRequested = true;
      clearStoredScanTask();
      return { success: true, totalSaved };
    }

    if (!jobs.length) {
      advanceKeywordCursor(message, Number(message.currentIndex || 0) + 1, keyword);
      await storeScanTask({ ...message, phase: "nextKeyword", currentIndex: Number(message.currentIndex || 0) + 1, totalSaved });
      return { success: true, totalSaved };
    }

    const currentJob = jobs[detailIndex];
    let currentNavigationBlocked = false;
    if (currentJob && !isZhilianJobDetailUrl(currentJob.url)) {
      jobs[detailIndex] = markDetailNavigationFailed(currentJob, detailIndex + 1, jobs.length, `岗位详情链接无效或不是智联岗位页：${currentJob.url || "空"}`);
      postProgress(message, "warning", `智联 Chrome跳过无效详情链接 ${detailIndex + 1}/${jobs.length}：${currentJob.title}`, {
        ...baseMeta,
        stage: "details",
        detailIndex: detailIndex + 1,
        detailTotal: jobs.length,
        targetUrl: currentJob.url
      });
      currentNavigationBlocked = true;
    }
    if (currentJob && !currentNavigationBlocked && !isSameUrl(window.location.href, currentJob.url)) {
      postProgress(message, "info", `智联 Chrome正在查看详情 ${detailIndex + 1}/${jobs.length}：${currentJob.title}`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
        detailIndex: detailIndex + 1,
        detailTotal: jobs.length
      });
      await storeScanTask({ ...message, phase: "detail", jobs, detailIndex, totalSaved });
      const currentNavigation = await navigateToDetail(message, currentJob.url);
      if (currentNavigation.status === "pending") {
        return { success: true, totalSaved, pendingNavigation: true };
      }
      if (currentNavigation.status === "blocked") {
        jobs[detailIndex] = markDetailNavigationFailed(currentJob, detailIndex + 1, jobs.length, currentNavigation.message);
        postProgress(message, "warning", `智联 Chrome详情页跳转无响应，已跳过 ${detailIndex + 1}/${jobs.length}：${currentJob.title}`, {
          ...baseMeta,
          stage: "details",
          detailIndex: detailIndex + 1,
          detailTotal: jobs.length,
          currentUrl: window.location.href,
          targetUrl: currentJob.url,
          reason: currentNavigation.message
        });
        currentNavigationBlocked = true;
      }
    }

    if (currentJob && !currentNavigationBlocked) {
      if (await hasStopRequested()) {
        stopRequested = true;
        clearStoredScanTask();
        return { success: true, totalSaved };
      }
      const detailDiagnostics = buildPageBlockDiagnostics();
      if (handleBlockingState(message, detailDiagnostics, { ...baseMeta, stage: "details" })) {
        stopRequested = true;
        return { success: true, totalSaved };
      }
      if (!isCurrentZhilianJobDetailPage(currentJob.url)) {
        jobs[detailIndex] = markDetailNavigationFailed(currentJob, detailIndex + 1, jobs.length, `当前页面不是智联岗位详情页：${window.location.href}`);
        postProgress(message, "warning", `智联 Chrome跳过疑似公司页 ${detailIndex + 1}/${jobs.length}：${currentJob.title}`, {
          ...baseMeta,
          stage: "details",
          detailIndex: detailIndex + 1,
          detailTotal: jobs.length,
          currentUrl: window.location.href,
          targetUrl: currentJob.url
        });
      } else {
        await humanPause(900, 1800);
        if (await hasStopRequested()) {
          stopRequested = true;
          clearStoredScanTask();
          return { success: true, totalSaved };
        }
        writeScanStatus({
          isRunning: true,
          stopRequested: false,
          stage: "details",
          message: `智联 Chrome正在解析详情 ${detailIndex + 1}/${jobs.length}：${currentJob.title}`,
          keyword,
          keywordIndex: baseMeta.keywordIndex,
          keywordTotal: baseMeta.keywordTotal,
          detailIndex: detailIndex + 1,
          detailTotal: jobs.length,
          totalSaved,
          startedAt: message.startedAt,
          updatedAt: Date.now()
        });
        postProgress(message, "info", `智联 Chrome正在解析详情 ${detailIndex + 1}/${jobs.length}：${currentJob.title}`, {
          ...baseMeta,
          stage: "details",
          collected: jobs.length,
          detailIndex: detailIndex + 1,
          detailTotal: jobs.length
        });
        jobs[detailIndex] = enrichZhilianJobFromCurrentDetail(currentJob, message, detailIndex + 1, jobs.length);
      }
    }

    const nextIndex = detailIndex + 1;
    if (await hasStopRequested()) stopRequested = true;
    if (!stopRequested && nextIndex < jobs.length) {
      const nextJob = jobs[nextIndex];
      await storeScanTask({ ...message, jobs, detailIndex: nextIndex, totalSaved });
      postProgress(message, "info", `智联 Chrome正在查看详情 ${nextIndex + 1}/${jobs.length}：${nextJob.title}`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
        detailIndex: nextIndex + 1,
        detailTotal: jobs.length
      });
      if (!isZhilianJobDetailUrl(nextJob.url)) {
        jobs[nextIndex] = markDetailNavigationFailed(nextJob, nextIndex + 1, jobs.length, `岗位详情链接无效或不是智联岗位页：${nextJob.url || "空"}`);
        postProgress(message, "warning", `智联 Chrome跳过无效详情链接 ${nextIndex + 1}/${jobs.length}：${nextJob.title}`, {
          ...baseMeta,
          stage: "details",
          detailIndex: nextIndex + 1,
          detailTotal: jobs.length,
          targetUrl: nextJob.url
        });
        return await continueZhilianDetailScan({ ...message, jobs, detailIndex: nextIndex + 1, totalSaved }, keyword, runId, baseMeta);
      }
      const nextNavigation = await navigateToDetail(message, nextJob.url);
      if (nextNavigation.status === "pending") {
        return { success: true, totalSaved, pendingNavigation: true };
      }
      if (nextNavigation.status === "blocked") {
        jobs[nextIndex] = markDetailNavigationFailed(nextJob, nextIndex + 1, jobs.length, nextNavigation.message);
        postProgress(message, "warning", `智联 Chrome详情页跳转无响应，已跳过 ${nextIndex + 1}/${jobs.length}：${nextJob.title}`, {
          ...baseMeta,
          stage: "details",
          detailIndex: nextIndex + 1,
          detailTotal: jobs.length,
          currentUrl: window.location.href,
          targetUrl: nextJob.url,
          reason: nextNavigation.message
        });
        return await continueZhilianDetailScan({ ...message, jobs, detailIndex: nextIndex + 1, totalSaved }, keyword, runId, baseMeta);
      }
      return await continueZhilianDetailScan({ ...message, jobs, detailIndex: nextIndex, totalSaved }, keyword, runId, baseMeta);
    }

    if (await hasStopRequested()) {
      stopRequested = true;
      clearStoredScanTask();
      return { success: true, totalSaved };
    }
    postProgress(message, "info", `智联 Chrome已读取 ${jobs.length} 个岗位详情，提交后台AI队列`, {
      ...baseMeta,
      stage: "submitting",
      collected: jobs.length
    });
    const res = await fetch(`${API_BASE}/api/zhilian/chrome/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, keyword, jobs })
    });
    if (await hasStopRequested()) {
      stopRequested = true;
      clearStoredScanTask();
      return { success: true, totalSaved };
    }
    if (!res.ok) throw new Error(`智联岗位提交失败：HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "智联岗位提交失败");
    if (data.cancelled || await hasStopRequested()) {
      stopRequested = true;
      clearStoredScanTask();
      return { success: true, totalSaved };
    }
    const nextTotalSaved = totalSaved + (data.saved || 0);
    postProgress(message, "success", `智联 Chrome已提交后台AI队列：采集 ${data.received ?? jobs.length} 个，入库 ${data.saved ?? 0} 个，入队 ${data.queued ?? 0} 个，恢复已有分析 ${data.restored ?? 0} 个，跳过 ${data.skipped ?? 0} 个。`, {
      ...baseMeta,
      stage: "submitted",
      collected: data.received ?? jobs.length,
      saved: data.saved ?? 0,
      queued: data.queued ?? 0,
      skipped: data.skipped ?? 0,
      restored: data.restored ?? 0,
      queueSize: data.queueSize ?? 0,
      totalSaved: nextTotalSaved
    });
    await storeScanTask({
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

  function enrichZhilianJobFromCurrentDetail(job, message, detailIndex, detailTotal) {
    const listDescription = job.description || "";
    try {
      const detailText = zhilianDetailDescription();
      const fullText = compact(document.body?.innerText || "");
      const tags = zhilianDetailTags();
      const detailUrl = isZhilianJobDetailUrl(window.location.href) ? window.location.href : job.url;
      const description = detailText || stripCompanyOnlyText(fullText) || listDescription;
      return {
        ...job,
        title: zhilianDetailTitle() || job.title,
        company: zhilianDetailCompany() || job.company,
        salary: textOf(document, ["[class*='salary']", "[class*='job-salary']"]) || job.salary,
        location: tags.location || job.location,
        experience: tags.experience || job.experience,
        degree: tags.degree || job.degree,
        deliveryStatus: detectZhilianDeliveryStatus(document) || job.deliveryStatus || "",
        description,
        url: detailUrl
      };
    } catch (error) {
      postProgress(message, "warning", `智联 Chrome详情读取失败，改用列表文本：${job.title}`);
      return {
        ...job,
        description: stripCompanyOnlyText(listDescription),
        detailIndex,
        detailTotal
      };
    }
  }

  async function deliverOne(task, message = {}) {
    if (!task?.url || !task?.id) throw new Error("投递任务缺少岗位链接或ID");
    postProgress(message, "info", `智联 Chrome准备投递当前岗位：${task.companyName || ""} ${task.jobName || ""}`.trim(), {
      operation: "deliver",
      stage: "checking",
      keyword: task.jobName || task.title || "",
      keywordTotal: 1,
      keywordIndex: 1
    });
    await waitForPage();
    if (!isCurrentZhilianJobDetailPage(task.url) && !isSameUrl(window.location.href, task.url)) {
      const failure = classifyDeliveryFailure("当前智联页面不是目标岗位详情页，已取消投递。");
      await postDeliveryResult(task, false, failure);
      return { success: false, message: failure.failureReason, failureType: failure.failureType };
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
        console.warn("Zhilian deliver response failed", error);
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

  async function deliverOnCurrentPage(task, message = {}, earlyRespond) {
    if (!task?.url || !task?.id) {
      return { success: false, message: "投递任务缺少岗位链接或ID" };
    }
    await waitForPage();
    if (!isCurrentZhilianJobDetailPage(task.url) && !isSameUrl(window.location.href, task.url)) {
      const failure = classifyDeliveryFailure("当前智联页面不是目标岗位详情页，已取消投递。");
      await postDeliveryResult(task, false, failure);
      return { success: false, message: failure.failureReason, failureType: failure.failureType };
    }

    await sleep(1500);
    postProgress(message, "info", `智联 Chrome正在当前详情页收藏并投递：${task.companyName || ""} ${task.jobName || ""}`.trim(), {
      operation: "deliver",
      stage: "submitting",
      keyword: task.jobName || task.title || "",
      keywordIndex: Number(message.deliveryIndex || 1),
      keywordTotal: Number(message.deliveryTotal || 1)
    });

    if (detectZhilianDeliveryStatus(document)) {
      const successMessage = "智联岗位已是已投递状态";
      await postDeliveryResult(task, true, successMessage);
      earlyRespond?.({ success: true, message: successMessage, early: true });
      postProgress(message, "success", successMessage, {
        operation: "deliver",
        stage: "complete",
        saved: 1
      });
      return { success: true, message: successMessage };
    }

    const pageFailure = detectZhilianDeliveryFailure("");
    if (pageFailure) {
      const failure = classifyDeliveryFailure(pageFailure);
      await postDeliveryResult(task, false, failure);
      postProgress(message, "warning", `智联 Chrome投递失败：${failure.failureReason}`, {
        operation: "deliver",
        stage: "error"
      });
      return { success: false, message: failure.failureReason, failureType: failure.failureType };
    }

    const favoriteButton = findZhilianActionButton(["收藏"], ["已收藏", "取消收藏"]);
    if (favoriteButton) {
      clickElement(favoriteButton);
      await sleep(700);
      postProgress(message, "info", "智联 Chrome已点击收藏。", {
        operation: "deliver",
        stage: "submitting"
      });
    }

    let applyButton = findZhilianActionButton(["立即投递", "申请职位", "投递简历", "投递"], ["已投递", "已申请", "投递成功", "申请成功"]);
    if (!applyButton && favoriteButton) {
      applyButton = await waitForZhilianActionButton(["立即投递", "申请职位", "投递简历", "投递"], ["已投递", "已申请", "投递成功", "申请成功"], 3500);
    }
    if (!applyButton) {
      const failure = classifyDeliveryFailure("未找到智联投递按钮");
      await postDeliveryResult(task, false, failure);
      postProgress(message, "warning", `智联 Chrome投递失败：${failure.failureReason}`, {
        operation: "deliver",
        stage: "error"
      });
      return { success: false, message: failure.failureReason, failureType: failure.failureType };
    }

    postProgress(message, "info", "智联 Chrome已找到投递入口，准备点击立即投递。", {
      operation: "deliver",
      stage: "submitting"
    });
    clickElement(applyButton);
    await sleep(1500);

    if (detectZhilianDeliveryStatus(document)) {
      const successMessage = favoriteButton ? "智联岗位已收藏并投递" : "智联岗位已投递";
      await postDeliveryResult(task, true, successMessage);
      earlyRespond?.({ success: true, message: successMessage, early: true });
      postProgress(message, "success", `智联 Chrome投递完成：${successMessage}。`, {
        operation: "deliver",
        stage: "complete",
        saved: 1
      });
      return { success: true, message: successMessage };
    }

    const clickedFailure = detectZhilianDeliveryFailure("");
    if (clickedFailure) {
      const failure = classifyDeliveryFailure(clickedFailure);
      await postDeliveryResult(task, false, failure);
      postProgress(message, "warning", `智联 Chrome投递失败：${failure.failureReason}`, {
        operation: "deliver",
        stage: "error"
      });
      return { success: false, message: failure.failureReason, failureType: failure.failureType };
    }

    const confirm = await waitForZhilianActionButton(["确认投递", "确定", "继续投递"], ["取消"], 2500);
    if (confirm) {
      clickElement(confirm);
      await sleep(1200);
    }

    const finalFailure = detectZhilianDeliveryFailure("");
    if (finalFailure && !detectZhilianDeliveryStatus(document)) {
      const failure = classifyDeliveryFailure(finalFailure);
      await postDeliveryResult(task, false, failure);
      postProgress(message, "warning", `智联 Chrome投递失败：${failure.failureReason}`, {
        operation: "deliver",
        stage: "error"
      });
      return { success: false, message: failure.failureReason, failureType: failure.failureType };
    }

    const successMessage = favoriteButton ? "智联岗位已收藏并在Chrome中投递" : "智联岗位已在Chrome中投递";
    await postDeliveryResult(task, true, successMessage);
    earlyRespond?.({ success: true, message: successMessage, early: true });
    postProgress(message, "success", `智联 Chrome投递完成：${successMessage}。`, {
      operation: "deliver",
      stage: "complete",
      saved: 1
    });
    return { success: true, message: successMessage };
  }

  async function deliverBatch(tasks, message = {}) {
    let success = 0;
    let failed = 0;
    for (const task of tasks) {
      const result = await deliverOne(task, message).catch(async (error) => {
        const failure = classifyDeliveryFailure(error.message || String(error));
        await postDeliveryResult(task, false, failure).catch(() => {});
        return { success: false, message: failure.failureReason, failureType: failure.failureType };
      });
      if (result.success) success += 1;
      else failed += 1;
    }
    return { success: true, message: `智联批量投递完成：成功${success}，失败${failed}`, successCount: success, failedCount: failed };
  }

  async function postDeliveryResult(task, success, message) {
    const failure = success ? null : normalizeFailurePayload(message);
    await fetch(`${API_BASE}/api/zhilian/jobs/${task.id}/delivery-result`, {
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
      payload: { platform: "zhilian", type, message: text, timestamp: Date.now(), ...meta }
    });
  }

  function findClickable(labels) {
    const all = Array.from(document.querySelectorAll("button, a, div, span")).filter((el) => el.offsetParent !== null);
    return all.find((el) => labels.some((label) => compact(el.innerText || "").includes(label)));
  }

  function findZhilianActionButton(labels, excludeLabels = []) {
    const candidates = Array.from(document.querySelectorAll("button, a, [role='button'], div, span"))
      .filter((el) => el.offsetParent !== null && !isDisabledElement(el));
    return candidates
      .map((el) => ({ el, text: elementActionText(el) }))
      .filter(({ el, text }) => {
        if (!text || excludeLabels.some((label) => text.includes(label))) return false;
        if (!labels.some((label) => text.includes(label))) return false;
        return isDirectClickableElement(el) || !hasMatchingActionDescendant(el, labels, excludeLabels);
      })
      .sort((left, right) => actionButtonScore(right.el, right.text, labels) - actionButtonScore(left.el, left.text, labels))
      .map(({ el }) => el)[0] || null;
  }

  async function waitForZhilianActionButton(labels, excludeLabels = [], timeoutMs = 3500) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const button = findZhilianActionButton(labels, excludeLabels);
      if (button) return button;
      await sleep(250);
    }
    return null;
  }

  function clickElement(element) {
    element.scrollIntoView?.({ block: "center", inline: "center" });
    element.focus?.();
    for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  function elementActionText(element) {
    return compact([
      element.innerText,
      element.textContent,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title")
    ].filter(Boolean).join(" "));
  }

  function hasMatchingActionDescendant(element, labels, excludeLabels) {
    return Array.from(element.querySelectorAll?.("button, a, [role='button'], span") || []).some((child) => {
      if (child === element || child.offsetParent === null || isDisabledElement(child)) return false;
      const text = elementActionText(child);
      if (!text || excludeLabels.some((label) => text.includes(label))) return false;
      return labels.some((label) => text.includes(label));
    });
  }

  function actionButtonScore(element, text, labels) {
    let score = 0;
    if (isDirectClickableElement(element)) score += 20;
    if (labels.some((label) => text === label)) score += 10;
    if (text.length <= 8) score += 4;
    if (text.length > 24) score -= 8;
    return score;
  }

  function isDirectClickableElement(element) {
    const tagName = String(element.tagName || "").toLowerCase();
    return tagName === "button" || tagName === "a" || element.getAttribute?.("role") === "button";
  }

  function isDisabledElement(element) {
    return Boolean(
      element.disabled
      || element.getAttribute?.("disabled") !== null
      || element.getAttribute?.("aria-disabled") === "true"
      || /\bdisabled\b/.test(String(element.className || ""))
    );
  }

  function detectZhilianDeliveryStatus(root = document) {
    const text = compact([
      ...Array.from(root.querySelectorAll?.("button, a, [role='button'], div, span") || [])
        .filter((el) => el.offsetParent !== null)
        .map((el) => [el.innerText, el.textContent, el.getAttribute?.("aria-label"), el.getAttribute?.("title")].filter(Boolean).join(" ")),
      root === document ? "" : root.innerText
    ].filter(Boolean).join(" "));
    if (/(已投递|已申请|投递成功|申请成功|继续沟通)/.test(text)) return "已投递";
    return "";
  }

  function detectZhilianDeliveryFailure(fallback) {
    const text = compact(document.body?.innerText || "");
    if (isSecurityPrompt(text)) return "智联页面出现平台验证，请处理后重试";
    if (isStrongLoginPrompt(text, window.location.href)) return "智联登录状态失效，请在Chrome中重新登录后重试";
    const reason = firstMatch(text, /(职位已关闭|停止招聘|职位不存在|岗位已下线|已暂停招聘|已投递|已申请|投递成功|申请成功|今日投递.*?已用完|投递上限|账号异常|操作过于频繁|请先完善简历|请上传简历|请先完成实名认证)/);
    return reason || fallback || "";
  }

  function classifyDeliveryFailure(message) {
    const text = compact([message, document.body?.innerText || "", window.location.href || ""].filter(Boolean).join(" "));
    let failureType = "UNKNOWN_ERROR";
    if (isStrongLoginPrompt(text, window.location.href) || /(登录|重新登录|未登录|扫码|账号登录)/.test(text)) {
      failureType = "LOGIN_EXPIRED";
    } else if (isSecurityPrompt(text) || /(安全验证|验证码|滑块|验证|风控|实名认证|账号异常|操作过于频繁)/.test(text)) {
      failureType = "PLATFORM_VERIFICATION";
    } else if (/(职位已关闭|停止招聘|职位不存在|岗位已下线|已暂停招聘|岗位关闭|已下线)/.test(text)) {
      failureType = "JOB_CLOSED";
    } else if (/(已投递|已申请|投递成功|申请成功|重复投递)/.test(text)) {
      failureType = "ALREADY_DELIVERED";
    } else if (/(未找到.*按钮|按钮不可点击|无法点击|不可点击|请先完善简历|请上传简历)/.test(text)) {
      failureType = "BUTTON_UNCLICKABLE";
    } else if (/(网络|超时|timeout|fetch|HTTP|请求失败|连接失败|未返回结果|发送失败)/i.test(text)) {
      failureType = "NETWORK_ERROR";
    }
    return { failureType, failureReason: message || "智联投递失败" };
  }

  function normalizeFailurePayload(message) {
    if (message && typeof message === "object") {
      const reason = message.failureReason || message.message || "智联投递失败";
      return { failureType: message.failureType || classifyDeliveryFailure(reason).failureType, failureReason: reason };
    }
    return classifyDeliveryFailure(String(message || "智联投递失败"));
  }

  async function scrollForCards(searchJobLimit = 20) {
    const scrollRounds = Math.min(30, Math.max(6, Math.ceil(normalizeSearchJobLimit(searchJobLimit) / 10)));
    for (let i = 0; i < scrollRounds && !await hasStopRequested(); i++) {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.9));
      await humanPause(550, 950);
    }
    window.scrollTo(0, 0);
  }

  async function storeScanTask(task) {
    const normalized = {
      ...normalizeScanTask(task),
      source: "GET_JOBS_BACKGROUND",
      type: "ZHILIAN_SCAN_START",
      updatedAt: Date.now()
    };
    sessionStorage.setItem(SCAN_TASK_KEY, JSON.stringify(normalized));
    await writeSharedScanTask(normalized);
  }

  function readStoredScanTask() {
    try {
      const raw = sessionStorage.getItem(SCAN_TASK_KEY);
      return raw ? normalizeScanTask(JSON.parse(raw)) : null;
    } catch {
      sessionStorage.removeItem(SCAN_TASK_KEY);
      return null;
    }
  }

  function clearStoredScanTask() {
    sessionStorage.removeItem(SCAN_TASK_KEY);
    clearSharedScanTask();
  }

  async function readStoredScanTaskFromAnyStorage() {
    if (await hasStopRequested()) return null;
    const localTask = readStoredScanTask();
    if (localTask) return localTask;

    const sharedTask = await readSharedScanTask();
    if (sharedTask) {
      sessionStorage.setItem(SCAN_TASK_KEY, JSON.stringify(sharedTask));
      return sharedTask;
    }
    return null;
  }

  async function writeSharedScanTask(task) {
    if (!chrome?.storage?.local) return;
    try {
      await chrome.storage.local.set({ [SHARED_SCAN_TASK_KEY]: task });
    } catch (error) {
      console.warn("[GetJobs] 智联共享扫描任务保存失败", error);
    }
  }

  async function readSharedScanTask() {
    if (!chrome?.storage?.local) return null;
    try {
      const result = await chrome.storage.local.get(SHARED_SCAN_TASK_KEY);
      const task = result?.[SHARED_SCAN_TASK_KEY];
      return task ? normalizeScanTask(task) : null;
    } catch (error) {
      console.warn("[GetJobs] 智联共享扫描任务读取失败", error);
      return null;
    }
  }

  function clearSharedScanTask() {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.remove(SHARED_SCAN_TASK_KEY).catch((error) => {
      console.warn("[GetJobs] 智联共享扫描任务清理失败", error);
    });
  }

  async function writeSharedStopRequested(runId = "") {
    if (!chrome?.storage?.local) return;
    try {
      await chrome.storage.local.set({
        [SHARED_SCAN_CANCEL_KEY]: {
          requested: true,
          runId: runId || "",
          updatedAt: Date.now()
        }
      });
    } catch (error) {
      console.warn("[GetJobs] 智联共享停止标记保存失败", error);
    }
  }

  async function readSharedStopRequested() {
    if (!chrome?.storage?.local) return null;
    try {
      const result = await chrome.storage.local.get(SHARED_SCAN_CANCEL_KEY);
      return result?.[SHARED_SCAN_CANCEL_KEY] || null;
    } catch (error) {
      console.warn("[GetJobs] 智联共享停止标记读取失败", error);
      return null;
    }
  }

  async function clearSharedStopRequested() {
    if (!chrome?.storage?.local) return;
    try {
      await chrome.storage.local.remove(SHARED_SCAN_CANCEL_KEY);
    } catch (error) {
      console.warn("[GetJobs] 智联共享停止标记清理失败", error);
    }
  }

  function normalizeScanTask(message) {
    const config = message?.config || {};
    const keywords = uniqueStrings(toList(message?.keywords || config.keywords || config.keyword || "AI产品运营"));
    const searchJobLimit = normalizeSearchJobLimit(message?.searchJobLimit ?? config.searchJobLimit);
    const hasExplicitIndex = hasOwn(message, "currentIndex");
    const cursorState = resolveKeywordCursor(message, keywords, hasExplicitIndex);
    return {
      ...message,
      config: { ...config, keywords, searchJobLimit },
      keywords,
      source: "GET_JOBS_BACKGROUND",
      type: "ZHILIAN_SCAN_START",
      currentIndex: cursorState.currentIndex,
      totalSaved: Number(message.totalSaved || 0),
      phase: message.phase || "searching",
      detailIndex: Number(message.detailIndex || 0),
      jobs: Array.isArray(message.jobs) ? message.jobs : [],
      collectedJobs: normalizeCollectedJobs(message.collectedJobs),
      searchPage: Math.max(1, Number(message.searchPage || 1)),
      pagesScanned: Math.max(0, Number(message.pagesScanned || 0)),
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
    const keywords = scanKeywords(task);
    writeKeywordCursor(task?.keywordCursorKey || buildKeywordCursorKey(task, keywords), index, keywords.length, "current", keyword);
  }

  function advanceKeywordCursor(task, nextIndex, keyword = "") {
    const keywords = scanKeywords(task);
    if (!keywords.length) return;
    writeKeywordCursor(task?.keywordCursorKey || buildKeywordCursorKey(task, keywords), normalizeKeywordIndex(nextIndex, keywords.length), keywords.length, "next", keyword);
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
      platform: "zhilian",
      keywords: uniqueStrings(keywords),
      cityCode: normalizedList(config.cityCode),
      salary: normalizedList(config.salary),
      searchJobLimit
    });
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
    if (!task || task.type !== "ZHILIAN_SCAN_START" || !task.runId) return false;
    if (task.completed || task.phase === "complete" || task.phase === "stopped" || task.phase === "error") return false;

    const lastActiveAt = Number(task.updatedAt || task.startedAt || 0);
    if (!lastActiveAt || Date.now() - lastActiveAt > SCAN_TASK_TTL_MS) return false;

    return isZhilianTaskPage(task);
  }

  function isZhilianTaskPage(task) {
    try {
      const current = new URL(window.location.href);
      if (!current.hostname.includes("zhaopin.com")) return false;

      const phase = String(task.phase || "");
      if (phase === "detail") {
        const jobs = Array.isArray(task.jobs) ? task.jobs : [];
        const job = jobs[Number(task.detailIndex || 0)];
        if (buildPageBlockDiagnostics().hasBlockingState) return true;
        return Boolean(job?.url && isSameUrl(current.href, job.url) && isZhilianJobDetailUrl(current.href))
          || isZhilianJobDetailUrl(current.href);
      }
      if (phase === "searching" || phase === "collecting" || phase === "nextKeyword") {
        return isZhilianSearchPath(current.pathname) || buildPageBlockDiagnostics().hasBlockingState;
      }

      return false;
    } catch {
      return false;
    }
  }

  async function storeStopRequested(runId = "") {
    stopRequested = true;
    sessionStorage.setItem(SCAN_CANCEL_KEY, "1");
    await writeSharedStopRequested(runId);
  }

  async function clearStopRequested() {
    stopRequested = false;
    sessionStorage.removeItem(SCAN_CANCEL_KEY);
    await clearSharedStopRequested();
  }

  function isStopRequested() {
    return stopRequested || sessionStorage.getItem(SCAN_CANCEL_KEY) === "1";
  }

  async function hasStopRequested() {
    if (isStopRequested()) return true;
    const shared = await readSharedStopRequested();
    if (shared?.requested) {
      stopRequested = true;
      sessionStorage.setItem(SCAN_CANCEL_KEY, "1");
      return true;
    }
    return false;
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

  function buildSearchUrl(keyword, config, pageNumber = 1) {
    const city = first(config.cityCode, "0");
    const pathCity = city && city !== "0" ? city : "0";
    const page = Math.max(1, Math.floor(Number(pageNumber) || 1));
    return `https://www.zhaopin.com/sou/jl${pathCity}/kw${encodeURIComponent(keyword)}/p${page}`;
  }

  function isCurrentSearchPage(keyword, config, pageNumber = 1) {
    try {
      const current = new URL(window.location.href);
      if (!current.hostname.includes("zhaopin.com")) return false;
      if (!current.pathname.startsWith("/sou/")) return false;

      const target = new URL(buildSearchUrl(keyword, config, pageNumber));
      if (current.pathname === target.pathname) return true;

      const keywordInPath = current.pathname.match(/\/kw([^/]+)/);
      if (!keywordInPath) return false;
      const currentPage = currentSearchPageNumber();
      const expectedPage = Math.max(1, Math.floor(Number(pageNumber) || 1));
      if (currentPage !== expectedPage) return false;
      const encodedKeyword = encodeURIComponent(keyword);
      const rawKeyword = keywordInPath[1] || "";
      if (rawKeyword === encodedKeyword || decodeURIComponentSafe(rawKeyword) === keyword) return true;
      const pageText = compact([document.title, document.body?.innerText || ""].filter(Boolean).join(" "));
      return Boolean(rawKeyword && pageText.includes(keyword));
    } catch {
      return false;
    }
  }

  async function waitForJobCards() {
    let diagnostics = buildListDiagnostics();
    for (let i = 0; i < 30 && !await hasStopRequested(); i++) {
      diagnostics = buildListDiagnostics();
      if (diagnostics.jobNodes > 0 || diagnostics.detailLinks > 0 || diagnostics.hasBlockingState) {
        return { ready: true, diagnostics };
      }
      await sleep(500);
    }
    return { ready: false, diagnostics: buildListDiagnostics() };
  }

  function buildListDiagnostics() {
    const bodyText = compact(document.body?.innerText || "");
    const currentUrl = window.location.href;
    const detailLinks = unique(JOB_LINK_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll(selector))))
      .filter((link) => isZhilianJobDetailUrl(resolveZhilianJobUrl(link))).length;
    const entries = collectJobEntries();
    const jobNodes = entries.length || document.querySelectorAll("[class*='joblist'], [class*='jobList'], [class*='job-card'], [class*='jobCard'], [class*='position']").length;
    const firstCard = entries[0]?.root;
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
          : detailLinks > 0 || jobNodes > 0
            ? "已出现搜索结果容器"
            : "未知";
    return {
      currentUrl,
      title: document.title || "",
      detailLinks,
      jobNodes,
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
      message: `智联页面出现${state}，扫描已暂停，请处理后重新开始。`,
      runId: task?.runId,
      startedAt: task?.startedAt,
      updatedAt: Date.now()
    });
    postProgress(task || {}, "warning", `智联页面出现${state}，扫描已暂停，请在Chrome中处理验证码/登录/安全验证后重新开始。`, {
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

  function first(value, fallback) {
    const list = toList(value);
    return list[0] && list[0] !== "不限" ? list[0] : fallback;
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

  function decodeURIComponentSafe(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return String(value || "");
    }
  }

  function textOf(root, selectors) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      const text = compact(node?.innerText || node?.textContent || "");
      if (text) return text;
    }
    return "";
  }

  function zhilianJobCardRoot(link) {
    if (!link?.closest) return link || document.body;
    for (const selector of JOB_CARD_ROOT_SELECTORS) {
      const root = link.closest(selector);
      if (isUsefulZhilianJobCardRoot(root, link)) return root;
    }
    let root = link.parentElement;
    let depth = 0;
    while (root && root !== document.body && depth < 8) {
      if (isUsefulZhilianJobCardRoot(root, link)) return root;
      root = root.parentElement;
      depth += 1;
    }
    return link.parentElement || link;
  }

  function isUsefulZhilianJobCardRoot(root, link) {
    if (!root || root === document.documentElement || root === document.body) return false;
    if (!root.contains(link)) return false;
    const text = compact(root.innerText || root.textContent || "");
    if (!text || text.length < compact(link.innerText || link.textContent || "").length) return false;
    if (root === link) return false;
    if ((root.querySelectorAll?.("a[href]")?.length || 0) > 80) return false;
    return hasZhilianJobCardSignal(text, root);
  }

  function hasZhilianJobCardSignal(text, root) {
    return Boolean(
      guessSalary(text)
        || firstMatch(text, /(经验不限|不限经验|在校\/应届|应届|[0-9]+-[0-9]+年|[0-9]+年以内|[0-9]+年以上)/)
        || firstMatch(text, /(学历不限|本科|大专|硕士|博士|高中|中专)/)
        || textOf(root, COMPANY_NAME_SELECTORS)
        || root.querySelector?.("a[href*='company'], a[href*='gongsi'], a[href*='qiye']")
    );
  }

  function zhilianDetailDescription() {
    const selectors = [
      "[class*='job-sec-text']",
      "[class*='job-sec']",
      "[class*='job-description']",
      "[class*='jobDescription']",
      "[class*='job-detail']",
      "[class*='jobDetail']",
      "[class*='describ']",
      "[class*='responsibility']",
      "[class*='position-detail']",
      "[class*='positionDetail']",
      "[class*='requirement']"
    ];
    const parts = selectors.map((selector) => textOf(document, [selector]))
      .filter((text) => text && !looksLikeCompanyOnlyText(text));
    const selected = parts.find((text) => hasJobRequirementText(text)) || parts.sort((a, b) => b.length - a.length)[0] || "";
    return compact(selected);
  }

  function zhilianDetailTitle() {
    return cleanJobTitle(textOf(document, [
      "[class*='job-title']",
      "[class*='jobTitle']",
      "[class*='jobname']",
      "[class*='jobName']",
      "[class*='position-name']",
      "[class*='positionName']",
      "h1"
    ]));
  }

  function zhilianDetailCompany() {
    return textOf(document, [
      "[class*='compname']",
      "[class*='company-name']",
      "[class*='companyName']",
      "[class*='companyname']",
      "[class*='com-name']",
      "[class*='company'] a",
      "a[href*='company']",
      "a[href*='gongsi']",
      "a[href*='qiye']"
    ]) || guessZhilianCompany(compact(document.body?.innerText || ""), zhilianDetailTitle());
  }

  function zhilianDetailTags() {
    const text = compact(document.body?.innerText || "");
    return {
      location: firstMatch(text, /(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|长沙|重庆|天津|郑州|厦门|合肥|佛山|东莞|珠海|中山|全国|远程)[^\s，,。]*/),
      experience: firstMatch(text, /(经验不限|不限经验|在校\/应届|应届|[0-9]+-[0-9]+年|[0-9]+年以内|[0-9]+年以上)/),
      degree: firstMatch(text, /(学历不限|本科|大专|硕士|博士|高中|中专)/)
    };
  }

  function compact(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function firstMatch(text, pattern) {
    const match = String(text || "").match(pattern);
    return match ? match[0] : "";
  }

  function firstLine(text) {
    return compact(text).split(" ")[0] || "";
  }

  function cleanJobTitle(text) {
    const value = compact(text);
    if (!value) return "";
    const salaryIndex = value.search(/\d+\s*-\s*\d+K|\d+K|面议/i);
    const clipped = salaryIndex > 0 ? value.slice(0, salaryIndex) : value;
    return compact(clipped.replace(/急聘|直招|招聘$/g, "")).slice(0, 80);
  }

  function guessSalary(text) {
    const match = String(text || "").match(/\d+\s*-\s*\d+K(?:·\d+薪)?|\d+K(?:·\d+薪)?|面议/i);
    return match ? match[0].replace(/\s+/g, "") : "";
  }

  function guessZhilianLocation(text) {
    return firstMatch(text, /(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|长沙|重庆|天津|郑州|厦门|合肥|佛山|东莞|珠海|中山|全国|远程)[^\s，,。]*/);
  }

  function guessZhilianCompany(text, title = "") {
    const value = compact(text);
    if (!value) return "";
    const companyMatch = value.match(/([\u4e00-\u9fa5A-Za-z0-9（）()·._-]{2,40}(?:公司|集团|科技|传媒|文化|网络|信息|咨询|教育|商贸|贸易|电商|电子商务|工作室|中心|门店|店))/);
    if (companyMatch) return compact(companyMatch[1]);
    const filtered = value.split(" ")
      .map((item) => compact(item))
      .filter((item) => item
        && item !== title
        && item.length >= 2
        && item.length <= 40
        && !guessSalary(item)
        && !/经验不限|不限经验|学历不限|本科|大专|硕士|博士|高中|中专|职位|岗位|招聘|立即沟通|投递/.test(item)
        && !guessZhilianLocation(item));
    return filtered[0] || "";
  }

  function guessCompany(text) {
    const parts = compact(text).split(" ");
    return parts.length > 1 ? parts[1] : "";
  }

  function normalizeZhilianJobUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl || "", window.location.origin);
      if (parsed.hostname.endsWith("zhaopin.com") && parsed.protocol === "http:") {
        parsed.protocol = "https:";
      }
      parsed.hash = "";
      return parsed.href;
    } catch {
      return String(rawUrl || "");
    }
  }

  function resolveZhilianJobUrl(linkOrUrl) {
    const raw = typeof linkOrUrl === "string"
      ? linkOrUrl
      : linkOrUrl?.getAttribute?.("href") || linkOrUrl?.href || linkOrUrl?.dataset?.url || "";
    const value = String(raw || "").trim();
    if (!value || /^(javascript|mailto|tel):/i.test(value)) return "";
    return normalizeZhilianJobUrl(value);
  }

  function isZhilianJobDetailUrl(rawUrl) {
    if (!rawUrl) return false;
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      const text = `${host}${path}${parsed.search.toLowerCase()}`;
      if (!host.endsWith("zhaopin.com")) return false;
      if (/company|gongsi|qiye|enterprise|firm|business|corp/.test(`${host}${path}`)) return false;
      if (isZhilianSearchPath(path) || /\/search\/|\/company\/|\/gongsi\/|\/qiye\//.test(path)) return false;
      return host.startsWith("jobs.")
        || /\/job\/[^/?#]+/.test(path)
        || /\/jobs\/[^/?#]+/.test(path)
        || /jobdetail|positiondetail|job_detail|jobposition|position/.test(text);
    } catch {
      return false;
    }
  }

  function isZhilianSearchPath(pathname) {
    return /^\/sou(\/|$)/.test(String(pathname || "").toLowerCase());
  }

  function isCurrentZhilianJobDetailPage(expectedUrl) {
    const currentUrl = window.location.href;
    if (!isZhilianJobDetailUrl(currentUrl)) return false;
    const text = compact(document.body?.innerText || "");
    if (looksLikeCompanyOnlyText(text)) return false;
    if (!zhilianDetailTitle() && !hasJobRequirementText(text)) return false;
    const expectedId = extractUrlId(expectedUrl);
    const currentId = extractUrlId(currentUrl);
    return !expectedId || !currentId || expectedId === currentId;
  }

  function stripCompanyOnlyText(text) {
    const value = compact(text);
    return looksLikeCompanyOnlyText(value) ? "" : value;
  }

  function looksLikeCompanyOnlyText(text) {
    const value = compact(text);
    if (!value) return true;
    return hasCompanyProfileText(value) && !hasJobRequirementText(value);
  }

  function hasCompanyProfileText(text) {
    return /(公司介绍|企业介绍|工商信息|公司信息|经营范围|企业信息|统一社会信用代码|法定代表人|注册资本)/.test(text || "");
  }

  function hasJobRequirementText(text) {
    return /(岗位职责|职位描述|职位要求|任职要求|岗位要求|工作职责|工作内容|岗位描述|招聘人数|职位亮点|任职资格)/.test(text || "");
  }

  function extractUrlId(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      const path = parsed.pathname;
      const detailMatch = path.match(/jobdetail\/([^/?#]+?)(?:\.htm|\/|$)/i);
      if (detailMatch) return detailMatch[1];
      const pathMatch = path.match(/\/(?:job|jobs|positiondetail|job_detail)\/([^/?#]+)/i);
      if (pathMatch) return pathMatch[1].replace(/\.htm$/i, "");
      return "";
    } catch {
      const value = String(url || "");
      const detailMatch = value.match(/jobdetail\/([^/?#]+?)(?:\.htm|[/?#]|$)/i);
      if (detailMatch) return detailMatch[1];
      const pathMatch = value.match(/\/(?:job|jobs|positiondetail|job_detail)\/([^/?#]+)/i);
      return pathMatch ? pathMatch[1].replace(/\.htm$/i, "") : "";
    }
  }

  function markDetailNavigationFailed(job, detailIndex, detailTotal, reason) {
    return {
      ...job,
      description: job.description || "",
      detailIndex,
      detailTotal,
      detailNavigationFailed: true,
      detailNavigationFailureReason: reason || "详情页跳转失败"
    };
  }

  async function navigateToDetail(message, targetUrl) {
    const normalizedTargetUrl = normalizeZhilianJobUrl(targetUrl);
    if (!normalizedTargetUrl) return { status: "blocked", message: "岗位缺少详情链接" };
    if (!isZhilianJobDetailUrl(normalizedTargetUrl)) {
      return { status: "blocked", message: `拒绝打开非智联岗位详情页：${normalizedTargetUrl}` };
    }
    if (await hasStopRequested()) {
      stopRequested = true;
      return { status: "blocked", message: "智联扫描已停止" };
    }
    const beforeUrl = window.location.href;
    if (isSameUrl(beforeUrl, normalizedTargetUrl)) {
      postProgress(message, "info", "智联 Chrome详情链接与当前页面相同，直接继续解析当前详情页。", {
        operation: "scan",
        stage: "details",
        currentUrl: beforeUrl,
        targetUrl: normalizedTargetUrl
      });
      return { status: "same" };
    }

    const backgroundNavigation = await requestBackgroundNavigation(normalizedTargetUrl);
    if (!backgroundNavigation.success) {
      postProgress(message, "warning", `智联 Chrome后台跳转详情失败，已跳过该岗位：${backgroundNavigation.message}`, {
        operation: "scan",
        stage: "details",
        currentUrl: beforeUrl,
        targetUrl: normalizedTargetUrl
      });
      return { status: "blocked", message: backgroundNavigation.message };
    }
    await sleep(DETAIL_NAVIGATION_GUARD_MS);
    if (await hasStopRequested()) {
      stopRequested = true;
      return { status: "blocked", message: "智联扫描已停止" };
    }
    if (!isSameUrl(window.location.href, beforeUrl)) {
      return { status: "pending" };
    }
    return {
      status: "blocked",
      message: backgroundNavigation.success
        ? "已请求后台跳转，但页面URL未变化"
        : backgroundNavigation.message
    };
  }

  async function requestBackgroundNavigation(targetUrl) {
    try {
      const response = await chrome.runtime.sendMessage({
        source: "GET_JOBS_ZHILIAN_CONTENT",
        type: "ZHILIAN_NAVIGATE_TAB",
        url: targetUrl
      });
      return response?.success
        ? { success: true, url: response.url || targetUrl }
        : { success: false, message: response?.message || "后台未返回成功状态" };
    } catch (error) {
      return { success: false, message: error.message || String(error) };
    }
  }

  function unique(nodes) {
    return Array.from(new Set(nodes));
  }

  function normalizeUrlKey(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      parsed.hash = "";
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      return parsed.href;
    } catch {
      return String(url || "").split("#")[0].replace(/\/+$/, "");
    }
  }

  function normalizeJobUrlKey(job) {
    const id = extractUrlId(job?.url || "");
    return id || normalizeUrlKey(job?.url || "");
  }

  function isSameUrl(left, right) {
    try {
      const leftUrl = new URL(left, window.location.origin);
      const rightUrl = new URL(right, window.location.origin);
      return normalizeUrlKey(leftUrl.href) === normalizeUrlKey(rightUrl.href);
    } catch {
      return normalizeUrlKey(left) === normalizeUrlKey(right);
    }
  }

  function waitForPage() {
    if (document.readyState === "complete" || document.readyState === "interactive") return Promise.resolve();
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = window.setInterval(async () => {
        if (document.readyState === "complete" || document.readyState === "interactive" || await hasStopRequested() || Date.now() - startedAt > 10000) {
          window.clearInterval(timer);
          resolve();
        }
      }, 200);
      window.addEventListener("DOMContentLoaded", () => {
        window.clearInterval(timer);
        resolve();
      }, { once: true });
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = window.setInterval(async () => {
        if (await hasStopRequested() || Date.now() - startedAt >= ms) {
          window.clearInterval(timer);
          resolve();
        }
      }, Math.min(200, Math.max(50, ms)));
    });
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function humanPause(minMs, maxMs) {
    return sleep(randomInt(minMs, maxMs));
  }
})();
