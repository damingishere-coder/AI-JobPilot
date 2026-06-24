(function () {
  if (window.GetJobsBossDebug) return;

  function collect() {
    const selectors = window.GetJobsBossSelectors || {};
    const bodyText = rawBodyText();
    const compactBodyText = compact(bodyText);
    const currentUrl = window.location.href;
    const selectorCounts = countSelectors(selectors.JOB_CARD_SELECTORS || []);
    const searchResultSelectorCounts = countSelectors(selectors.SEARCH_RESULT_SELECTORS || []);
    const detailLinkSelector = selectors.DETAIL_LINK_SELECTOR || "a[href*='/job_detail/'], a[href*='job_detail']";
    const detailLinkCount = document.querySelectorAll(detailLinkSelector).length;
    const firstCard = findFirstCard(selectors, detailLinkSelector);
    const isLoginPage = detectLoginPage(currentUrl, compactBodyText);
    const isSecurityPage = detectSecurityPage(compactBodyText);

    return {
      currentUrl,
      title: document.title || "",
      isLoginPage,
      isSecurityPage,
      detailLinkCount,
      selectorCounts,
      searchResultSelectorCounts,
      firstCardText: compact(firstCard?.innerText || firstCard?.textContent || "").slice(0, 500),
      bodyText: bodyText.slice(0, 1000),
      pageState: isSecurityPage
        ? "SECURITY_VERIFICATION"
        : isLoginPage
          ? "LOGIN_REQUIRED"
          : detailLinkCount > 0 || Object.values(selectorCounts).some((count) => count > 0)
            ? "SEARCH_RESULTS_FOUND"
            : "UNKNOWN_OR_EMPTY"
    };
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
    return /安全验证|滑块|访问异常|身份验证|请完成验证|验证码|verify|captcha/i.test(text || "");
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
