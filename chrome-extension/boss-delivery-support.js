(function (root) {
  function authenticationBlock(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !/(^|\.)zhipin\.com$/.test(url.hostname)) return "";
      if (/\/(?:verify|captcha)(?:[/.]|$)/i.test(url.pathname)) return "Boss页面出现安全验证，已暂停投递，请手动处理";
      if (/\/(?:passport|login)(?:[/.]|$)|^\/web\/user(?:\/|$)/i.test(url.pathname)) return "Boss登录状态失效，已暂停投递，请手动登录";
    } catch {}
    return "";
  }

  function preparationFailure(error) {
    const message = error?.message || String(error);
    const common = /permission|Cannot access|站点权限|脚本未就绪|扩展版本|登录|安全验证|验证码/i.test(message);
    return { success: false, outcome: "FAILED", evidence: "PRE_ACTION_ERROR",
      greetingOutcome: "NOT_SENT", greetingEvidence: "PRE_ACTION_ERROR",
      actionStarted: false, haltBatch: common || error?.code === "BOSS_PAGE_NOT_READY", message,
      ...(error?.code ? { errorCode: error.code } : {}),
      failureType: /安全验证|验证码/.test(message) ? "PLATFORM_VERIFICATION"
        : /登录/.test(message) ? "LOGIN_EXPIRED"
        : /permission|Cannot access|站点权限/i.test(message) ? "EXTENSION_PERMISSION" : "PRE_ACTION_ERROR" };
  }

  async function prepare({ chrome, tabId, targetUrl, navigate, ensure, sleep, timeoutMs = 20000, now = Date.now }) {
    if (targetUrl) {
      try {
        const target = new URL(targetUrl);
        if (target.protocol !== "https:" || !/(^|\.)zhipin\.com$/.test(target.hostname)
            || !/^\/job_detail\/[^/]+\.html$/.test(target.pathname)) throw new Error();
      } catch { return preparationFailure(new Error("目标岗位链接无效，尚未执行投递")); }
    }
    // Navigate once. Readiness polling must not restart a slow load or erase a
    // login/verification redirect. Preflight has no target and only observes.
    try {
      const current = await chrome.tabs.get(tabId);
      const blocked = authenticationBlock(current.url) || authenticationBlock(current.pendingUrl);
      if (blocked) throw new Error(blocked);
      if (targetUrl) await navigate(tabId, targetUrl);
    } catch (error) {
      const current = await chrome.tabs.get(tabId).catch(() => null);
      const blocked = authenticationBlock(current?.url) || authenticationBlock(current?.pendingUrl);
      return preparationFailure(blocked ? new Error(blocked) : error);
    }
    const deadline = now() + timeoutMs;
    let lastError;
    do {
      try {
        const before = await chrome.tabs.get(tabId);
        const blocked = authenticationBlock(before.url) || authenticationBlock(before.pendingUrl);
        if (blocked) throw new Error(blocked);
        // A new tab may still report about:blank, with only pendingUrl populated.
        if (before.status === "loading" || (before.pendingUrl && before.pendingUrl !== before.url)) {
          throw new Error("Boss页面仍在加载，尚未执行投递");
        }
        const url = new URL(before.url || "");
        if (url.protocol !== "https:" || !(url.hostname === "zhipin.com" || url.hostname.endsWith(".zhipin.com"))) {
          throw new Error("Boss页面尚未就绪，请打开已登录的Boss岗位页面");
        }
        if (targetUrl && url.pathname !== new URL(targetUrl).pathname) throw new Error("目标岗位ID与当前页面不一致，尚未执行投递");
        if (!await chrome.permissions.contains({ origins: [url.origin + "/*"] })) {
          throw new Error("Chrome扩展缺少站点权限：" + url.origin + "，请在扩展设置中允许访问该站点");
        }
        await ensure(tabId);
        const status = await chrome.tabs.sendMessage(tabId, { source: "GET_JOBS_BACKGROUND", type: "BOSS_PAGE_STATUS" });
        if (status?.hasSecurityPrompt || status?.hasLoginPrompt) throw new Error(
          (status.hasSecurityPrompt ? "Boss页面出现安全验证" : "Boss登录状态失效") + (status.message ? "：" + status.message : ""));
        if (!status?.chromePageReady || !status?.isLoggedIn) throw new Error(status?.message || "Boss页面尚未就绪");
        const after = await chrome.tabs.get(tabId);
        if (after.url !== before.url || after.status === "loading" || (after.pendingUrl && after.pendingUrl !== after.url)) {
          throw new Error("Boss页面在准备过程中发生跳转，尚未执行投递");
        }
        if (status.currentUrl && status.currentUrl !== after.url) throw new Error("Boss页面回执来自旧页面，尚未执行投递");
        return { success: true, actionStarted: false, tabId, currentUrl: after.url };
      } catch (error) {
        lastError = error;
        if (/站点权限|permission|Cannot access|登录|安全验证|验证码|版本不一致|目标岗位ID/i.test(error?.message || "")) break;
        const current = await chrome.tabs.get(tabId).catch(() => null);
        const blocked = authenticationBlock(current?.url) || authenticationBlock(current?.pendingUrl);
        if (blocked) { lastError = new Error(blocked); break; }
        if (!current || now() >= deadline) break;
        await sleep(Math.min(250, deadline - now()));
      }
    } while (now() < deadline);
    if (now() >= deadline) lastError = Object.assign(new Error(
      "Boss页面等待 " + Math.ceil(timeoutMs / 1000) + " 秒后仍未就绪，尚未执行投递。" + (lastError?.message || "")
    ), { code: "BOSS_PAGE_NOT_READY" });
    return preparationFailure(lastError);
  }
  const api = { prepare, preparationFailure };
  root.GetJobsBossDeliverySupport = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
