(function (root) {
  const version = "boss-page-evidence/1";
  const compact = value => String(value || "").replace(/\s+/g, " ").trim();
  const normalizeGreetingText = value => String(value || "").replace(/\r\n?/g, "\n").trim();
  function visibleElement(node, styleReader) {
    if (!node?.getBoundingClientRect) return false;
    const rect = node.getBoundingClientRect(), style = styleReader?.(node);
    return rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden" && style?.opacity !== "0";
  }
  function observe({ document, href, support = {}, styleReader, visible = node => visibleElement(node, styleReader) }) {
    let url;
    try { url = new URL(href); } catch { return { version, platform: "boss", pageType: "UNKNOWN", blocker: "ERROR", jobKey: "", platformState: "", observedAt: new Date().toISOString() }; }
    const onBoss = url.protocol === "https:" && /(^|\.)zhipin\.com$/i.test(url.hostname);
    const jobKey = onBoss ? url.pathname.match(/^\/job_detail\/([^/.]+)(?:\.html)?$/)?.[1] || "" : "";
    const pageType = !onBoss ? "UNKNOWN" : jobKey ? "JOB_DETAIL" : /\/chat(?:\/|$)/.test(url.pathname) ? "CHAT" : /\/web\/geek\/(?:job|jobs)(?:\/|$)/.test(url.pathname) ? "SEARCH" : "UNKNOWN";
    const dialogs = Array.from(document.querySelectorAll("[role='dialog'], [aria-modal='true'], [class*='dialog' i], [class*='modal' i]")).filter(visible);
    const text = compact(document.body?.innerText || document.body?.textContent || "");
    const dialogTexts = dialogs.map(n => compact(n.innerText || n.textContent));
    const hasChallengeUi = Array.from(document.querySelectorAll("iframe[src*='captcha' i],iframe[src*='verify' i],[class*='geetest' i],[id*='geetest' i],[class*='captcha' i],[id*='captcha' i],[class*='verify-slider' i],[id*='verify-slider' i],[class*='security-check' i],[id*='security-check' i]")).some(visible)
      || dialogTexts.some(t => support.isBossSecurityInstructionText?.(t));
    const hasNormalContent = pageType === "JOB_DETAIL" ? Boolean(document.querySelector(".job-banner,.job-detail,.job-detail-box,.job-detail-container,[class*='job-detail']")) : pageType === "SEARCH" && Boolean(document.querySelector("a[href*='job_detail']"));
    const security = hasChallengeUi || /\/(?:verify|captcha)(?:[/.]|$)/i.test(url.pathname)
      || support.isBossSecurityPage?.({ url: href, title: document.title, text, hasNormalContent, hasChallengeUi });
    const login = /passport|login|user\/login|扫码登录|二维码登录/.test(url.pathname)
      || dialogTexts.some(t => /请先登录|请登录后|登录后查看|扫码登录|二维码登录|请扫码|未登录/.test(t))
      || (!hasNormalContent && /请登录后|登录后查看|扫码登录|二维码登录|请扫码|未登录/.test(text));
    const reminders = dialogs.map(n => ({ title: compact(n.querySelector('.dialog-title h3')?.textContent), content: compact(n.querySelector('.dialog-con')?.textContent) }))
      .filter(d => d.title === "温馨提示").map(d => d.content.match(/^您今天已与\d+位BOSS沟通[，,]\s*还剩(\d+)次沟通机会哦[！!。]?$/)).filter(Boolean);
    const quota = reminders.some(m => Number(m[1]) === 0) || dialogTexts.some(t => /今日沟通.*?已用完|沟通次数.*?已用完|沟通上限|已达上限/.test(t));
    const unavailable = dialogTexts.some(t => /职位已关闭|停止招聘|职位不存在|该职位.*?不存在|暂不接受沟通/.test(t))
      || Array.from(document.querySelectorAll('.job-status')).filter(visible).some(n => /已关闭|停止招聘|不存在/.test(n.textContent || ""));
    const reminder = reminders.some(m => Number(m[1]) > 0);
    const blocker = !onBoss ? "ERROR" : security ? "VERIFICATION_REQUIRED" : login ? "LOGIN_REQUIRED" : quota ? "QUOTA_LIMIT" : unavailable ? "JOB_UNAVAILABLE" : dialogs.length && !reminder ? "BLOCKING_DIALOG" : document.readyState === "loading" ? "LOADING" : "NONE";
    return { version, platform: "boss", pageType, blocker, jobKey, platformState: reminder && !quota ? "QUOTA_REMINDER" : "", observedAt: new Date().toISOString() };
  }
  function evaluateEvidence({ beforeCount = 0, afterCount = 0, alreadyContacted = false, actionStarted = true, state } = {}) {
    const blocked = state && state.blocker !== "NONE";
    const existing = !blocked && alreadyContacted && !actionStarted;
    const sent = !blocked && Number.isInteger(beforeCount) && beforeCount >= 0 && Number.isInteger(afterCount) && afterCount > beforeCount;
    return { version, platform: "boss", outcome: existing || sent ? "CONFIRMED" : "UNKNOWN",
      kind: existing ? "EXISTING_CONVERSATION" : sent ? "GREETING_RENDERED_EXACT" : "NO_CONFIRMATION",
      effect: existing ? "ALREADY_CONTACTED" : sent ? "GREETING_SENT" : "UNCONFIRMED", newApplication: sent && !existing };
  }
  function detectDeliveryStatus(document, node = document) {
    const text = compact([
      ...Array.from(node.querySelectorAll?.("button, a, [role='button']") || [])
        .filter(el => el.offsetParent !== null)
        .map(el => [el.innerText, el.textContent, el.getAttribute?.("aria-label"), el.getAttribute?.("title")].filter(Boolean).join(" ")),
      node === document ? "" : node.innerText
    ].filter(Boolean).join(" "));
    return /(继续沟通|已沟通|已投递|已申请)/.test(text) ? "已投递" : "";
  }
  function countRenderedGreetingMessages(document, greeting) {
    const popupSelector = ".startchat-content .message > .message-list > .message-item";
    const rows = Array.from(document.querySelectorAll(`${popupSelector}, .item-myself, .message-self, [data-direction='outbound']`));
    if (rows.length) return rows.filter(row => {
      if (row.offsetParent === null || row.querySelector(".send-failed, .message-failed, .sending, .status.error")) return false;
      if (row.matches(popupSelector) && (!row.id || !row.querySelector(":scope > .status.success"))) return false;
      const body = row.querySelector(".text-content, .text, .message-content") || row;
      const copy = body.cloneNode(true);
      copy.querySelectorAll(".message-status, .item-time, .quote-message, .status").forEach(n => n.remove());
      copy.querySelectorAll("br").forEach(n => n.replaceWith("\n"));
      return normalizeGreetingText(copy.textContent || "") === greeting;
    }).length;
    return 0;
  }
  root.GetJobsBossPageEvidence = Object.freeze({ version, observe, evaluateEvidence, countRenderedGreetingMessages, detectDeliveryStatus });
})(typeof window !== "undefined" ? window : globalThis);
