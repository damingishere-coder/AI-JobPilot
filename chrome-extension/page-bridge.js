(function () {
  const SOURCE = "GET_JOBS_PAGE";
  const TARGET = "GET_JOBS_EXTENSION";
  const BRIDGE_VERSION = "2026-07-15-boss-api-poc-1";
  const ALLOWED_PAGE_ORIGINS = new Set([
    "http://localhost:6866",
    "http://127.0.0.1:6866"
  ]);
  const ALLOWED_PAGE_MESSAGE_TYPES = new Set([
    "GET_JOBS_EXTENSION_PING",
    "BOSS_PAGE_STATUS",
    "BOSS_DEBUG_COLLECT",
    "BOSS_COLLECT_CURRENT_PAGE",
    "BOSS_API_POC_COLLECT",
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
  const ALLOWED_EXTENSION_MESSAGE_TYPES = new Set([
    "GET_JOBS_EXTENSION_EVENT"
  ]);

  postToPage({ source: TARGET, type: "GET_JOBS_EXTENSION_READY", version: BRIDGE_VERSION });

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!isAllowedPageOrigin(event.origin)) return;
    const message = event.data;
    if (!isValidPageMessage(message)) return;

    chrome.runtime.sendMessage(message, (response) => {
      const lastError = chrome.runtime.lastError?.message || "";
      postToPage({
        source: TARGET,
        requestId: message.requestId,
        type: `${message.type}_RESPONSE`,
        version: BRIDGE_VERSION,
        response: response || {
          success: false,
          message: normalizeLastError(lastError),
          rawMessage: lastError
        }
      });
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.source !== "GET_JOBS_BACKGROUND") return;
    if (!ALLOWED_EXTENSION_MESSAGE_TYPES.has(message.type)) return;
    postToPage({
      source: TARGET,
      type: message.type,
      version: BRIDGE_VERSION,
      payload: message.payload
    });
  });

  function postToPage(payload) {
    const targetOrigin = window.location.origin;
    if (!isAllowedPageOrigin(targetOrigin)) return;
    window.postMessage(payload, targetOrigin);
  }

  function isAllowedPageOrigin(origin) {
    return ALLOWED_PAGE_ORIGINS.has(origin);
  }

  function isValidPageMessage(message) {
    return Boolean(
      message
        && message.source === SOURCE
        && typeof message.type === "string"
        && ALLOWED_PAGE_MESSAGE_TYPES.has(message.type)
    );
  }

  function normalizeLastError(message) {
    if (!message) return "扩展无响应，请在 Chrome 扩展管理页重新加载 投递牛马 Chrome Bridge 后刷新本页面。";
    if (message.includes("Receiving end does not exist") || message.includes("Could not establish connection")) {
      return "Chrome扩展后台未接收到请求。请确认在你自己的 Chrome 中已加载并重新加载 chrome-extension 目录，然后刷新当前配置页面。";
    }
    if (message.includes("Extension context invalidated")) {
      return "Chrome扩展刚刚被重新加载，请刷新当前配置页面后再试。";
    }
    return message;
  }
})();
