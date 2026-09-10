(function (root) {
  function preparationFailure(error) {
    const message = error?.message || String(error);
    const common = /permission|Cannot access|站点权限|脚本未就绪|扩展版本|登录|安全验证|验证码/i.test(message);
    return { success: false, outcome: "FAILED", evidence: "PRE_ACTION_ERROR",
      greetingOutcome: "NOT_SENT", greetingEvidence: "PRE_ACTION_ERROR",
      actionStarted: false, haltBatch: common, message,
      failureType: /permission|Cannot access|站点权限/i.test(message) ? "EXTENSION_PERMISSION" : "PRE_ACTION_ERROR" };
  }

  async function prepare({ chrome, tabId, targetUrl, navigate, ensure, sleep }) {
    if (targetUrl) {
      try {
        const target = new URL(targetUrl);
        if (target.protocol !== "https:" || !/(^|\.)zhipin\.com$/.test(target.hostname)
            || !/^\/job_detail\/[^/]+\.html$/.test(target.pathname)) throw new Error();
      } catch { return preparationFailure(new Error("目标岗位链接无效，尚未执行投递")); }
    }
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (targetUrl) await navigate(tabId, targetUrl);
        const before = await chrome.tabs.get(tabId);
        const url = new URL(before.url || "");
        if (url.protocol !== "https:" || !(url.hostname === "zhipin.com" || url.hostname.endsWith(".zhipin.com"))) {
          throw new Error("Boss页面尚未就绪，请打开已登录的Boss岗位页面");
        }
        if (targetUrl && url.pathname !== new URL(targetUrl).pathname) throw new Error("目标岗位ID与当前页面不一致，尚未执行投递");
        if (before.status === "loading" || (before.pendingUrl && before.pendingUrl !== before.url)) {
          throw new Error("Boss页面仍在跳转，尚未执行投递");
        }
        if (!await chrome.permissions.contains({ origins: [`${url.origin}/*`] })) {
          throw new Error(`Chrome扩展缺少站点权限：${url.origin}，请在扩展设置中允许访问该站点`);
        }
        await ensure(tabId);
        const status = await chrome.tabs.sendMessage(tabId, { source: "GET_JOBS_BACKGROUND", type: "BOSS_PAGE_STATUS" });
        if (!status?.chromePageReady || !status?.isLoggedIn) throw new Error(status?.message || "Boss页面登录状态未确认");
        const after = await chrome.tabs.get(tabId);
        if (after.url !== before.url || after.status === "loading" || (after.pendingUrl && after.pendingUrl !== after.url)) {
          throw new Error("Boss页面在准备过程中发生跳转，尚未执行投递");
        }
        return { success: true, actionStarted: false, tabId, currentUrl: after.url };
      } catch (error) {
        lastError = error;
        if (/站点权限|登录|安全验证|验证码/.test(error?.message || "")) break;
        if (attempt < 2) await sleep(500);
      }
    }
    return preparationFailure(lastError);
  }
  const api = { prepare, preparationFailure };
  root.GetJobsBossDeliverySupport = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
