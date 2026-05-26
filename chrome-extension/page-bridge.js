(function () {
  const SOURCE = "GET_JOBS_PAGE";
  const TARGET = "GET_JOBS_EXTENSION";
  const BRIDGE_VERSION = "2026-05-24-boss-location-fix-1";

  window.postMessage({ source: TARGET, type: "GET_JOBS_EXTENSION_READY", version: BRIDGE_VERSION }, "*");

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== SOURCE || !message.type) return;

    chrome.runtime.sendMessage(message, (response) => {
      const lastError = chrome.runtime.lastError?.message || "";
      window.postMessage({
        source: TARGET,
        requestId: message.requestId,
        type: `${message.type}_RESPONSE`,
        version: BRIDGE_VERSION,
        response: response || {
          success: false,
          message: normalizeLastError(lastError),
          rawMessage: lastError
        }
      }, "*");
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.source !== "GET_JOBS_BACKGROUND") return;
    window.postMessage({
      source: TARGET,
      type: message.type,
      version: BRIDGE_VERSION,
      payload: message.payload
    }, "*");
  });

  function normalizeLastError(message) {
    if (!message) return "扩展无响应，请在 Chrome 扩展管理页重新加载 Get Jobs Chrome Bridge 后刷新本页面。";
    if (message.includes("Receiving end does not exist") || message.includes("Could not establish connection")) {
      return "Chrome扩展后台未接收到请求。请确认在你自己的 Chrome 中已加载并重新加载 chrome-extension 目录，然后刷新当前配置页面。";
    }
    if (message.includes("Extension context invalidated")) {
      return "Chrome扩展刚刚被重新加载，请刷新当前配置页面后再试。";
    }
    return message;
  }
})();
