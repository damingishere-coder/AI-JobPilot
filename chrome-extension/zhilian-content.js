(function () {
  const EXTENSION_VERSION = "2026-07-29-zhilian-security-resume-fix";
  const CONTENT_INSTANCE_ID = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.__GET_JOBS_ZHILIAN_CONTENT__ = true;
  window.__GET_JOBS_ZHILIAN_CONTENT_VERSION__ = EXTENSION_VERSION;
  window.__GET_JOBS_ZHILIAN_CONTENT_INSTANCE_ID__ = CONTENT_INSTANCE_ID;

  const LOCAL_API_TIMEOUT_MS = 30000;
  const SCAN_TASK_KEY = "__GET_JOBS_ZHILIAN_SCAN_TASK__";
  const SHARED_SCAN_TASK_KEY = "__GET_JOBS_ZHILIAN_SHARED_SCAN_TASK__";
  const SCAN_CANCEL_KEY = "__GET_JOBS_ZHILIAN_SCAN_CANCEL__";
  const SHARED_SCAN_CANCEL_KEY = "__GET_JOBS_ZHILIAN_SHARED_SCAN_CANCEL__";
  const SCAN_STATUS_KEY = "__GET_JOBS_ZHILIAN_SCAN_STATUS__";
  const KEYWORD_CURSOR_KEY = "__GET_JOBS_ZHILIAN_KEYWORD_CURSOR__";
  const SCAN_SUPPORT = window.GetJobsZhilianScanSupport || {};
  const SCAN_TASK_TTL_MS = 30 * 60 * 1000;
  const DETAIL_NAVIGATION_GUARD_MS = 800;
  const SEARCH_NAVIGATION_GRACE_MS = 15 * 1000;
  const SEARCH_NAVIGATION_RETRY_MS = 2500;
  const SEARCH_NAVIGATION_MAX_ATTEMPTS = 5;
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
    if (!scanKeywords(message).length) {
      return { success: false, message: "请至少填写一个搜索关键词" };
    }
    const existingTask = await readStoredScanTaskFromAnyStorage();
    const status = readScanStatus();
    const incomingTask = normalizeScanTask(message);
    const configChanged = Boolean(
      existingTask?.keywordCursorKey
        && incomingTask.keywordCursorKey
        && existingTask.keywordCursorKey !== incomingTask.keywordCursorKey
    );
    if (configChanged) {
      clearStoredScanTask();
      postProgress(message, "warning", "智联扫描配置已变化，旧断点已放弃，将按新配置重新开始。", {
        operation: "scan",
        stage: "checkpointReset",
        diagnosticType: "CONFIG_CHANGED"
      });
    }
    const canResumeExisting = Boolean(
      !configChanged
        && existingTask
        && !existingTask.completed
        && (isResumableScanTask(existingTask) || status.resumable || status.stage === "blocked")
    );

    stopRequested = false;
    await clearStopRequested();
    if (canResumeExisting) {
      resumeStoredScanTaskIfActive(true).catch((error) => {
        writeScanStatus({
          isRunning: false,
          stopRequested: false,
          stage: "error",
          message: error.message || String(error),
          runId: existingTask.runId,
          updatedAt: Date.now()
        });
      });
      return { success: true, message: "智联 Chrome扫描任务已恢复。", resumed: true, runId: existingTask.runId };
    }

    startScan(incomingTask).catch((error) => {
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
        message: "智联旧扫描任务已清理"
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

  async function resumeStoredScanTaskIfActive(_force = false) {
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
    const storedTask = await readStoredScanTaskFromAnyStorage();
    if (await hasStopRequested()) {
      stopRequested = true;
      clearStoredScanTask();
      writeScanStatus({ isRunning: false, stopRequested: true, stage: "stopped", message: "智联扫描已取消" });
      return;
    }
    if (!storedTask || storedTask.completed || stopRequested) return;
    const task = typeof SCAN_SUPPORT.prepareTaskForResume === "function"
      ? SCAN_SUPPORT.prepareTaskForResume(storedTask)
      : storedTask;
    if (!isFreshScanTask(task) || !isZhilianUrl(window.location.href)) {
      clearStoredScanTask();
      writeScanStatus({
        isRunning: false,
        stopRequested: false,
        stage: "idle",
        message: "智联旧扫描任务已过期或不适合恢复"
      });
      return;
    }

    await storeScanTask(task);
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
    let totalRead = Number(task.totalRead || 0);
    let totalReceived = Number(task.totalReceived || 0);
    let totalInsufficient = Number(task.totalInsufficient || 0);
    const startIndex = normalizeTaskIndex(task.currentIndex, keywords.length);

    if (!keywords.length) {
      throw new Error("请至少填写一个搜索关键词");
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
      const navigationKey = buildSearchNavigationKey(keyword, config, searchPage);
      const navigationAttempts = task.navigationKey === navigationKey ? Number(task.navigationAttempts || 0) : 0;
      const nextNavigationAttempts = navigationAttempts + 1;
      const baseTask = {
        ...task,
        source: "GET_JOBS_BACKGROUND",
        type: "ZHILIAN_SCAN_START",
        phase: "searching",
        currentIndex: keywordIndex,
        totalSaved,
        totalRead,
        totalReceived,
        totalInsufficient,
        searchUrl,
        expectedKeyword: keyword,
        expectedSearchUrl: searchUrl,
        navigationKey,
        navigationAttempts: nextNavigationAttempts,
        navigationStartedAt: Date.now()
      };
      const baseMeta = {
        operation: "scan",
        keyword,
        keywordIndex: keywordIndex + 1,
        keywordTotal: keywords.length,
        totalSaved,
        totalRead,
        totalReceived,
        totalInsufficient
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
        totalRead,
        totalReceived,
        totalInsufficient,
        startedAt: task.startedAt,
        updatedAt: Date.now()
      });

      if (task.phase === "detail") {
        const detailResult = await continueZhilianDetailScan(task, keyword, runId, baseMeta);
        if (detailResult.pendingNavigation) return { success: true, saved: totalSaved, pendingNavigation: true };
        if (detailResult.paused) return { success: false, saved: totalSaved, paused: true, message: detailResult.message };
        totalSaved = detailResult.totalSaved;
        totalRead = Number(detailResult.totalRead ?? totalRead);
        totalReceived = Number(detailResult.totalReceived ?? totalReceived);
        totalInsufficient = Number(detailResult.totalInsufficient ?? totalInsufficient);
        if (!stopRequested) advanceKeywordCursor(task, keywordIndex + 1, keyword);
        task = {
          ...task,
          phase: "nextKeyword",
          jobs: [],
          detailIndex: 0,
          currentIndex: keywordIndex + 1,
          totalSaved,
          totalRead,
          totalReceived,
          totalInsufficient
        };
        await storeScanTask(task);
        continue;
      }

      if (!isCurrentSearchPage(keyword, config, searchPage)) {
        if (nextNavigationAttempts > SEARCH_NAVIGATION_MAX_ATTEMPTS) {
          return await stopSearchNavigationFailure({
            ...baseTask,
            navigationAttempts
          }, searchUrl);
        }
        postProgress(task, "info", `智联 Chrome准备打开搜索页：${keyword}（第 ${nextNavigationAttempts} 次导航），目标URL：${searchUrl}，当前URL：${window.location.href}`, {
          ...baseMeta,
          stage: "searching",
          currentUrl: window.location.href,
          targetUrl: searchUrl,
          navigationAttempts: nextNavigationAttempts
        });
        await storeScanTask(baseTask);
        openSearchPage(searchUrl, baseTask);
        return { success: true, saved: totalSaved, pendingNavigation: true };
      }

      await storeScanTask({
        ...baseTask,
        phase: "collecting",
        navigationAttempts: 0,
        navigationStartedAt: 0
      });
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
      if (collectionResult.paused) {
        return { success: false, saved: totalSaved, paused: true, message: collectionResult.message };
      }
      if (collectionResult.stopped) {
        stopRequested = true;
        break;
      }
      if (collectionResult.empty) {
        advanceKeywordCursor(task, keywordIndex + 1, keyword);
        await storeScanTask({
          ...baseTask,
          phase: "nextKeyword",
          currentIndex: keywordIndex + 1,
          totalSaved,
          totalRead,
          totalReceived,
          totalInsufficient
        });
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
      if (detailResult.paused) return { success: false, saved: totalSaved, paused: true, message: detailResult.message };
      totalSaved = detailResult.totalSaved;
      totalRead = Number(detailResult.totalRead ?? totalRead);
      totalReceived = Number(detailResult.totalReceived ?? totalReceived);
      totalInsufficient = Number(detailResult.totalInsufficient ?? totalInsufficient);
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
        totalSaved,
        totalRead,
        totalReceived,
        totalInsufficient
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
    const finalMessage = stopped
      ? `智联 Chrome扫描已停止：已读取 ${totalRead} 个岗位，后台接收 ${totalReceived} 个，入库 ${totalSaved} 个，信息不足 ${totalInsufficient} 个`
      : `智联 Chrome扫描完成：已读取 ${totalRead} 个岗位，后台接收 ${totalReceived} 个，入库 ${totalSaved} 个，信息不足 ${totalInsufficient} 个`;
    writeScanStatus({
      isRunning: false,
      stopRequested: stopped,
      stage: stopped ? "stopped" : "complete",
      message: finalMessage,
      runId,
      keywordTotal: keywords.length,
      totalSaved,
      totalRead,
      totalReceived,
      totalInsufficient,
      saved: totalSaved,
      startedAt: task.startedAt,
      updatedAt: Date.now()
    });
    postProgress(task, stopped ? "warning" : "success", finalMessage, {
      operation: "scan",
      stage: stopped ? "stopped" : "complete",
      keywordTotal: keywords.length,
      totalSaved,
      totalRead,
      totalReceived,
      totalInsufficient,
      saved: totalSaved
    });
    return { success: true, saved: totalSaved, totalRead, totalReceived, totalInsufficient };
  }

  function collectJobs(keyword, message, baseMeta) {
    const entries = collectJobEntries();
    const initialStateJobs = collectZhilianInitialStateJobs(keyword);
    const jobs = [];
    const seenJobUrls = new Set();
    let skipped = 0;
    let errorCount = 0;
    let duplicated = 0;
    initialStateJobs.forEach((job) => {
      const urlKey = normalizeJobUrlKey(job);
      if (job.title && job.url && urlKey && !seenJobUrls.has(urlKey)) {
        seenJobUrls.add(urlKey);
        jobs.push(job);
      }
    });
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
      duplicated,
      initialStateParsed: initialStateJobs.length
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
      const blockResult = await handleBlockingState({
        ...baseTask,
        phase: "collecting",
        searchPage: pageNumber,
        pagesScanned,
        collectedJobs,
        totalSaved
      }, waitState.diagnostics, { ...baseMeta, pageNumber });
      if (blockResult) {
        return {
          paused: true,
          message: blockResult.message,
          jobs: collectedJobs.slice(0, searchJobLimit),
          candidateCount: collectedJobs.length,
          pagesScanned
        };
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

      postProgress(task, collectResult.parsed > 0 ? "info" : "warning", `智联第 ${pageNumber} 页解析完成：候选节点 ${collectResult.nodeCount} 个，首屏数据 ${collectResult.initialStateParsed || 0} 个，成功 ${collectResult.parsed} 个，本页新增 ${added} 个，累计 ${collectedJobs.length}/${searchJobLimit} 个，跳过 ${collectResult.skipped} 个，重复 ${collectResult.duplicated} 个。`, {
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
        initialStateParsed: collectResult.initialStateParsed || 0,
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
      const blockResult = await handleBlockingState({
        ...baseTask,
        phase: "collecting",
        searchPage: pageNumber,
        pagesScanned,
        collectedJobs,
        totalSaved
      }, diagnostics, baseMeta);
      if (blockResult) {
        return { paused: true, message: blockResult.message, empty: true, jobs: [], candidateCount: 0, pagesScanned };
      }
      postProgress(task, "warning", `智联 Chrome未采集到岗位：${keyword}。当前URL=${diagnostics.currentUrl}，标题=${diagnostics.title}，详情链接=${diagnostics.detailLinks}，岗位节点=${diagnostics.jobNodes}，首屏数据=${diagnostics.initialStateJobs || 0}，状态=${diagnostics.pageState}。可能未登录/安全验证/页面结构变化/筛选无结果。`, {
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
      const queryPage = Number(parsed.searchParams.get("p") || parsed.searchParams.get("page") || parsed.searchParams.get("pageIndex") || "");
      if (Number.isFinite(queryPage) && queryPage > 0) return Math.floor(queryPage);
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

  function collectZhilianInitialStateJobs(keyword) {
    const states = extractZhilianInitialStates();
    const jobs = [];
    const seen = new Set();
    states.forEach((state) => {
      findZhilianJobItems(state).forEach((item) => {
        const job = mapZhilianStateJob(item, keyword);
        const key = normalizeJobUrlKey(job);
        if (!job.title || !isZhilianJobDetailUrl(job.url) || !key || seen.has(key)) return;
        seen.add(key);
        jobs.push(job);
      });
    });
    return jobs;
  }

  function extractZhilianInitialStates() {
    const states = [];
    Array.from(document.querySelectorAll("script[type='application/json'], script#__NEXT_DATA__, script")).forEach((script) => {
      const raw = String(script.textContent || "").trim();
      if (!raw || (!raw.includes("__INITIAL_STATE__") && !raw.includes("positionList") && !raw.includes("jobList"))) return;
      const jsonTexts = [];
      if (raw.startsWith("{") || raw.startsWith("[")) jsonTexts.push(raw);
      const initialStateJson = extractJsonObjectAfter(raw, "__INITIAL_STATE__");
      if (initialStateJson) jsonTexts.push(initialStateJson);
      const preloadedStateJson = extractJsonObjectAfter(raw, "__PRELOADED_STATE__");
      if (preloadedStateJson) jsonTexts.push(preloadedStateJson);
      jsonTexts.forEach((jsonText) => {
        try {
          states.push(JSON.parse(jsonText));
        } catch {
          // Executable scripts are ignored; DOM parsing remains available.
        }
      });
    });
    return states;
  }

  function findZhilianJobItems(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 7) return [];
    if (Array.isArray(value)) {
      if (value.some(isZhilianStateJobItem)) return value.filter(isZhilianStateJobItem);
      return value.flatMap((item) => findZhilianJobItems(item, depth + 1));
    }
    const out = [];
    Object.entries(value).forEach(([key, child]) => {
      if (Array.isArray(child) && /position|job|list|data/i.test(key) && child.some(isZhilianStateJobItem)) {
        out.push(...child.filter(isZhilianStateJobItem));
      } else if (child && typeof child === "object") {
        out.push(...findZhilianJobItems(child, depth + 1));
      }
    });
    return out;
  }

  function isZhilianStateJobItem(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const title = stateText(item, ["jobName", "positionName", "name", "title"]);
    const url = stateText(item, ["positionUrl", "positionURL", "jobUrl", "url", "redirectUrl"]);
    const company = stateText(item, ["companyName", "company.name", "company"]);
    return Boolean(title && (url || company));
  }

  function mapZhilianStateJob(item, keyword) {
    const title = cleanJobTitle(stateText(item, ["jobName", "positionName", "name", "title"]));
    const rawUrl = stateText(item, ["positionUrl", "positionURL", "jobUrl", "url", "redirectUrl", "applyUrl"]);
    const url = resolveZhilianJobUrl(rawUrl);
    const description = trimToUsefulLength(stripHtml(stateText(item, [
      "description",
      "jobDesc",
      "jobDescription",
      "positionDesc",
      "jobDetailData.position.desc.description",
      "position.desc.description"
    ])), 8000);
    return {
      id: stateText(item, ["number", "positionNumber", "jobNumber", "jobId", "positionId"]) || extractUrlId(url),
      title,
      company: stateText(item, ["companyName", "company.name", "company"]),
      salary: stateText(item, ["salary60", "salary", "salaryDesc", "salaryName"]),
      location: stateText(item, ["workCity", "cityName", "city", "cityDistrict", "district"]) || guessZhilianLocation(compact(JSON.stringify(item).slice(0, 600))),
      experience: stateText(item, ["workingExp", "workExperience", "experience", "experienceName"]),
      degree: stateText(item, ["education", "educationName", "degree", "degreeName"]),
      deliveryStatus: "",
      description,
      url,
      keyword,
      source: "zhilian-initial-state"
    };
  }

  async function continueZhilianDetailScan(message, keyword, runId, baseMeta = {}) {
    const jobs = Array.isArray(message.jobs) ? message.jobs : [];
    const detailIndex = Number(message.detailIndex || 0);
    const totalSaved = Number(message.totalSaved || 0);
    const totalRead = Number(message.totalRead || 0);
    const totalReceived = Number(message.totalReceived || 0);
    const totalInsufficient = Number(message.totalInsufficient || 0);

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
      const blockResult = await handleBlockingState({
        ...message,
        phase: "detail",
        jobs,
        detailIndex,
        totalSaved
      }, detailDiagnostics, { ...baseMeta, stage: "details" });
      if (blockResult) {
        return { success: false, totalSaved, paused: true, message: blockResult.message };
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
    let data;
    try {
      data = await requestZhilianLocalApi("chrome-jobs", {
        body: { runId, keyword, jobs },
        pageTabId: message.pageTabId
      });
      if (!data.success) {
        const error = new Error(data.message || "智联岗位提交失败");
        error.errorType = data.errorType || "LOCAL_API_ERROR";
        throw error;
      }
    } catch (error) {
      return await pauseZhilianSubmission(message, jobs, totalSaved, error, baseMeta);
    }
    if (await hasStopRequested()) {
      stopRequested = true;
      clearStoredScanTask();
      return { success: true, totalSaved };
    }
    if (data.cancelled || await hasStopRequested()) {
      stopRequested = true;
      clearStoredScanTask();
      return { success: true, totalSaved };
    }
    const received = Number(data.received ?? jobs.length);
    const insufficient = Number(data.insufficient ?? 0);
    const nextTotalSaved = totalSaved + Number(data.saved || 0);
    const nextTotalRead = totalRead + jobs.length;
    const nextTotalReceived = totalReceived + received;
    const nextTotalInsufficient = totalInsufficient + insufficient;
    postProgress(message, "success", `智联 Chrome已提交后台AI队列：后台接收 ${received} 个，入库 ${data.saved ?? 0} 个，入队 ${data.queued ?? 0} 个，恢复已有分析 ${data.restored ?? 0} 个，跳过 ${data.skipped ?? 0} 个，信息不足 ${insufficient} 个。`, {
      ...baseMeta,
      stage: "submitted",
      collected: received,
      received,
      saved: data.saved ?? 0,
      queued: data.queued ?? 0,
      skipped: data.skipped ?? 0,
      insufficient,
      restored: data.restored ?? 0,
      queueSize: data.queueSize ?? 0,
      totalSaved: nextTotalSaved,
      totalRead: nextTotalRead,
      totalReceived: nextTotalReceived,
      totalInsufficient: nextTotalInsufficient
    });
    await storeScanTask({
      ...message,
      phase: "nextKeyword",
      jobs: [],
      detailIndex: 0,
      currentIndex: Number(message.currentIndex || 0) + 1,
      totalSaved: nextTotalSaved,
      totalRead: nextTotalRead,
      totalReceived: nextTotalReceived,
      totalInsufficient: nextTotalInsufficient
    });
    advanceKeywordCursor(message, Number(message.currentIndex || 0) + 1, keyword);
    return {
      success: true,
      totalSaved: nextTotalSaved,
      totalRead: nextTotalRead,
      totalReceived: nextTotalReceived,
      totalInsufficient: nextTotalInsufficient
    };
  }

  async function pauseZhilianSubmission(message, jobs, totalSaved, error, baseMeta) {
    const reason = error?.message || String(error || "未知错误");
    const errorType = error?.errorType || "LOCAL_API_ERROR";
    const failureMessage = `智联岗位提交失败，扫描断点已保留：${reason}`;
    const pausedAt = Date.now();
    await storeScanTask({
      ...message,
      phase: "detail",
      jobs,
      detailIndex: jobs.length,
      totalSaved,
      pausedAt,
      lastError: {
        type: errorType,
        message: failureMessage,
        failedAt: pausedAt
      }
    });
    writeScanStatus({
      isRunning: false,
      stopRequested: false,
      stage: "blocked",
      paused: true,
      message: failureMessage,
      runId: message.runId,
      keyword: baseMeta.keyword,
      keywordIndex: baseMeta.keywordIndex,
      keywordTotal: baseMeta.keywordTotal,
      totalSaved,
      totalRead: Number(message.totalRead || 0),
      totalReceived: Number(message.totalReceived || 0),
      totalInsufficient: Number(message.totalInsufficient || 0),
      resumable: true,
      diagnosticType: errorType,
      errorType,
      httpStatus: error?.httpStatus,
      startedAt: message.startedAt,
      updatedAt: Date.now()
    });
    postProgress(message, "error", failureMessage, {
      ...baseMeta,
      stage: "blocked",
      collected: jobs.length,
      totalSaved,
      totalRead: Number(message.totalRead || 0),
      totalReceived: Number(message.totalReceived || 0),
      totalInsufficient: Number(message.totalInsufficient || 0),
      paused: true,
      resumable: true,
      errorType,
      httpStatus: error?.httpStatus
    });
    return {
      success: false,
      totalSaved,
      totalRead: Number(message.totalRead || 0),
      totalReceived: Number(message.totalReceived || 0),
      totalInsufficient: Number(message.totalInsufficient || 0),
      paused: true,
      message: failureMessage,
      errorType
    };
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
    await requestZhilianLocalApi("delivery-result", {
      params: { id: task.id },
      body: {
        success,
        message: success ? message : failure.failureReason,
        failureType: failure?.failureType,
        failureReason: failure?.failureReason
      },
      pageTabId: task.pageTabId
    });
  }

  async function requestZhilianLocalApi(operation, options = {}) {
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        source: "GET_JOBS_ZHILIAN_CONTENT",
        type: "ZHILIAN_LOCAL_API",
        operation,
        params: options.params,
        body: options.body,
        timeoutMs: LOCAL_API_TIMEOUT_MS,
        pageTabId: options.pageTabId
      });
    } catch (error) {
      const wrapped = new Error(error?.message || String(error));
      wrapped.errorType = "LOCAL_SERVICE_UNAVAILABLE";
      throw wrapped;
    }
    if (!response?.success) {
      const error = new Error(response?.message || "智联本地服务请求失败");
      error.errorType = response?.errorType || "LOCAL_API_ERROR";
      error.httpStatus = response?.httpStatus;
      throw error;
    }
    return response.data || {};
  }

  function postProgress(message, type, text, meta = {}) {
    chrome.runtime.sendMessage({
      source: "GET_JOBS_PLATFORM",
      pageTabId: message.pageTabId,
      payload: {
        platform: "zhilian",
        type,
        message: text,
        timestamp: Date.now(),
        runId: message?.runId || "",
        ...meta
      }
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
    const messageText = compact(message || "");
    let failureType = "UNKNOWN_ERROR";
    if (isStrongLoginPrompt(text, window.location.href) || /(登录|重新登录|未登录|扫码|账号登录)/.test(text)) {
      failureType = "LOGIN_EXPIRED";
    } else if (isSecurityPrompt(text) || /(账号异常|操作过于频繁|请先完成实名认证)/.test(messageText)) {
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
    const viewportHeight = Number(window.innerHeight || document.documentElement?.clientHeight || 0);
    const scrollStep = Math.max(480, Math.min(900, Math.floor(viewportHeight * 0.9) || 640));
    for (let i = 0; i < scrollRounds && !await hasStopRequested(); i++) {
      window.scrollBy(0, scrollStep);
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

    const ownership = await readScanTabOwnership();
    if (!ownership?.isOwner) return null;

    const sharedTask = await readSharedScanTask();
    if (sharedTask) {
      if (ownership.ownerToken && sharedTask.scanOwnerToken && ownership.ownerToken !== sharedTask.scanOwnerToken) {
        return null;
      }
      sessionStorage.setItem(SCAN_TASK_KEY, JSON.stringify(sharedTask));
      return sharedTask;
    }
    return null;
  }

  async function readScanTabOwnership() {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      return { success: false, isOwner: false };
    }
    try {
      return await chrome.runtime.sendMessage({
        source: "GET_JOBS_ZHILIAN_CONTENT",
        type: "ZHILIAN_SCAN_OWNER_STATUS"
      });
    } catch {
      return { success: false, isOwner: false };
    }
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
    const keywords = scanKeywords(message);
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
      totalRead: Number(message.totalRead || 0),
      totalReceived: Number(message.totalReceived || 0),
      totalInsufficient: Number(message.totalInsufficient || 0),
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
    const searchParams = normalizedZhilianSearchParams(config);
    return stableKey({
      platform: "zhilian",
      keywords: uniqueStrings(keywords),
      cityCode: searchParams.cityCode,
      salary: searchParams.salary,
      searchJobLimit
    });
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
    return Boolean(isFreshScanTask(task) && isZhilianUrl(window.location.href));
  }

  function isFreshScanTask(task) {
    if (!task || task.type !== "ZHILIAN_SCAN_START" || !task.runId) return false;
    if (task.completed || task.phase === "complete" || task.phase === "stopped" || task.phase === "error") return false;

    const lastActiveAt = Number(task.updatedAt || task.startedAt || 0);
    return Boolean(lastActiveAt && Date.now() - lastActiveAt <= SCAN_TASK_TTL_MS);
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
    const rawKeywords = hasOwn(message, "keywords")
      ? message.keywords
      : hasOwn(config, "keywords")
        ? config.keywords
        : config.keyword;
    if (typeof SCAN_SUPPORT.normalizeKeywordList === "function") {
      return SCAN_SUPPORT.normalizeKeywordList(rawKeywords);
    }
    return uniqueStrings(toList(rawKeywords));
  }

  function buildSearchUrl(keyword, config, pageNumber = 1) {
    if (typeof SCAN_SUPPORT.buildSearchUrl === "function") {
      return SCAN_SUPPORT.buildSearchUrl(keyword, config, pageNumber);
    }
    const searchParams = normalizedZhilianSearchParams(config);
    const page = Math.max(1, Math.floor(Number(pageNumber) || 1));
    const params = new URLSearchParams();
    params.set("kw", keyword);
    if (!isUnlimitedZhilianSalary(searchParams.salary)) params.set("sl", searchParams.salary);
    if (page > 1) params.set("p", String(page));
    return `https://www.zhaopin.com/sou/jl${searchParams.cityCode}/?${params.toString()}`;
  }

  function buildSearchNavigationKey(keyword, config, pageNumber = 1) {
    const searchParams = normalizedZhilianSearchParams(config);
    const page = Math.max(1, Math.floor(Number(pageNumber) || 1));
    return `${compact(keyword)}::${searchParams.cityCode}::${searchParams.salary}::${page}`;
  }

  function normalizedZhilianSearchParams(config = {}) {
    if (typeof SCAN_SUPPORT.normalizedSearchParamsForCursor === "function") {
      return SCAN_SUPPORT.normalizedSearchParamsForCursor(config);
    }
    return {
      cityCode: normalizeZhilianCityCode(config.cityCode || config.cityId || config.city),
      salary: normalizeZhilianSalaryCode(config.salary || config.salaryTypeCode || config.sl)
    };
  }

  function normalizeZhilianCityCode(value) {
    if (typeof SCAN_SUPPORT.normalizeZhilianCityCode === "function") {
      return SCAN_SUPPORT.normalizeZhilianCityCode(value);
    }
    const city = first(value, "489");
    if (!city || city === "0" || city === "不限") return "489";
    const withoutPrefix = city.replace(/^jl/i, "");
    return /^\d+$/.test(withoutPrefix) ? withoutPrefix : "489";
  }

  function normalizeZhilianSalaryCode(value) {
    if (typeof SCAN_SUPPORT.normalizeZhilianSalaryCode === "function") {
      return SCAN_SUPPORT.normalizeZhilianSalaryCode(value);
    }
    const salary = first(value, "0000,9999999");
    if (!salary || salary === "0" || salary === "不限") return "0000,9999999";
    if ([
      "0000,9999999",
      "0000,4000",
      "4001,6000",
      "6001,8000",
      "8001,10000",
      "10001,15000",
      "15001,25000",
      "25001,35000",
      "35001,50000",
      "50001,9999999"
    ].includes(salary)) return salary;
    return "0000,9999999";
  }

  function isUnlimitedZhilianSalary(value) {
    if (typeof SCAN_SUPPORT.isUnlimitedZhilianSalary === "function") {
      return SCAN_SUPPORT.isUnlimitedZhilianSalary(value);
    }
    return normalizeZhilianSalaryCode(value) === "0000,9999999";
  }

  function isCurrentSearchPage(keyword, config, pageNumber = 1) {
    try {
      const current = new URL(window.location.href);
      if (!current.hostname.includes("zhaopin.com")) return false;
      if (!current.pathname.startsWith("/sou")) return false;

      const expectedPage = Math.max(1, Math.floor(Number(pageNumber) || 1));
      const currentPage = currentSearchPageNumber();
      if (currentPage !== expectedPage) return false;

      const target = new URL(buildSearchUrl(keyword, config, pageNumber));
      const currentKeyword = current.searchParams.get("kw") || current.searchParams.get("keyword") || current.searchParams.get("query") || "";
      const targetKeyword = target.searchParams.get("kw") || keyword;
      if (compact(currentKeyword) === compact(targetKeyword) || decodeURIComponentSafe(currentKeyword) === keyword) return true;

      const keywordInPath = current.pathname.match(/\/kw([^/]+)/);
      if (!keywordInPath) return false;
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
    const initialStateJobs = collectZhilianInitialStateJobs("");
    const entries = collectJobEntries();
    const jobNodes = entries.length || initialStateJobs.length || document.querySelectorAll("[class*='joblist'], [class*='jobList'], [class*='job-card'], [class*='jobCard'], [class*='position']").length;
    const firstCard = entries[0]?.root;
    const firstCardText = compact(firstCard?.innerText || firstCard?.textContent || "").slice(0, 160);
    const hasNormalContent = detailLinks > 0 || jobNodes > 0;
    const security = buildZhilianSecurityDiagnostics(bodyText, { hasNormalContent });
    const hasLoginPrompt = isStrongLoginPrompt(bodyText, currentUrl);
    const hasSecurityPrompt = security.hasSecurityPrompt;
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
      initialStateJobs: initialStateJobs.length,
      pageState,
      firstCardText,
      hasLoginPrompt,
      hasSecurityPrompt,
      hasNormalContent,
      hasChallengeUi: security.hasChallengeUi,
      securityReason: security.securityReason,
      hasEmptyPrompt,
      hasBlockingState: hasLoginPrompt || hasSecurityPrompt || hasEmptyPrompt
    };
  }

  function buildPageBlockDiagnostics() {
    const bodyText = compact(document.body?.innerText || "");
    const currentUrl = window.location.href;
    const security = buildZhilianSecurityDiagnostics(bodyText);
    const hasLoginPrompt = isStrongLoginPrompt(bodyText, currentUrl);
    const hasSecurityPrompt = security.hasSecurityPrompt;
    return {
      currentUrl,
      title: document.title || "",
      pageState: hasSecurityPrompt ? "安全验证" : hasLoginPrompt ? "登录提示" : "正常",
      hasLoginPrompt,
      hasSecurityPrompt,
      hasNormalContent: security.hasNormalContent,
      hasChallengeUi: security.hasChallengeUi,
      securityReason: security.securityReason,
      hasEmptyPrompt: false,
      hasBlockingState: hasLoginPrompt || hasSecurityPrompt
    };
  }

  async function handleBlockingState(task, diagnostics, meta = {}) {
    if (!diagnostics || !(diagnostics.hasSecurityPrompt || diagnostics.hasLoginPrompt)) return null;
    const state = diagnostics.hasSecurityPrompt ? "安全验证" : "登录提示";
    const diagnosticType = diagnostics.hasSecurityPrompt ? "SECURITY_VERIFICATION" : "LOGIN_REQUIRED";
    const blockedAt = Date.now();
    const message = `智联页面出现${state}，扫描已暂停且断点已保留。处理完成后可继续。`;
    await storeScanTask({
      ...task,
      blockedAt,
      pausedAt: blockedAt,
      blockState: state,
      lastError: {
        type: diagnosticType,
        message,
        failedAt: blockedAt
      }
    });
    writeScanStatus({
      isRunning: false,
      stopRequested: false,
      stage: "blocked",
      paused: true,
      resumable: true,
      diagnosticType,
      message,
      runId: task?.runId,
      startedAt: task?.startedAt,
      updatedAt: Date.now()
    });
    postProgress(task || {}, "warning", `${message}请在Chrome中处理后再次点击扫描继续。`, {
      ...meta,
      operation: "scan",
      stage: "blocked",
      paused: true,
      resumable: true,
      diagnosticType,
      currentUrl: diagnostics.currentUrl,
      pageState: diagnostics.pageState,
      hasNormalContent: Boolean(diagnostics.hasNormalContent),
      hasChallengeUi: Boolean(diagnostics.hasChallengeUi),
      securityReason: diagnostics.securityReason || ""
    });
    return { paused: true, resumable: true, diagnosticType, message };
  }

  function buildZhilianSecurityDiagnostics(text, options = {}) {
    const hasNormalContent = typeof options.hasNormalContent === "boolean"
      ? options.hasNormalContent
      : hasNormalZhilianPageContent(text);
    const hasChallengeUi = hasVisibleZhilianSecurityUi();
    const securityReason = typeof SCAN_SUPPORT.zhilianSecurityReason === "function"
      ? SCAN_SUPPORT.zhilianSecurityReason({
        url: window.location.href,
        title: document.title || "",
        text,
        hasNormalContent,
        hasChallengeUi
      })
      : hasChallengeUi || (!hasNormalContent && /请.{0,12}(?:完成|进行|通过).{0,8}验证|请.{0,8}(?:拖动|按住).{0,8}滑块/.test(text || ""))
        ? "strict-fallback"
        : "";
    return {
      hasSecurityPrompt: Boolean(securityReason),
      hasNormalContent,
      hasChallengeUi,
      securityReason
    };
  }

  function isSecurityPrompt(text) {
    return buildZhilianSecurityDiagnostics(text).hasSecurityPrompt;
  }

  function hasNormalZhilianPageContent(text = "") {
    const pathname = String(window.location.pathname || "");
    if (isZhilianJobDetailUrl(window.location.href)) {
      return Boolean(zhilianDetailTitle() && (zhilianDetailDescription() || hasJobRequirementText(compact(text))));
    }
    if (isZhilianSearchPath(pathname)) {
      return JOB_LINK_SELECTORS.some((selector) => Array.from(document.querySelectorAll(selector))
        .some((link) => isZhilianJobDetailUrl(resolveZhilianJobUrl(link))));
    }
    return false;
  }

  function hasVisibleZhilianSecurityUi() {
    const selectors = [
      "[class*='captcha']",
      "[id*='captcha']",
      "[class*='geetest']",
      "[id*='geetest']",
      "[class*='verify-slider']",
      "[id*='verify-slider']",
      "[class*='security-check']",
      "[id*='security-check']",
      "[class*='yidun']",
      "[id*='yidun']",
      "[class*='nc_wrapper']",
      "[id*='nc_wrapper']"
    ];
    if (selectors.some((selector) => Array.from(document.querySelectorAll(selector)).some(isVisibleElement))) {
      return true;
    }
    const instructionMatcher = typeof SCAN_SUPPORT.isZhilianSecurityInstructionText === "function"
      ? SCAN_SUPPORT.isZhilianSecurityInstructionText
      : (value) => /请.{0,8}(?:拖动|按住).{0,8}滑块|请输入.{0,8}验证码/.test(String(value || ""));
    return Array.from(document.querySelectorAll("[role='dialog'], [aria-modal='true'], [class*='modal'], [class*='dialog']"))
      .some((node) => isVisibleElement(node) && instructionMatcher(node.innerText || node.textContent || ""));
  }

  function isVisibleElement(node) {
    if (!(node instanceof Element)) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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

  function stateText(source, paths) {
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

  function trimToUsefulLength(text, limit) {
    const value = compact(text || "");
    if (!value) return "";
    return value.length > limit ? value.slice(0, limit) : value;
  }

  function stripHtml(text) {
    return compact(String(text || "").replace(/<[^>]+>/g, " "));
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

  function isZhilianUrl(rawUrl) {
    if (typeof SCAN_SUPPORT.isZhilianUrl === "function") {
      return SCAN_SUPPORT.isZhilianUrl(rawUrl);
    }
    try {
      const parsed = new URL(String(rawUrl || ""));
      const host = parsed.hostname.toLowerCase();
      return parsed.protocol === "https:"
        && (host === "zhaopin.com" || host.endsWith(".zhaopin.com"));
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

  function openSearchPage(url, task) {
    const attempts = Number(task.navigationAttempts || 1);
    scheduleSearchNavigationRetry(url, task, attempts);
    requestBackgroundNavigation(url, "search").then((response) => {
      if (response?.success) return;
      navigateSearchPageInCurrentFrame(url, attempts);
    }).catch(() => {
      navigateSearchPageInCurrentFrame(url, attempts);
    });

    window.setTimeout(() => {
      const stored = readStoredScanTask();
      if (!stored || stored.runId !== task.runId || stored.navigationKey !== task.navigationKey) return;
      if (!isSearchNavigationPending(stored) || isStoredSearchTargetCurrent(stored)) return;
      navigateSearchPageInCurrentFrame(url, attempts);
    }, 350);
  }

  function navigateSearchPageInCurrentFrame(url, attempts) {
    if (attempts > 1) {
      window.location.replace(url);
    } else {
      window.location.assign(url);
    }
  }

  function scheduleSearchNavigationRetry(url, task, attempts) {
    window.setTimeout(async () => {
      const stored = readStoredScanTask();
      if (!stored || stored.runId !== task.runId || stored.navigationKey !== task.navigationKey) return;
      if (!isSearchNavigationPending(stored) || isStoredSearchTargetCurrent(stored)) return;

      if (attempts >= SEARCH_NAVIGATION_MAX_ATTEMPTS) {
        await stopSearchNavigationFailure(stored, url);
        return;
      }

      const nextAttempts = Number(stored.navigationAttempts || attempts || 0) + 1;
      const retryTask = {
        ...stored,
        navigationAttempts: nextAttempts,
        navigationStartedAt: Date.now()
      };
      await storeScanTask(retryTask);
      postProgress(retryTask, "warning", `智联搜索页跳转未完成，正在重试打开搜索页：${retryTask.expectedKeyword || ""}。当前URL：${window.location.href}`, {
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

  async function stopSearchNavigationFailure(task, url) {
    const keyword = task.expectedKeyword || scanKeywords(task)[Number(task.currentIndex || 0)] || "";
    const totalSaved = Number(task.totalSaved || 0);
    const navigationAttempts = Number(task.navigationAttempts || 0);
    const message = `智联搜索页打开失败：${keyword}。已尝试 ${navigationAttempts} 次，扫描断点已保留。请确认智联页面可以正常访问后再次点击扫描继续。`;
    await storeScanTask({
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
      keywordTotal: scanKeywords(task).length,
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
      keyword,
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

  function isStoredSearchTargetCurrent(task) {
    const keyword = task?.expectedKeyword || scanKeywords(task)[Number(task?.currentIndex || 0)] || "";
    const page = Math.max(1, Number(task?.searchPage || 1));
    return Boolean(keyword && isCurrentSearchPage(keyword, task?.config || {}, page));
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

  async function requestBackgroundNavigation(targetUrl, navigationType = "detail") {
    try {
      const response = await chrome.runtime.sendMessage({
        source: "GET_JOBS_ZHILIAN_CONTENT",
        type: "ZHILIAN_NAVIGATE_TAB",
        url: targetUrl,
        navigationType
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
