const PLATFORM_CONFIG = {
  boss: {
    hosts: ["zhipin.com"],
    home: "https://www.zhipin.com/",
    contentScript: "boss-content.js"
  },
  zhilian: {
    hosts: ["zhaopin.com"],
    home: "https://www.zhaopin.com/",
    contentScript: "zhilian-content.js"
  }
};

const pageTabs = new Map();
const BACKGROUND_VERSION = "2026-06-09-zhilian-reinject-listener-1";
const CONTENT_READY_RETRIES = 12;
const CONTENT_READY_INTERVAL_MS = 250;
const TAB_LOAD_TIMEOUT_MS = 10000;
const DELIVERY_NAVIGATION_TIMEOUT_MS = 15000;
const REQUIRED_BOSS_CONTENT_VERSION = "2026-06-04-boss-page-status-1";
const REQUIRED_ZHILIAN_CONTENT_VERSION = "2026-06-09-zhilian-reinject-listener-1";
const ALLOWED_PAGE_ORIGINS = new Set([
  "http://localhost:6866",
  "http://127.0.0.1:6866"
]);
const ALLOWED_PAGE_MESSAGE_TYPES = new Set([
  "GET_JOBS_EXTENSION_PING",
  "BOSS_PAGE_STATUS",
  "BOSS_SCAN_STATUS",
  "BOSS_SCAN_START",
  "BOSS_SCAN_STOP",
  "BOSS_DELIVER_ONE",
  "BOSS_DELIVER_BATCH",
  "ZHILIAN_SCAN_STATUS",
  "ZHILIAN_SCAN_START",
  "ZHILIAN_SCAN_STOP",
  "ZHILIAN_DELIVER_ONE",
  "ZHILIAN_DELIVER_BATCH"
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source === "GET_JOBS_BOSS_CONTENT" && message.type === "BOSS_NAVIGATE_TAB") {
    if (!isBossSender(sender)) {
      sendResponse({ success: false, message: "拒绝非 Boss 页面发起的导航请求" });
      return;
    }
    handleBossContentNavigation(message, sender).then(sendResponse).catch((error) => {
      sendResponse({ success: false, message: error.message || String(error) });
    });
    return true;
  }

  if (message?.source === "GET_JOBS_ZHILIAN_CONTENT" && message.type === "ZHILIAN_NAVIGATE_TAB") {
    if (!isZhilianSender(sender)) {
      sendResponse({ success: false, message: "拒绝非智联页面发起的导航请求" });
      return;
    }
    handleZhilianContentNavigation(message, sender).then(sendResponse).catch((error) => {
      sendResponse({ success: false, message: error.message || String(error) });
    });
    return true;
  }

  if (message?.source === "GET_JOBS_PAGE") {
    if (!isAllowedPageSender(sender)) {
      sendResponse({ success: false, message: "当前页面来源不允许连接 Chrome Bridge" });
      return;
    }
    if (!isValidPageMessage(message)) {
      sendResponse({ success: false, message: "Chrome Bridge 请求类型不被允许" });
      return;
    }
    handlePageMessage(message, sender).then(sendResponse).catch((error) => {
      sendResponse({ success: false, message: error.message || String(error) });
    });
    return true;
  }

  if (message?.source === "GET_JOBS_PLATFORM" && message.pageTabId) {
    forwardPlatformEvent(message, sender).catch(() => {});
  }
});

async function forwardPlatformEvent(message, sender) {
  if (!isSupportedPlatformSender(sender)) return;
  const pageTab = await chrome.tabs.get(message.pageTabId).catch(() => null);
  if (!isAllowedPageUrl(pageTab?.url || pageTab?.pendingUrl || "")) return;
  chrome.tabs.sendMessage(message.pageTabId, {
    source: "GET_JOBS_BACKGROUND",
    type: "GET_JOBS_EXTENSION_EVENT",
    payload: message.payload
  }).catch(() => {});
}

function isValidPageMessage(message) {
  return Boolean(
    message
      && message.source === "GET_JOBS_PAGE"
      && typeof message.type === "string"
      && ALLOWED_PAGE_MESSAGE_TYPES.has(message.type)
  );
}

function isAllowedPageSender(sender) {
  return isAllowedPageUrl(sender?.tab?.url || sender?.url || "");
}

function isAllowedPageUrl(url) {
  try {
    const parsed = new URL(url);
    return ALLOWED_PAGE_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
}

function isSupportedPlatformSender(sender) {
  return isBossSender(sender) || isZhilianSender(sender);
}

function isBossSender(sender) {
  return isBossUrl(sender?.tab?.url || sender?.url || "");
}

function isZhilianSender(sender) {
  return isZhilianUrl(sender?.tab?.url || sender?.url || "");
}

async function handleBossContentNavigation(message, sender) {
  const tabId = sender.tab?.id;
  const targetUrl = String(message?.url || "");
  if (!tabId) return { success: false, message: "缺少Boss标签页ID" };
  if (!isBossSearchUrl(targetUrl)) return { success: false, message: "拒绝打开非Boss搜索页" };

  await chrome.tabs.update(tabId, { url: targetUrl });
  return { success: true };
}

async function handleZhilianContentNavigation(message, sender) {
  const tabId = sender.tab?.id;
  const targetUrl = normalizeZhilianUrl(message?.url);
  if (!tabId) return { success: false, message: "缺少智联标签页ID" };
  if (!targetUrl) return { success: false, message: "智联详情链接为空或格式错误" };
  if (!isZhilianUrl(targetUrl)) return { success: false, message: `拒绝打开非智联页面：${targetUrl}` };
  if (!isZhilianJobDetailUrl(targetUrl)) return { success: false, message: `拒绝打开非智联岗位详情页：${targetUrl}` };

  await chrome.tabs.update(tabId, { url: targetUrl });
  return { success: true, url: targetUrl };
}

async function handlePageMessage(message, sender) {
  const pageTabId = sender.tab?.id;
  if (pageTabId) pageTabs.set(pageTabId, Date.now());

  if (message.type === "GET_JOBS_EXTENSION_PING") {
    return { success: true, message: "Chrome扩展已连接", version: BACKGROUND_VERSION };
  }

  const platform = message.platform || inferPlatform(message.type);
  if (!platform || !PLATFORM_CONFIG[platform]) {
    return { success: false, message: "未知平台" };
  }

  const config = PLATFORM_CONFIG[platform];
  const tab = isNoCreatePlatformMessage(message.type)
    ? await findPlatformTab(platform)
    : await findOrCreatePlatformTab(platform, platformStartUrl(message));
  if (!tab?.id) {
    return {
      success: true,
      message: message.type === "BOSS_SCAN_STOP" ? "没有正在运行的Boss扫描任务" : "未找到已打开的平台页面",
      isRunning: false,
      stage: "idle"
    };
  }

  if (isPassiveStatusMessage(message.type)) {
    return await queryPassivePlatformStatus(tab.id, platform, message, pageTabId);
  }

  if (isPassiveStopMessage(message.type)) {
    return await sendPassiveStop(tab.id, platform, message, pageTabId);
  }

  if (isDeliverMessage(platform, message.type)) {
    return platform === "boss"
      ? await handleBossDeliver(tab, config, message, pageTabId)
      : await handleZhilianDeliver(tab, config, message, pageTabId);
  }

  await waitForSupportedTab(tab.id, config);
  await ensureContentScript(tab.id, config.contentScript);
  if (!isNoFocusPlatformMessage(message.type)) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      ...toPlatformContentMessage(message, platform),
      source: "GET_JOBS_BACKGROUND",
      pageTabId
    });
    return response || { success: true };
  } catch (error) {
    return {
      success: false,
      message: buildContentScriptError(platform, error)
    };
  }
}

function inferPlatform(type) {
  if (type?.startsWith("BOSS_")) return "boss";
  if (type?.startsWith("ZHILIAN_")) return "zhilian";
  return "";
}

function isNoFocusPlatformMessage(type) {
  return type === "BOSS_SCAN_STATUS" || type === "BOSS_PAGE_STATUS" || type === "BOSS_SCAN_STOP" || type === "ZHILIAN_SCAN_STATUS" || type === "ZHILIAN_SCAN_STOP";
}

function isNoCreatePlatformMessage(type) {
  return isNoFocusPlatformMessage(type);
}

function isPassiveStatusMessage(type) {
  return type === "BOSS_SCAN_STATUS" || type === "BOSS_PAGE_STATUS" || type === "ZHILIAN_SCAN_STATUS";
}

function isPassiveStopMessage(type) {
  return type === "BOSS_SCAN_STOP" || type === "ZHILIAN_SCAN_STOP";
}

function isBossDeliverMessage(type) {
  return type === "BOSS_DELIVER_ONE" || type === "BOSS_DELIVER_BATCH";
}

function isZhilianDeliverMessage(type) {
  return type === "ZHILIAN_DELIVER_ONE" || type === "ZHILIAN_DELIVER_BATCH";
}

function isDeliverMessage(platform, type) {
  return platform === "boss" ? isBossDeliverMessage(type) : isZhilianDeliverMessage(type);
}

function platformStartUrl(message) {
  if (message?.startUrl) return message.startUrl;
  if (message?.type === "BOSS_DELIVER_ONE" && message?.task?.url) return message.task.url;
  if (message?.type === "BOSS_DELIVER_BATCH" && Array.isArray(message.tasks) && message.tasks[0]?.url) {
    return message.tasks[0].url;
  }
  if (message?.type === "ZHILIAN_DELIVER_ONE" && message?.task?.url) return normalizeZhilianUrl(message.task.url) || message.task.url;
  if (message?.type === "ZHILIAN_DELIVER_BATCH" && Array.isArray(message.tasks) && message.tasks[0]?.url) {
    return normalizeZhilianUrl(message.tasks[0].url) || message.tasks[0].url;
  }
  return undefined;
}

async function handleBossDeliver(tab, config, message, pageTabId) {
  if (message.type === "BOSS_DELIVER_ONE") {
    const result = await deliverBossTask(tab, config, message.task, message, pageTabId, 1, 1).catch(async (error) => {
      const errorMessage = error.message || String(error);
      await postBossDeliveryResult(message.task, false, classifyDeliveryFailure(errorMessage)).catch(() => {});
      return {
        success: false,
        message: errorMessage,
        failureType: classifyDeliveryFailure(errorMessage).failureType
      };
    });
    return result || { success: false, message: "Boss投递未返回结果" };
  }

  const tasks = Array.isArray(message.tasks) ? message.tasks : [];
  if (!tasks.length) {
    return { success: false, message: "Boss批量投递任务为空" };
  }

  let success = 0;
  let failed = 0;
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    const result = await deliverBossTask(tab, config, task, message, pageTabId, index + 1, tasks.length).catch(async (error) => {
      const errorMessage = error.message || String(error);
      await postBossDeliveryResult(task, false, classifyDeliveryFailure(errorMessage)).catch(() => {});
      return {
        success: false,
        message: errorMessage,
        failureType: classifyDeliveryFailure(errorMessage).failureType
      };
    });
    if (result?.success) success += 1;
    else failed += 1;
  }

  return {
    success: true,
    message: `Boss批量投递完成：成功${success}，失败${failed}`,
    successCount: success,
    failedCount: failed
  };
}

async function deliverBossTask(tab, config, task, message, pageTabId, index, total) {
  if (!task?.url || !task?.id) {
    if (task?.id) {
      await postBossDeliveryResult(task, false, classifyDeliveryFailure("投递任务缺少岗位链接或ID")).catch(() => {});
    }
    return { success: false, message: "投递任务缺少岗位链接或ID" };
  }

  postPlatformProgress(pageTabId, {
    platform: "boss",
    type: "info",
    message: `Boss Chrome准备打开投递岗位 ${index}/${total}：${task.companyName || ""} ${task.jobName || ""}`.trim(),
    operation: "deliver",
    stage: "navigating",
    keyword: task.jobName || task.title || "",
    keywordIndex: index,
    keywordTotal: total
  });
  const targetUrl = task.url;
  await navigatePlatformTab(tab.id, targetUrl, config, DELIVERY_NAVIGATION_TIMEOUT_MS, { bossJobUrl: targetUrl });
  await ensureContentScript(tab.id, config.contentScript);
  if (!isNoFocusPlatformMessage(message.type)) {
    const updatedTab = await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(updatedTab.windowId || tab.windowId, { focused: true }).catch(() => {});
  }

  try {
    return await sendBossDeliverCurrent(tab.id, message, task, pageTabId, index, total);
  } catch (error) {
    const errorMessage = buildContentScriptError("boss", error, "投递");
    const failure = classifyDeliveryFailure(errorMessage);
    await postBossDeliveryResult(task, false, failure).catch(() => {});
    return {
      success: false,
      message: failure.failureReason,
      failureType: failure.failureType
    };
  }
}

async function sendBossDeliverCurrent(tabId, message, task, pageTabId, index, total) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        ...message,
        type: "BOSS_DELIVER_CURRENT_V2",
        source: "GET_JOBS_BACKGROUND",
        task,
        pageTabId,
        deliveryIndex: index,
        deliveryTotal: total
      });
      if (response) return response;
      const fallback = await inferBossDeliveryAfterEmptyResponse(tabId, task);
      if (fallback.success) return fallback;
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw lastError || new Error("Boss投递请求发送失败");
}

async function handleZhilianDeliver(tab, config, message, pageTabId) {
  if (message.type === "ZHILIAN_DELIVER_ONE") {
    const result = await deliverZhilianTask(tab, config, message.task, message, pageTabId, 1, 1).catch(async (error) => {
      const errorMessage = error.message || String(error);
      await postZhilianDeliveryResult(message.task, false, classifyZhilianDeliveryFailure(errorMessage)).catch(() => {});
      return {
        success: false,
        message: errorMessage,
        failureType: classifyZhilianDeliveryFailure(errorMessage).failureType
      };
    });
    return result || { success: false, message: "智联投递未返回结果" };
  }

  const tasks = Array.isArray(message.tasks) ? message.tasks : [];
  if (!tasks.length) {
    return { success: false, message: "智联批量投递任务为空" };
  }

  let success = 0;
  let failed = 0;
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    const result = await deliverZhilianTask(tab, config, task, message, pageTabId, index + 1, tasks.length).catch(async (error) => {
      const errorMessage = error.message || String(error);
      await postZhilianDeliveryResult(task, false, classifyZhilianDeliveryFailure(errorMessage)).catch(() => {});
      return {
        success: false,
        message: errorMessage,
        failureType: classifyZhilianDeliveryFailure(errorMessage).failureType
      };
    });
    if (result?.success) success += 1;
    else failed += 1;
  }

  return {
    success: true,
    message: `智联批量投递完成：成功${success}，失败${failed}`,
    successCount: success,
    failedCount: failed
  };
}

async function deliverZhilianTask(tab, config, task, message, pageTabId, index, total) {
  if (!task?.url || !task?.id) {
    if (task?.id) {
      await postZhilianDeliveryResult(task, false, classifyZhilianDeliveryFailure("投递任务缺少岗位链接或ID")).catch(() => {});
    }
    return { success: false, message: "投递任务缺少岗位链接或ID" };
  }

  const targetUrl = normalizeZhilianUrl(task.url);
  if (!targetUrl || !isZhilianJobDetailUrl(targetUrl)) {
    const failure = classifyZhilianDeliveryFailure(`拒绝打开非智联岗位详情页：${task.url || ""}`);
    await postZhilianDeliveryResult(task, false, failure).catch(() => {});
    return { success: false, message: failure.failureReason, failureType: failure.failureType };
  }

  postPlatformProgress(pageTabId, {
    platform: "zhilian",
    type: "info",
    message: `智联 Chrome准备打开投递岗位 ${index}/${total}：${task.companyName || ""} ${task.jobName || ""}`.trim(),
    operation: "deliver",
    stage: "navigating",
    keyword: task.jobName || task.title || "",
    keywordIndex: index,
    keywordTotal: total
  });
  await navigatePlatformTab(tab.id, targetUrl, config, DELIVERY_NAVIGATION_TIMEOUT_MS, { zhilianJobUrl: targetUrl });
  await ensureContentScript(tab.id, config.contentScript);
  if (!isNoFocusPlatformMessage(message.type)) {
    const updatedTab = await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(updatedTab.windowId || tab.windowId, { focused: true }).catch(() => {});
  }

  try {
    return await sendZhilianDeliverCurrent(tab.id, message, { ...task, url: targetUrl }, pageTabId, index, total);
  } catch (error) {
    const errorMessage = buildContentScriptError("zhilian", error, "投递");
    const failure = classifyZhilianDeliveryFailure(errorMessage);
    await postZhilianDeliveryResult(task, false, failure).catch(() => {});
    return {
      success: false,
      message: failure.failureReason,
      failureType: failure.failureType
    };
  }
}

async function sendZhilianDeliverCurrent(tabId, message, task, pageTabId, index, total) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        ...message,
        type: "ZHILIAN_DELIVER_CURRENT_V2",
        source: "GET_JOBS_BACKGROUND",
        task,
        pageTabId,
        deliveryIndex: index,
        deliveryTotal: total
      });
      if (response) return response;
      const fallback = await inferZhilianDeliveryAfterEmptyResponse(tabId, task);
      if (fallback.success) return fallback;
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw lastError || new Error("智联投递请求发送失败");
}

async function inferZhilianDeliveryAfterEmptyResponse(tabId, task) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const currentUrl = tab.url || tab.pendingUrl || "";
    if (isZhilianUrl(currentUrl)) {
      return {
        success: false,
        message: "智联投递未返回结果，请在详情页确认是否出现投递成功状态。"
      };
    }
    return { success: false, message: "智联投递未返回结果，当前标签页已离开智联页面。" };
  } catch {
    return { success: false, message: "智联投递未返回结果" };
  }
}

async function inferBossDeliveryAfterEmptyResponse(tabId, task) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const currentUrl = tab.url || tab.pendingUrl || "";
    if (isBossChatUrl(currentUrl)) {
      await postBossDeliveryResult(task, true, "Boss已进入沟通页").catch(() => {});
      return {
        success: true,
        message: "Boss已进入沟通页，按成功处理。"
      };
    }
    return { success: false, message: "Boss投递未返回结果，未确认进入沟通页。" };
  } catch {
    return { success: false, message: "Boss投递未返回结果" };
  }
}

async function postBossDeliveryResult(task, success, message) {
  if (!task?.id) return;
  const failure = success ? null : normalizeFailurePayload(message);
  await fetch(`http://localhost:8888/api/boss/jobs/${task.id}/delivery-result`, {
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

async function postZhilianDeliveryResult(task, success, message) {
  if (!task?.id) return;
  const failure = success ? null : normalizeZhilianFailurePayload(message);
  await fetch(`http://localhost:8888/api/zhilian/jobs/${task.id}/delivery-result`, {
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

function classifyDeliveryFailure(message) {
  const text = String(message || "");
  let failureType = "UNKNOWN_ERROR";
  if (/(登录|重新登录|未登录|扫码|账号登录)/.test(text)) failureType = "LOGIN_EXPIRED";
  else if (/(安全验证|验证码|滑块|验证|风控|实名认证|账号异常|操作过于频繁)/.test(text)) failureType = "PLATFORM_VERIFICATION";
  else if (/(职位已关闭|停止招聘|职位不存在|该职位.*不存在|岗位关闭|已下线|暂停招聘)/.test(text)) failureType = "JOB_CLOSED";
  else if (/(已投递|已申请|已沟通|继续沟通|重复投递)/.test(text)) failureType = "ALREADY_DELIVERED";
  else if (/(未找到.*按钮|按钮不可点击|无法点击|不可点击|未出现聊天窗口|未出现沟通页|暂不接受沟通|无法与该职位沟通|缺少岗位链接|缺少.*ID)/.test(text)) failureType = "BUTTON_UNCLICKABLE";
  else if (/(网络|超时|timeout|fetch|HTTP|请求失败|连接失败|未返回结果|发送失败|未能打开)/i.test(text)) failureType = "NETWORK_ERROR";
  return { failureType, failureReason: text || "Boss投递失败" };
}

function normalizeFailurePayload(message) {
  if (message && typeof message === "object") {
    const reason = message.failureReason || message.message || "Boss投递失败";
    return { failureType: message.failureType || classifyDeliveryFailure(reason).failureType, failureReason: reason };
  }
  return classifyDeliveryFailure(message);
}

function classifyZhilianDeliveryFailure(message) {
  const text = String(message || "");
  let failureType = "UNKNOWN_ERROR";
  if (/(登录|重新登录|未登录|扫码|账号登录)/.test(text)) failureType = "LOGIN_EXPIRED";
  else if (/(安全验证|验证码|滑块|验证|风控|实名认证|账号异常|操作过于频繁)/.test(text)) failureType = "PLATFORM_VERIFICATION";
  else if (/(职位已关闭|停止招聘|职位不存在|岗位已下线|已暂停招聘|岗位关闭|已下线)/.test(text)) failureType = "JOB_CLOSED";
  else if (/(已投递|已申请|投递成功|申请成功|重复投递)/.test(text)) failureType = "ALREADY_DELIVERED";
  else if (/(未找到.*按钮|按钮不可点击|无法点击|不可点击|请先完善简历|请上传简历|缺少岗位链接|缺少.*ID|非智联岗位详情页)/.test(text)) failureType = "BUTTON_UNCLICKABLE";
  else if (/(网络|超时|timeout|fetch|HTTP|请求失败|连接失败|未返回结果|发送失败|未能打开)/i.test(text)) failureType = "NETWORK_ERROR";
  return { failureType, failureReason: text || "智联投递失败" };
}

function normalizeZhilianFailurePayload(message) {
  if (message && typeof message === "object") {
    const reason = message.failureReason || message.message || "智联投递失败";
    return { failureType: message.failureType || classifyZhilianDeliveryFailure(reason).failureType, failureReason: reason };
  }
  return classifyZhilianDeliveryFailure(message);
}

async function postPlatformProgress(pageTabId, payload) {
  if (!pageTabId) return;
  const pageTab = await chrome.tabs.get(pageTabId).catch(() => null);
  if (!isAllowedPageUrl(pageTab?.url || pageTab?.pendingUrl || "")) return;
  chrome.tabs.sendMessage(pageTabId, {
    source: "GET_JOBS_BACKGROUND",
    type: "GET_JOBS_EXTENSION_EVENT",
    payload: {
      timestamp: Date.now(),
      ...payload
    }
  }).catch(() => {});
}

async function queryPassivePlatformStatus(tabId, platform, message, pageTabId) {
  if (message?.type === "BOSS_PAGE_STATUS" || platform === "zhilian") {
    try {
      await ensureContentScript(tabId, PLATFORM_CONFIG[platform].contentScript);
    } catch (error) {
      return {
        success: true,
        message: buildContentScriptError(platform, error),
        isRunning: false,
        hasStoredTask: false,
        stage: "idle"
      };
    }
  }

  if (!await pingContentScript(tabId)) {
    return {
      success: true,
      message: "平台页面脚本未就绪，状态按空闲处理。",
      isRunning: false,
      hasStoredTask: false,
      stage: "idle"
    };
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      ...toPlatformContentMessage(message, platform),
      source: "GET_JOBS_BACKGROUND",
      pageTabId
    });
    return response || { success: true, isRunning: false, stage: "idle" };
  } catch (error) {
    return {
      success: true,
      message: buildContentScriptError(platform, error),
      isRunning: false,
      hasStoredTask: false,
      stage: "idle"
    };
  }
}

async function sendPassiveStop(tabId, platform, message, pageTabId) {
  if (!await pingContentScript(tabId)) {
    return {
      success: true,
      message: platform === "boss" ? "没有正在运行的Boss扫描任务" : "没有正在运行的扫描任务",
      isRunning: false,
      stage: "idle"
    };
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      ...message,
      source: "GET_JOBS_BACKGROUND",
      pageTabId
    });
    return response || { success: true, isRunning: false, stage: "stopped" };
  } catch (error) {
    return {
      success: false,
      message: buildContentScriptError(platform, error),
      isRunning: false,
      stage: "idle"
    };
  }
}

async function findOrCreatePlatformTab(platform, startUrl) {
  const config = PLATFORM_CONFIG[platform];
  const tabs = await chrome.tabs.query({});
  const found = tabs.find((tab) => config.hosts.some((host) => (tab.url || "").includes(host)));
  if (found) return found;
  return await chrome.tabs.create({ url: startUrl || config.home, active: true });
}

async function findPlatformTab(platform) {
  const config = PLATFORM_CONFIG[platform];
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => config.hosts.some((host) => (tab.url || tab.pendingUrl || "").includes(host)));
}

async function waitForSupportedTab(tabId, config) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < TAB_LOAD_TIMEOUT_MS) {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || tab.pendingUrl || "";
    if (isSupportedUrl(url, config) && tab.status !== "loading") return tab;
    await sleep(CONTENT_READY_INTERVAL_MS);
  }

  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || tab.pendingUrl || "";
  if (!isSupportedUrl(url, config)) {
    throw new Error("请先打开支持的招聘平台页面后再开始扫描。");
  }
  return tab;
}

async function navigatePlatformTab(tabId, url, config, timeoutMs, options = {}) {
  const currentTab = await chrome.tabs.get(tabId);
  const currentUrl = currentTab.url || currentTab.pendingUrl || "";
  if (!isSameNavigationUrl(currentUrl, url, options)) {
    await chrome.tabs.update(tabId, { url });
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    const tabUrl = tab.url || tab.pendingUrl || "";
    if (isSupportedUrl(tabUrl, config) && isSameNavigationUrl(tabUrl, url, options) && tab.status !== "loading") {
      return tab;
    }
    await sleep(CONTENT_READY_INTERVAL_MS);
  }

  const tab = await chrome.tabs.get(tabId);
  const tabUrl = tab.url || tab.pendingUrl || "";
  if (!isSupportedUrl(tabUrl, config)) {
    throw new Error("请先打开支持的招聘平台页面后再投递。");
  }
  throw new Error(`${platformDisplayNameByConfig(config)}页面未能打开目标岗位详情页。当前URL：${tabUrl || "未知"}`);
}

async function ensureContentScript(tabId, file) {
  if (await isContentScriptReady(tabId, file)) return;

  await chrome.scripting.executeScript({ target: { tabId }, files: [file] });

  for (let attempt = 0; attempt < CONTENT_READY_RETRIES; attempt++) {
    if (await isContentScriptReady(tabId, file)) return;
    await sleep(CONTENT_READY_INTERVAL_MS);
  }

  throw new Error("Chrome扩展已加载，但招聘页面脚本未就绪。请刷新招聘页面后重试。");
}

async function isContentScriptReady(tabId, file) {
  const ping = await pingContentScript(tabId);
  if (!ping) return false;
  if (file === "boss-content.js") return await isBossContentVersionReady(tabId);
  if (file === "zhilian-content.js") return await isZhilianContentVersionReady(tabId);
  return true;
}

async function pingContentScript(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { source: "GET_JOBS_BACKGROUND", type: "PING_CONTENT" });
  } catch {
    return null;
  }
}

async function isBossContentVersionReady(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      source: "GET_JOBS_BACKGROUND",
      type: "GET_BOSS_CONTENT_VERSION"
    });
    return response?.version === REQUIRED_BOSS_CONTENT_VERSION;
  } catch {
    return false;
  }
}

async function isZhilianContentVersionReady(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      source: "GET_JOBS_BACKGROUND",
      type: "GET_ZHILIAN_CONTENT_VERSION"
    });
    return response?.version === REQUIRED_ZHILIAN_CONTENT_VERSION;
  } catch {
    return false;
  }
}

function toPlatformContentMessage(message, platform) {
  const type = message?.type;
  if (platform === "zhilian" && isZhilianVersionedContentMessage(type)) {
    return { ...message, type: `${type}_V2` };
  }
  return message;
}

function isZhilianVersionedContentMessage(type) {
  return type === "ZHILIAN_SCAN_START"
    || type === "ZHILIAN_SCAN_STATUS"
    || type === "ZHILIAN_DELIVER_ONE"
    || type === "ZHILIAN_DELIVER_BATCH";
}

function isSupportedUrl(url, config) {
  return /^https?:\/\//.test(url) && config.hosts.some((host) => url.includes(host));
}

function platformDisplayNameByConfig(config) {
  if (config?.contentScript === "boss-content.js") return "Boss";
  if (config?.contentScript === "zhilian-content.js") return "智联";
  return "招聘平台";
}

function isSameNavigationUrl(left, right, options = {}) {
  if (options.bossJobUrl && sameBossJobDetailUrl(left, options.bossJobUrl)) return true;
  if (options.zhilianJobUrl && sameZhilianJobDetailUrl(left, options.zhilianJobUrl)) return true;
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.origin === rightUrl.origin && leftUrl.pathname === rightUrl.pathname;
  } catch {
    return String(left || "") === String(right || "");
  }
}

function sameBossJobDetailUrl(left, right) {
  const leftId = extractBossJobId(left);
  const rightId = extractBossJobId(right);
  return Boolean(leftId && rightId && leftId === rightId);
}

function sameZhilianJobDetailUrl(left, right) {
  const leftId = extractZhilianJobId(left);
  const rightId = extractZhilianJobId(right);
  return Boolean(leftId && rightId && leftId === rightId);
}

function isBossSearchUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && parsed.hostname.endsWith("zhipin.com")
      && (parsed.pathname === "/web/geek/job" || parsed.pathname === "/web/geek/jobs");
  } catch {
    return false;
  }
}

function isBossUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith("zhipin.com");
  } catch {
    return false;
  }
}

function isZhilianUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith("zhaopin.com");
  } catch {
    return false;
  }
}

function normalizeZhilianUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.hostname.endsWith("zhaopin.com") && parsed.protocol === "http:") {
      parsed.protocol = "https:";
    }
    parsed.hash = "";
    return parsed.href;
  } catch {
    return "";
  }
}

function isZhilianJobDetailUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const text = `${host}${path}${parsed.search.toLowerCase()}`;
    if (parsed.protocol !== "https:" || !host.endsWith("zhaopin.com")) return false;
    if (/company|gongsi|qiye|enterprise|firm|business|corp/.test(`${host}${path}`)) return false;
    if (/^\/sou(\/|$)|\/search\/|\/company\/|\/gongsi\/|\/qiye\//.test(path)) return false;
    return host.startsWith("jobs.")
      || /\/job\/[^/?#]+/.test(path)
      || /\/jobs\/[^/?#]+/.test(path)
      || /jobdetail|positiondetail|job_detail|jobposition|position/.test(text);
  } catch {
    return false;
  }
}

function isBossChatUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("zhipin.com") && /chat|im|message/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function extractBossJobId(url) {
  const match = String(url || "").match(/\/job_detail\/([^/?#]+)/);
  return match ? match[1] : "";
}

function extractZhilianJobId(url) {
  try {
    const parsed = new URL(url);
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

function buildContentScriptError(platform, error, operation = "扫描") {
  const platformName = platform === "boss" ? "Boss直聘" : platform === "zhilian" ? "智联招聘" : "招聘平台";
  const detail = error?.message || String(error || "");
  if (detail.includes("Receiving end does not exist") || detail.includes("Could not establish connection")) {
    return `${platformName}页面还没有准备好接收${operation}请求。请刷新${platformName}页面，确认扩展已重新加载后再试。`;
  }
  return `${platformName}${operation}请求发送失败：${detail}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
