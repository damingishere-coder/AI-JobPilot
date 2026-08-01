(function () {
  if (window.GetJobsBossDebug) return;

  function collect() {
    const selectors = window.GetJobsBossSelectors || {};
    const bodyText = rawBodyText();
    const compactBodyText = compact(bodyText);
    const currentUrl = window.location.href;
    const selectorCounts = countSelectors(selectors.JOB_CARD_SELECTORS || []);
    const fieldSelectorCounts = countSelectorsByGroup(selectors.FIELD_SELECTORS || {});
    const detailLinkSelector = selectors.DETAIL_LINK_SELECTOR || "a[href*='/job_detail/'], a[href*='job_detail']";
    const detailLinkCount = document.querySelectorAll(detailLinkSelector).length;
    const firstCard = findFirstCard(selectors, detailLinkSelector);
    const isLoginPage = detectLoginPage(currentUrl, compactBodyText);
    const isSecurityPage = detectSecurityPage(compactBodyText);

    // 新增：扫描页面的script标签内容摘要
    const scriptSummaries = [];
    Array.from(document.querySelectorAll("script[type='application/json'], script#__NEXT_DATA__, script")).forEach((script) => {
      const raw = String(script.textContent || "").trim();
      if (!raw) return;
      const snippet = raw.slice(0, 200).replace(/\s+/g, " ");
      if (/encryptJobId|encryptId|jobId|securityId|brandName|companyName|jobList|jobInfo|zpData|salaryDesc/i.test(snippet)) {
        scriptSummaries.push({
          id: script.id || "(no-id)",
          type: script.type || "text/javascript",
          length: raw.length,
          snippet
        });
      }
    });

    return {
      currentUrl,
      title: document.title || "",
      isLoginPage,
      isSecurityPage,
      detailLinkCount,
      selectorCounts,
      fieldSelectorCounts,
      searchResultSelectorCounts: countSelectors(selectors.SEARCH_RESULT_SELECTORS || []),
      firstCardText: compact(firstCard?.innerText || firstCard?.textContent || "").slice(0, 500),
      isSearchPage: isBossSearchPage(currentUrl),
      pageState: isSecurityPage
        ? "SECURITY_VERIFICATION"
        : isLoginPage
          ? "LOGIN_REQUIRED"
          : detailLinkCount > 0 || Object.values(selectorCounts).some((count) => count > 0)
            ? "SEARCH_RESULTS_FOUND"
            : "UNKNOWN_OR_EMPTY",
      scriptSummaries,
      scriptCount: scriptSummaries.length,
      bodyTextLength: compactBodyText.length
    };
  }

  function countSelectorsByGroup(fieldSelectors) {
    const result = {};
    Object.entries(fieldSelectors || {}).forEach(([group, list]) => {
      result[group] = countSelectors(list);
    });
    return result;
  }

  function isBossSearchPage(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.includes("zhipin.com")
        && (parsed.pathname === "/web/geek/job" || parsed.pathname === "/web/geek/jobs");
    } catch {
      return false;
    }
  }

  function countSelectors(list) {
    return Array.from(list || []).reduce((counts, selector) => {
      try {
        counts[selector] = document.querySelectorAll(selector).length;
      } catch {
        counts[selector] = -1;
      }
      return counts;
    }, {});
  }

  function findFirstCard(selectors, detailLinkSelector) {
    const detailLink = document.querySelector(detailLinkSelector);
    if (detailLink) {
      return detailLink.closest?.(selectors.CARD_ROOT_SELECTOR || "li, [class*='job-card']") || detailLink;
    }
    for (const selector of selectors.JOB_CARD_SELECTORS || []) {
      const node = document.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function detectSecurityPage(text) {
    const support = window.GetJobsBossScanSupport || {};
    const hasNormalContent = hasNormalBossPageContent();
    const hasChallengeUi = hasVisibleBossSecurityUi(support);
    if (typeof support.isBossSecurityPage === "function") {
      return support.isBossSecurityPage({
        url: window.location.href,
        title: document.title || "",
        text,
        hasNormalContent,
        hasChallengeUi
      });
    }
    return hasChallengeUi || (!hasNormalContent && /请.{0,12}(?:完成|进行|通过).{0,8}验证|请.{0,8}(?:拖动|按住).{0,8}滑块|访问异常/.test(text || ""));
  }

  function hasNormalBossPageContent() {
    const path = String(window.location.pathname || "");
    if (/\/job_detail\//.test(path)) {
      return Boolean(document.querySelector(".job-banner, .job-detail, .job-detail-box, .job-detail-container, [class*='job-detail']"));
    }
    if (path === "/web/geek/job" || path === "/web/geek/jobs") {
      return document.querySelectorAll("a[href*='/job_detail/'], a[href*='job_detail']").length > 0;
    }
    return false;
  }

  function hasVisibleBossSecurityUi(support) {
    const selectors = [
      "iframe[src*='captcha' i]",
      "iframe[src*='verify' i]",
      "[class*='geetest' i]",
      "[id*='geetest' i]",
      "[class*='captcha' i]",
      "[id*='captcha' i]",
      "[class*='verify-slider' i]",
      "[id*='verify-slider' i]",
      "[class*='security-check' i]",
      "[id*='security-check' i]"
    ];
    if (selectors.some((selector) => Array.from(document.querySelectorAll(selector)).some(isVisibleElement))) return true;
    if (typeof support.isBossSecurityInstructionText !== "function") return false;
    const overlays = document.querySelectorAll("[role='dialog'], [aria-modal='true'], [class*='dialog' i], [class*='modal' i]");
    return Array.from(overlays).some((node) => isVisibleElement(node) && support.isBossSecurityInstructionText(node.innerText || node.textContent || ""));
  }

  function isVisibleElement(node) {
    if (!node || typeof node.getBoundingClientRect !== "function") return false;
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle?.(node);
    return rect.width > 0
      && rect.height > 0
      && style?.display !== "none"
      && style?.visibility !== "hidden"
      && style?.opacity !== "0";
  }

  function detectLoginPage(url, text) {
    if (/passport|login|user\/login|扫码登录|二维码登录/i.test(String(url || ""))) return true;
    return /请登录后|登录后查看|扫码登录|二维码登录|请扫码|未登录/.test(text || "");
  }

  function rawBodyText() {
    return String(document.body?.innerText || document.body?.textContent || "").trim();
  }

  function compact(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  window.GetJobsBossDebug = Object.freeze({
    collect,
    detectLoginPage,
    detectSecurityPage
  });
})();
