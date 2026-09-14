(function (root) {
  "use strict";
  const version = "zhilian-page-evidence/1";
  const compact = value => String(value || "").replace(/\s+/g, " ").trim();
  function detectStatus(document) {
    const labels = ["已投递", "已申请", "投递成功", "申请成功", "继续沟通"];
    const elements = Array.from(document.querySelectorAll?.("button, a, [role='button']") || []).filter(el => el.offsetParent !== null);
    if (elements.some(el => [el.innerText, el.textContent, el.getAttribute?.("aria-label"), el.getAttribute?.("title")]
      .filter(Boolean).map(compact).some(text => labels.includes(text)))) return "已投递";
    const dialogs = Array.from(document.querySelectorAll?.("[role='dialog'], .el-dialog, [class*='dialog'], [class*='modal']") || []);
    return dialogs.some(el => el.offsetParent !== null && /已向对方发送简历和打招呼语/.test(el.innerText || el.textContent || "")) ? "已投递" : "";
  }
  function detectFailure(document, href, signals = {}, fallback = "") {
    const text = compact(document.body?.innerText || "");
    if (signals.hasSecurityPrompt) return "智联页面出现平台验证，请处理后重试";
    if (signals.hasLoginPrompt) return "智联登录状态失效，请在Chrome中重新登录后重试";
    const match = text.match(/(职位已关闭|停止招聘|职位不存在|岗位已下线|已暂停招聘|今日投递[^。！!\n]*?(?:已用完|超过上限)|投递上限|账号异常|操作过于频繁|请先完善简历|请上传简历|请先完成实名认证)/);
    return match?.[0] || fallback || "";
  }
  function observe({ document, href, signals = {} }) {
    let path = "", host = "";
    try { const url = new URL(href); path = url.pathname; host = url.hostname; } catch { /* Unknown location has no identity. */ }
    const match = path.match(/\/(?:jobdetail|job_detail|positiondetail|job)\/([^/.]+)/i)
      || (host === "jobs.zhaopin.com" ? path.match(/\/([^/]+)\.htm/i) : null);
    const pageType = match ? "JOB_DETAIL" : /\/jobs|\/sou|\/jl\d+/.test(path) ? "SEARCH" : "UNKNOWN";
    const failure = detectFailure(document, href, signals);
    const blocker = signals.hasSecurityPrompt ? "VERIFICATION_REQUIRED" : signals.hasLoginPrompt ? "LOGIN_REQUIRED"
      : /今日投递|投递上限/.test(failure) ? "QUOTA_LIMIT" : /职位|岗位|招聘/.test(failure) ? "JOB_UNAVAILABLE"
      : failure ? "BLOCKING_DIALOG" : document.readyState === "loading" || (pageType === "JOB_DETAIL" && signals.hasNormalContent === false)
        ? "LOADING" : pageType === "UNKNOWN" ? "ERROR" : "NONE";
    return { version, pageType, blocker, jobKey: match?.[1] || "", observedAt: new Date().toISOString() };
  }
  function evaluateEvidence(document, state, actionStarted = true) {
    const confirmed = state.blocker === "NONE" && Boolean(detectStatus(document));
    return { outcome: confirmed ? "CONFIRMED" : "UNKNOWN", evidence: confirmed ? "PLATFORM_STATUS_TEXT" : "NO_CONFIRMATION",
      effect: confirmed ? actionStarted ? "APPLICATION_CONFIRMED" : "ALREADY_APPLIED" : "UNCONFIRMED",
      newApplication: confirmed && actionStarted, page: state };
  }
  root.GetJobsZhilianPageEvidence = Object.freeze({ version, detectStatus, detectFailure, observe, evaluateEvidence });
})(typeof window === "undefined" ? globalThis : window);
