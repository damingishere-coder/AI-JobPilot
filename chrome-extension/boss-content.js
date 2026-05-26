(function () {
  const EXTENSION_VERSION = "2026-05-27-boss-click-interest-chat-1";
  if (window.__GET_JOBS_BOSS_CONTENT_VERSION__ === EXTENSION_VERSION) return;
  window.__GET_JOBS_BOSS_CONTENT__ = true;
  window.__GET_JOBS_BOSS_CONTENT_VERSION__ = EXTENSION_VERSION;

  const API_BASE = "http://localhost:8888";
  const SCAN_TASK_KEY = "__GET_JOBS_BOSS_SCAN_TASK__";
  const SCAN_CANCEL_KEY = "__GET_JOBS_BOSS_SCAN_CANCEL__";
  const SCAN_STATUS_KEY = "__GET_JOBS_BOSS_SCAN_STATUS__";
  const SCAN_TASK_TTL_MS = 30 * 60 * 1000;
  const DETAIL_LIMIT_PER_KEYWORD = 20;
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
      sendResponse({ success: true, ...readScanStatus(), hasStoredTask: hasResumableTask });
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
      deliverOnCurrentPage(message.task, message).then(sendResponse).catch((error) => {
        postProgress(message, "error", error.message || String(error), {
          operation: "deliver",
          stage: "error"
        });
        sendResponse({ success: false, message: error.message || String(error) });
      });
      return true;
    }
    if (message?.type === "BOSS_DELIVER_ONE") {
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
    let currentIndex = Number(task.currentIndex || 0);
    let totalSaved = Number(task.totalSaved || 0);

    if (!keywords.length) {
      throw new Error("Boss扫描缺少关键词，请先在Boss配置中填写关键词。");
    }

    if (isStopRequested()) {
      stopRequested = true;
    }

    if (task.phase === "autoDeliver") {
      if (isStopRequested()) {
        stopRequested = true;
      } else {
      const keyword = keywords[currentIndex] || "";
      const deliveryResult = await continueAutoDeliverScan(task, keyword, {
        operation: "scan",
        keyword,
        keywordIndex: currentIndex + 1,
        keywordTotal: keywords.length,
        totalSaved
      });
      if (deliveryResult.pendingNavigation) return deliveryResult;
      task = deliveryResult.task;
      currentIndex = Number(task.currentIndex || 0);
      totalSaved = Number(task.totalSaved || totalSaved);
      }
    }

    for (let index = currentIndex; index < keywords.length; index++) {
      if (isStopRequested()) stopRequested = true;
      if (stopRequested) break;
      const keyword = keywords[index];
      const url = buildSearchUrl(keyword, city, config);
      const navigationKey = buildNavigationKey(keyword, city);
      const navigationAttempts = task.navigationKey === navigationKey ? Number(task.navigationAttempts || 0) : 0;
      const searchTaskState = {
        ...task,
        phase: "searching",
        currentIndex: index,
        totalSaved,
        navigationKey,
        navigationAttempts: navigationAttempts + 1,
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

      if (!isCurrentSearchPage(keyword, city)) {
        postProgress(task, "info", `Boss Chrome准备打开搜索页：${keyword}（第 ${navigationAttempts + 1} 次导航），目标URL：${url}，当前URL：${window.location.href}`, {
          ...baseMeta,
          stage: "searching",
          currentUrl: window.location.href,
          targetUrl: url,
          navigationAttempts: navigationAttempts + 1
        });
        storeScanTask(searchTaskState);
        window.location.assign(url);
        return { success: true, saved: totalSaved, pendingNavigation: true };
      }

      storeScanTask({ ...searchTaskState, phase: "collecting", navigationAttempts: 0 });
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
      postProgress(task, "info", `Boss岗位列表加载检查完成，开始滚动采集。详情链接 ${waitState.diagnostics.detailLinks} 个，搜索结果容器 ${waitState.diagnostics.resultContainers} 个。`, {
        ...baseMeta,
        stage: "collecting",
        ...waitState.diagnostics
      });
      await scrollForCards();
      if (isStopRequested()) {
        stopRequested = true;
        break;
      }

      const collectResult = collectJobs(keyword, task, baseMeta);
      const candidates = collectResult.jobs;
      const jobs = candidates.slice(0, DETAIL_LIMIT_PER_KEYWORD);
      postProgress(task, "info", `Boss Chrome卡片解析完成：节点 ${collectResult.nodeCount} 个，成功 ${collectResult.parsed} 个，跳过 ${collectResult.skipped} 个。`, {
        ...baseMeta,
        stage: "collecting",
        nodeCount: collectResult.nodeCount,
        parsed: collectResult.parsed,
        skipped: collectResult.skipped,
        errorCount: collectResult.errorCount
      });
      if (!jobs.length) {
        const diagnostics = buildListDiagnostics();
        postProgress(task, "warning", `Boss Chrome未采集到岗位：${keyword}。当前URL=${diagnostics.currentUrl}，标题=${diagnostics.title}，详情链接=${diagnostics.detailLinks}，搜索结果容器=${diagnostics.resultContainers}，状态=${diagnostics.pageState}，首个卡片=${diagnostics.firstCardText}。可能未登录/安全验证/页面结构变化/筛选无结果。`, {
          ...baseMeta,
          stage: "empty",
          collected: 0,
          ...diagnostics
        });
        storeScanTask({ ...task, phase: "nextKeyword", currentIndex: index + 1, totalSaved });
        continue;
      }

      const diagnostics = buildListDiagnostics();
      postProgress(task, "info", `Boss Chrome采集到 ${candidates.length} 个岗位，将进入前 ${jobs.length} 个详情页做AI比对。详情链接 ${diagnostics.detailLinks} 个。`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
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
      if (currentIndex < keywords.length) {
        return runScanInternal(task);
      }
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
    nodes.slice(0, 40).forEach((node, index) => {
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
      storeScanTask({ ...message, phase: "", currentIndex: Number(message.currentIndex || 0) + 1, totalSaved });
      return { success: true, totalSaved };
    }

    const currentJob = jobs[detailIndex];
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
    postProgress(message, "info", `Boss Chrome已读取 ${jobs.length} 个岗位详情，准备提交后端AI分析。可提交 ${submitJobs.length} 个，详情不足 ${detailSummary.missingDescription} 个。`, {
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
    postProgress(message, "success", `Boss Chrome提交后端完成：采集 ${data.received ?? submitJobs.length} 个，入库 ${data.saved ?? 0} 个，待确认 ${data.waitingConfirm ?? 0} 个，信息不足 ${data.insufficient ?? 0} 个。`, {
      ...baseMeta,
      stage: "submitted",
      collected: data.received ?? submitJobs.length,
      analyzed: data.saved ?? 0,
      saved: data.saved ?? 0,
      waitingConfirm: data.waitingConfirm ?? 0,
      insufficient: data.insufficient ?? 0,
      totalSaved: nextTotalSaved
    });
    if (isAutoDeliverEnabled(message) && Array.isArray(data.tasks) && data.tasks.length) {
      if (isStopRequested()) {
        stopRequested = true;
        clearStoredScanTask();
        return { success: true, totalSaved: nextTotalSaved };
      }
      const deliveryTask = {
        ...message,
        phase: "autoDeliver",
        jobs: [],
        detailIndex: 0,
        deliveryQueue: data.tasks,
        deliveryIndex: 0,
        totalSaved: nextTotalSaved
      };
      storeScanTask(deliveryTask);
      postProgress(message, "info", `AI通过后自动投递开启，准备真实联系 ${data.tasks.length} 个Boss HR。`, {
        ...baseMeta,
        stage: "autoDeliver",
        keywordTotal: data.tasks.length
      });
      window.location.href = data.tasks[0].url;
      return { success: true, totalSaved: nextTotalSaved, pendingNavigation: true };
    }
    storeScanTask({
      ...message,
      phase: "nextKeyword",
      jobs: [],
      detailIndex: 0,
      currentIndex: Number(message.currentIndex || 0) + 1,
      totalSaved: nextTotalSaved
    });
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
    if (delivery?.url && !isSameUrl(window.location.href, delivery.url)) {
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
    if (!isSameUrl(window.location.href, task.url)) {
      return {
        success: false,
        message: "Boss投递需要先由扩展后台打开岗位详情页，请刷新扩展和页面后重试。"
      };
    }
    if (isStopRequested()) {
      stopRequested = true;
      return { success: false, message: "Boss扫描已停止" };
    }
    return deliverOnCurrentPage(task, message);
  }

  async function deliverOnCurrentPage(task, message) {
    if (!task?.url || !task?.id) {
      return { success: false, message: "投递任务缺少岗位链接或ID" };
    }
    await waitForPage();
    if (!isSameUrl(window.location.href, task.url)) {
      return { success: false, message: "当前Boss页面不是目标岗位详情页，已取消投递。" };
    }
    if (isStopRequested()) {
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
    const favoriteButton = findClickable(["感兴趣", "收藏该岗位", "收藏"]) || findBossActionButton("favorite");
    if (favoriteButton) {
      clickElement(favoriteButton);
      await sleep(600);
      postProgress(message, "info", "Boss Chrome已点击感兴趣/收藏岗位。", {
        operation: "deliver",
        stage: "submitting"
      });
    }

    const chatButton = findClickable(["立即沟通", "继续沟通", "沟通", "立即投递"]) || findBossActionButton("chat");
    if (!chatButton) {
      await postDeliveryResult(task, false, "未找到立即沟通按钮");
      postProgress(message, "warning", "Boss Chrome投递失败：未找到立即沟通按钮", {
        operation: "deliver",
        stage: "error"
      });
      return { success: false, message: "未找到立即沟通按钮" };
    }
    postProgress(message, "info", "Boss Chrome已找到沟通入口，准备点击立即沟通。", {
      operation: "deliver",
      stage: "submitting"
    });
    clickElement(chatButton);
    await sleep(1200);
    await postDeliveryResult(task, true, favoriteButton ? "Boss岗位已点击感兴趣并立即沟通" : "Boss岗位已点击立即沟通");
    postProgress(message, "success", favoriteButton ? "Boss Chrome投递完成：已点击感兴趣并立即沟通。" : "Boss Chrome投递完成：已点击立即沟通。", {
      operation: "deliver",
      stage: "complete",
      saved: 1
    });
    return { success: true, message: favoriteButton ? "Boss岗位已点击感兴趣并立即沟通" : "Boss岗位已点击立即沟通" };
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
      if (isStopRequested()) {
        stopRequested = true;
        break;
      }
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
        await postDeliveryResult(task, false, error.message || String(error)).catch(() => {});
        return { success: false, message: error.message || String(error) };
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
    await fetch(`${API_BASE}/api/boss/jobs/${task.id}/delivery-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success, message })
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
    return {
      ...message,
      config: { ...config, keywords },
      keywords,
      source: "GET_JOBS_BACKGROUND",
      type: "BOSS_SCAN_START",
      currentIndex: Number(message.currentIndex || 0),
      totalSaved: Number(message.totalSaved || 0),
      phase: message.phase || "searching",
      detailIndex: Number(message.detailIndex || 0),
      jobs: Array.isArray(message.jobs) ? message.jobs : [],
      aiKeywordsLoaded: Boolean(message.aiKeywordsLoaded),
      autoDeliver: isAutoDeliverEnabled(message),
      startedAt: message.startedAt || Date.now()
    };
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
        return Boolean(job?.url && isSameUrl(current.href, job.url)) || current.pathname.includes("/job_detail/");
      }
      if (phase === "autoDeliver") {
        const queue = Array.isArray(task.deliveryQueue) ? task.deliveryQueue : [];
        const delivery = queue[Number(task.deliveryIndex || 0)];
        return Boolean(delivery?.url && isSameUrl(current.href, delivery.url)) || current.pathname.includes("/job_detail/");
      }
      if (phase === "searching" || phase === "collecting" || phase === "nextKeyword") {
        return current.pathname === "/web/geek/job";
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
    const rect = el.getBoundingClientRect();
    const options = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    el.dispatchEvent(new MouseEvent("pointerdown", options));
    el.dispatchEvent(new MouseEvent("mousedown", options));
    el.dispatchEvent(new MouseEvent("mouseup", options));
    el.dispatchEvent(new MouseEvent("click", options));
  }

  function extractBossId(url) {
    const match = String(url || "").match(/\/job_detail\/([^/?#]+)/);
    return match ? match[1] : "";
  }

  async function scrollForCards() {
    for (let i = 0; i < 6 && !isStopRequested(); i++) {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.9));
      await sleep(700);
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

  function isCurrentSearchPage(keyword, city) {
    try {
      const current = new URL(window.location.href);
      if (!current.hostname.includes("zhipin.com")) return false;
      if (current.pathname !== "/web/geek/job") return false;
      const query = current.searchParams.get("query") || "";
      const currentCity = current.searchParams.get("city") || "";
      return compact(decodeURIComponent(query)) === compact(keyword) && (!city || !currentCity || currentCity === city);
    } catch {
      return false;
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
    const stats = selectorStats();
    const resultContainers = SEARCH_RESULT_SELECTORS.reduce((sum, selector) => sum + document.querySelectorAll(selector).length, 0);
    const detailLinks = document.querySelectorAll("a[href*='/job_detail/']").length;
    const firstCard = collectJobNodes()[0];
    const firstCardText = compact(firstCard?.innerText || firstCard?.textContent || "").slice(0, 160);
    const hasLoginPrompt = /登录|扫码|注册|验证码/.test(bodyText);
    const hasSecurityPrompt = /安全验证|验证|滑块|访问异常|身份验证|请完成验证/.test(bodyText);
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
      currentUrl: window.location.href,
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

  function buildNavigationKey(keyword, city) {
    return `${keyword}::${city}`;
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
      recruitmentStatus: firstNonEmpty(textOf(document, [".job-status", "[class*='job-status']"]), firstMatch(bodyText, /(招聘中|急招|停止招聘|已关闭|暂停招聘)/))
    };
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
      description: trimToUsefulLength(job.description || "", 8000),
      companyInfo: trimToUsefulLength(job.companyInfo || "", 3000),
      keyword: job.keyword || ""
    };
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
})();
