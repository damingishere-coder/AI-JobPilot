(function () {
  const EXTENSION_VERSION = "2026-05-29-delivery-status-1";
  if (window.__GET_JOBS_ZHILIAN_CONTENT_VERSION__ === EXTENSION_VERSION) return;
  window.__GET_JOBS_ZHILIAN_CONTENT__ = true;
  window.__GET_JOBS_ZHILIAN_CONTENT_VERSION__ = EXTENSION_VERSION;

  const API_BASE = "http://localhost:8888";
  const SCAN_TASK_KEY = "__GET_JOBS_ZHILIAN_SCAN_TASK__";
  const SCAN_CANCEL_KEY = "__GET_JOBS_ZHILIAN_SCAN_CANCEL__";
  const SCAN_STATUS_KEY = "__GET_JOBS_ZHILIAN_SCAN_STATUS__";
  const SCAN_TASK_TTL_MS = 30 * 60 * 1000;
  let stopRequested = false;
  let activeScanPromise = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PING_CONTENT") {
      sendResponse({ success: true, version: EXTENSION_VERSION });
      return;
    }
    if (message?.type === "ZHILIAN_SCAN_STOP") {
      stopRequested = true;
      storeStopRequested();
      clearStoredScanTask();
      writeScanStatus({ isRunning: false, stopRequested: true, stage: "stopped", message: "已请求停止智联扫描" });
      postProgress(message, "warning", "智联 Chrome扫描停止请求已接收，正在中断当前任务。", {
        operation: "scan",
        stage: "stopping"
      });
      sendResponse({ success: true, message: "已请求停止智联扫描" });
      return;
    }
    if (message?.type === "ZHILIAN_SCAN_STATUS") {
      const task = readStoredScanTask();
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
      sendResponse({ success: true, ...readScanStatus(), hasStoredTask: hasResumableTask });
      return;
    }
    if (message?.type === "ZHILIAN_SCAN_START") {
      stopRequested = false;
      clearStopRequested();
      startScan(message);
      sendResponse({ success: true, message: "智联 Chrome扫描任务已启动。" });
      return;
    }
    if (message?.type === "ZHILIAN_DELIVER_ONE") {
      deliverOne(message.task).then(sendResponse).catch((error) => sendResponse({ success: false, message: error.message || String(error) }));
      return true;
    }
    if (message?.type === "ZHILIAN_DELIVER_BATCH") {
      deliverBatch(message.tasks || []).then(sendResponse).catch((error) => sendResponse({ success: false, message: error.message || String(error) }));
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
      message: "智联 Chrome扫描任务已接收",
      runId: task.runId,
      startedAt: task.startedAt,
      updatedAt: Date.now()
    });
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

  function resumeStoredScanTaskIfActive() {
    const task = readStoredScanTask();
    if (isStopRequested()) {
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

    if (!keywords.length) {
      throw new Error("智联扫描缺少关键词，请先在智联配置中填写关键词。");
    }

    if (isStopRequested()) {
      stopRequested = true;
    }

    for (let keywordIndex = Number(task.currentIndex || 0); keywordIndex < keywords.length; keywordIndex++) {
      if (isStopRequested()) stopRequested = true;
      if (stopRequested) break;
      if (keywordIndex > Number(task.currentIndex || 0) || task.phase === "nextKeyword") {
        await humanPause(1500, 3000);
      }
      const keyword = keywords[keywordIndex];
      const searchUrl = buildSearchUrl(keyword, config);
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
        task = {
          ...task,
          phase: "nextKeyword",
          jobs: [],
          detailIndex: 0,
          currentIndex: keywordIndex + 1,
          totalSaved
        };
        storeScanTask(task);
        continue;
      }

      if (!isCurrentSearchPage(keyword, config)) {
        postProgress(task, "info", `智联 Chrome准备打开搜索页：${keyword}，目标URL：${searchUrl}，当前URL：${window.location.href}`, {
          ...baseMeta,
          stage: "searching",
          currentUrl: window.location.href,
          targetUrl: searchUrl
        });
        storeScanTask(baseTask);
        window.location.assign(searchUrl);
        return { success: true, saved: totalSaved, pendingNavigation: true };
      }

      storeScanTask({ ...baseTask, phase: "collecting" });
      postProgress(task, "info", `智联 Chrome开始搜索：${keyword}，当前URL：${window.location.href}`, {
        ...baseMeta,
        stage: "searching",
        currentUrl: window.location.href
      });
      await waitForPage();
      if (isStopRequested()) {
        stopRequested = true;
        break;
      }
      await sleep(2200);
      const waitState = await waitForJobCards();
      if (handleBlockingState(task, waitState.diagnostics, baseMeta)) {
        stopRequested = true;
        break;
      }
      postProgress(task, "info", `智联岗位列表加载检查完成，开始滚动采集。详情链接 ${waitState.diagnostics.detailLinks} 个，岗位节点 ${waitState.diagnostics.jobNodes} 个。`, {
        ...baseMeta,
        stage: "collecting",
        ...waitState.diagnostics
      });
      const searchJobLimit = normalizeSearchJobLimit(task.config?.searchJobLimit);
      await scrollForCards(searchJobLimit);
      const collectResult = collectJobs(keyword, task, baseMeta);
      const candidates = collectResult.jobs;
      const jobs = candidates.slice(0, searchJobLimit);
      if (!jobs.length) {
        const diagnostics = buildListDiagnostics();
        if (handleBlockingState(task, diagnostics, baseMeta)) {
          stopRequested = true;
          break;
        }
        postProgress(task, "warning", `智联 Chrome未采集到岗位：${keyword}。当前URL=${diagnostics.currentUrl}，标题=${diagnostics.title}，详情链接=${diagnostics.detailLinks}，岗位节点=${diagnostics.jobNodes}，状态=${diagnostics.pageState}。可能未登录/安全验证/页面结构变化/筛选无结果。`, {
          ...baseMeta,
          stage: "empty",
          collected: 0,
          ...diagnostics
        });
        storeScanTask({ ...baseTask, phase: "nextKeyword", currentIndex: keywordIndex + 1, totalSaved });
        continue;
      }

      postProgress(task, "info", `智联 Chrome采集到 ${candidates.length} 个岗位，将按配置进入前 ${jobs.length}/${searchJobLimit} 个详情页做AI比对`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
        searchJobLimit
      });
      storeScanTask({
        ...baseTask,
        phase: "detail",
        detailIndex: 0,
        jobs
      });
      postProgress(task, "info", `智联 Chrome正在查看详情 1/${jobs.length}：${jobs[0].title}`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
        detailIndex: 1,
        detailTotal: jobs.length
      });
      window.location.href = jobs[0].url;
      return { success: true, saved: totalSaved, pendingNavigation: true };
    }

    clearStoredScanTask();
    const stopped = stopRequested;
    if (stopped) clearStopRequested();
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
    const selectors = [
      "a[href*='jobs.zhaopin.com']",
      "a[href*='/job/']",
      "[class*='joblist'] a",
      "[class*='job-card'] a"
    ];
    const links = unique(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))));
    const jobs = [];
    let skipped = 0;
    let errorCount = 0;
    links.slice(0, Math.max(40, normalizeSearchJobLimit(message?.config?.searchJobLimit))).forEach((link, index) => {
      try {
        const job = parseLink(link, keyword);
        if (job.title && job.company && job.url) {
          jobs.push(job);
        } else {
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
      nodeCount: links.length,
      parsed: jobs.length,
      skipped,
      errorCount
    };
  }

  function parseLink(link, keyword) {
    const root = link.closest("li, [class*='job'], [class*='card']") || link;
    const text = compact(root.innerText || link.innerText || "");
    const url = new URL(link.getAttribute("href"), window.location.origin).href;
    const title = textOf(root, ["[class*='job-title']", "[class*='position']", "a"]) || firstLine(text);
    const company = textOf(root, ["[class*='company']", "[class*='com-name']"]) || guessCompany(text);
    return {
      id: extractUrlId(url),
      title,
      company,
      salary: guessSalary(text),
      location: "",
      experience: "",
      degree: "",
      deliveryStatus: detectZhilianDeliveryStatus(root),
      description: text,
      url,
      keyword
    };
  }

  async function continueZhilianDetailScan(message, keyword, runId, baseMeta = {}) {
    const jobs = Array.isArray(message.jobs) ? message.jobs : [];
    const detailIndex = Number(message.detailIndex || 0);
    const totalSaved = Number(message.totalSaved || 0);

    if (isStopRequested()) {
      stopRequested = true;
      clearStoredScanTask();
      return { success: true, totalSaved };
    }

    if (!jobs.length) {
      storeScanTask({ ...message, phase: "nextKeyword", currentIndex: Number(message.currentIndex || 0) + 1, totalSaved });
      return { success: true, totalSaved };
    }

    const currentJob = jobs[detailIndex];
    if (currentJob && !isSameUrl(window.location.href, currentJob.url)) {
      postProgress(message, "info", `智联 Chrome正在查看详情 ${detailIndex + 1}/${jobs.length}：${currentJob.title}`, {
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
      const detailDiagnostics = buildPageBlockDiagnostics();
      if (handleBlockingState(message, detailDiagnostics, { ...baseMeta, stage: "details" })) {
        stopRequested = true;
        return { success: true, totalSaved };
      }
      await humanPause(900, 1800);
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

    const nextIndex = detailIndex + 1;
    if (isStopRequested()) stopRequested = true;
    if (!stopRequested && nextIndex < jobs.length) {
      const nextJob = jobs[nextIndex];
      storeScanTask({ ...message, jobs, detailIndex: nextIndex, totalSaved });
      postProgress(message, "info", `智联 Chrome正在查看详情 ${nextIndex + 1}/${jobs.length}：${nextJob.title}`, {
        ...baseMeta,
        stage: "details",
        collected: jobs.length,
        detailIndex: nextIndex + 1,
        detailTotal: jobs.length
      });
      window.location.href = nextJob.url;
      return { success: true, totalSaved, pendingNavigation: true };
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
    if (!res.ok) throw new Error(`智联岗位提交失败：HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "智联岗位提交失败");
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

  function enrichZhilianJobFromCurrentDetail(job, message, detailIndex, detailTotal) {
    const listDescription = job.description || "";
    try {
      const detailText = zhilianDetailDescription();
      const fullText = compact(document.body?.innerText || "");
      const tags = zhilianDetailTags();
      return {
        ...job,
        title: textOf(document, ["[class*='job-title']", "[class*='position']", "h1"]) || job.title,
        company: textOf(document, ["[class*='company-name']", "[class*='com-name']", "[class*='company']"]) || job.company,
        salary: textOf(document, ["[class*='salary']", "[class*='job-salary']"]) || job.salary,
        location: tags.location || job.location,
        experience: tags.experience || job.experience,
        degree: tags.degree || job.degree,
        deliveryStatus: detectZhilianDeliveryStatus(document) || job.deliveryStatus || "",
        description: detailText || fullText || listDescription,
        url: window.location.href || job.url
      };
    } catch (error) {
      postProgress(message, "warning", `智联 Chrome详情读取失败，改用列表文本：${job.title}`);
      return {
        ...job,
        description: listDescription,
        detailIndex,
        detailTotal
      };
    }
  }

  async function deliverOne(task) {
    if (!task?.url || !task?.id) throw new Error("投递任务缺少岗位链接或ID");
    window.location.href = task.url;
    await waitForPage();
    await sleep(1800);
    const applyButton = findClickable(["立即投递", "申请职位", "投递简历", "投递"]);
    if (!applyButton) {
      await postDeliveryResult(task, false, "未找到智联投递按钮");
      return { success: false, message: "未找到智联投递按钮" };
    }
    applyButton.click();
    await sleep(1500);
    const confirm = findClickable(["确认投递", "确定", "继续投递"]);
    if (confirm) {
      confirm.click();
      await sleep(1000);
    }
    await postDeliveryResult(task, true, "智联岗位已在Chrome中投递");
    return { success: true, message: "智联岗位已在Chrome中投递" };
  }

  async function deliverBatch(tasks) {
    let success = 0;
    let failed = 0;
    for (const task of tasks) {
      const result = await deliverOne(task).catch(async (error) => {
        await postDeliveryResult(task, false, error.message || String(error)).catch(() => {});
        return { success: false, message: error.message || String(error) };
      });
      if (result.success) success += 1;
      else failed += 1;
    }
    return { success: true, message: `智联批量投递完成：成功${success}，失败${failed}`, successCount: success, failedCount: failed };
  }

  async function postDeliveryResult(task, success, message) {
    await fetch(`${API_BASE}/api/zhilian/jobs/${task.id}/delivery-result`, {
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
      payload: { platform: "zhilian", type, message: text, timestamp: Date.now(), ...meta }
    });
  }

  function findClickable(labels) {
    const all = Array.from(document.querySelectorAll("button, a, div, span")).filter((el) => el.offsetParent !== null);
    return all.find((el) => labels.some((label) => compact(el.innerText || "").includes(label)));
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

  async function scrollForCards(searchJobLimit = 20) {
    const scrollRounds = Math.min(30, Math.max(6, Math.ceil(normalizeSearchJobLimit(searchJobLimit) / 10)));
    for (let i = 0; i < scrollRounds && !isStopRequested(); i++) {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.9));
      await humanPause(550, 950);
    }
    window.scrollTo(0, 0);
  }

  function storeScanTask(task) {
    sessionStorage.setItem(SCAN_TASK_KEY, JSON.stringify({
      ...normalizeScanTask(task),
      source: "GET_JOBS_BACKGROUND",
      type: "ZHILIAN_SCAN_START",
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

  function normalizeScanTask(message) {
    const config = message?.config || {};
    const keywords = uniqueStrings(toList(message?.keywords || config.keywords || config.keyword || "AI产品运营"));
    const searchJobLimit = normalizeSearchJobLimit(message?.searchJobLimit ?? config.searchJobLimit);
    return {
      ...message,
      config: { ...config, keywords, searchJobLimit },
      keywords,
      source: "GET_JOBS_BACKGROUND",
      type: "ZHILIAN_SCAN_START",
      currentIndex: Number(message.currentIndex || 0),
      totalSaved: Number(message.totalSaved || 0),
      phase: message.phase || "searching",
      detailIndex: Number(message.detailIndex || 0),
      jobs: Array.isArray(message.jobs) ? message.jobs : [],
      startedAt: message.startedAt || Date.now()
    };
  }

  function normalizeSearchJobLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return 20;
    return Math.min(Math.floor(parsed), 200);
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
        return Boolean(job?.url && isSameUrl(current.href, job.url)) || current.hostname.includes("jobs.zhaopin.com") || current.pathname.includes("/job/");
      }
      if (phase === "searching" || phase === "collecting" || phase === "nextKeyword") {
        return current.pathname.startsWith("/sou/");
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

  function buildSearchUrl(keyword, config) {
    const city = first(config.cityCode, "0");
    const pathCity = city && city !== "0" ? city : "0";
    return `https://www.zhaopin.com/sou/jl${pathCity}/kw${encodeURIComponent(keyword)}/p1`;
  }

  function isCurrentSearchPage(keyword, config) {
    try {
      const current = new URL(window.location.href);
      if (!current.hostname.includes("zhaopin.com")) return false;
      if (!current.pathname.startsWith("/sou/")) return false;

      const target = new URL(buildSearchUrl(keyword, config));
      if (current.pathname === target.pathname) return true;

      const keywordInPath = current.pathname.match(/\/kw([^/]+)/);
      if (!keywordInPath) return false;
      const encodedKeyword = encodeURIComponent(keyword);
      const rawKeyword = keywordInPath[1] || "";
      return rawKeyword === encodedKeyword || decodeURIComponentSafe(rawKeyword) === keyword;
    } catch {
      return false;
    }
  }

  async function waitForJobCards() {
    let diagnostics = buildListDiagnostics();
    for (let i = 0; i < 30 && !isStopRequested(); i++) {
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
    const detailLinks = document.querySelectorAll("a[href*='jobs.zhaopin.com'], a[href*='/job/']").length;
    const jobNodes = document.querySelectorAll("[class*='joblist'], [class*='job-card'], [class*='position']").length;
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

  function zhilianDetailDescription() {
    const selectors = [
      "[class*='job-description']",
      "[class*='job-detail']",
      "[class*='describ']",
      "[class*='description']",
      "[class*='responsibility']",
      "[class*='position-detail']",
      "section"
    ];
    const parts = selectors.map((selector) => textOf(document, [selector])).filter(Boolean);
    return compact(unique(parts).join("\n"));
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

  function guessSalary(text) {
    const match = String(text || "").match(/\d+\s*-\s*\d+K(?:·\d+薪)?|\d+K(?:·\d+薪)?|面议/i);
    return match ? match[0].replace(/\s+/g, "") : "";
  }

  function guessCompany(text) {
    const parts = compact(text).split(" ");
    return parts.length > 1 ? parts[1] : "";
  }

  function extractUrlId(url) {
    let last = "";
    const matcher = String(url || "").match(/[A-Za-z0-9_-]{8,}/g);
    if (matcher?.length) last = matcher[matcher.length - 1];
    return last;
  }

  function unique(nodes) {
    return Array.from(new Set(nodes));
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

  function waitForPage() {
    if (document.readyState === "complete" || document.readyState === "interactive") return Promise.resolve();
    return new Promise((resolve) => window.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function humanPause(minMs, maxMs) {
    return sleep(randomInt(minMs, maxMs));
  }
})();
