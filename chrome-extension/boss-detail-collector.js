(function () {
  if (window.GetJobsBossDetailCollector) return;

  function collectCurrentDetail(baseJob = {}) {
    const selectors = window.GetJobsBossSelectors?.DETAIL_FIELD_SELECTORS || {};
    const bodyText = compact(document.body?.innerText || document.body?.textContent || "");
    const description = uniqueText(selectors.description);
    const companyInfo = uniqueText(selectors.companyInfo);
    const tagsText = compact([
      textOf([".job-banner", ".job-primary", ".job-detail-header", "[class*='job-banner']"]),
      bodyText
    ].join(" "));

    const fields = {
      title: firstNonEmpty(textOf(selectors.title), baseJob.title),
      company: firstNonEmpty(textOf(selectors.company), baseJob.company),
      salary: firstNonEmpty(textOf(selectors.salary), firstMatch(tagsText, /(?:\d+(?:\.\d+)?-\d+(?:\.\d+)?[Kk](?:·\d+薪)?|\d+(?:\.\d+)?[Kk]以上|面议)/), baseJob.salary),
      location: firstNonEmpty(baseJob.location, firstMatch(tagsText, /(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|长沙|重庆|天津|郑州|厦门|合肥|佛山|东莞|珠海|中山|全国|远程)(?:·[^\s，,。]{1,12})?/)),
      experience: firstNonEmpty(baseJob.experience, firstMatch(tagsText, /(经验不限|不限经验|在校\/应届|应届|1年以内|[0-9]+-[0-9]+年|[0-9]+年以内|[0-9]+年以上)/)),
      degree: firstNonEmpty(baseJob.degree, firstMatch(tagsText, /(学历不限|本科|大专|硕士|博士|高中|中专)/)),
      hrName: firstNonEmpty(textOf(selectors.hrName), baseJob.hrName),
      hrTitle: firstNonEmpty(textOf(selectors.hrTitle), baseJob.hrTitle),
      hrActive: firstNonEmpty(textOf(selectors.hrActive), baseJob.hrActive),
      description: firstNonEmpty(description, baseJob.description),
      companyInfo: firstNonEmpty(companyInfo, baseJob.companyInfo),
      companyAddress: firstNonEmpty(textOf(selectors.address), baseJob.companyAddress),
      currentUrl: window.location.href
    };

    return {
      ...fields,
      missingFields: ["title", "company", "description"].filter((field) => !compact(fields[field]))
    };
  }

  function textOf(selectorList) {
    for (const selector of selectorList || []) {
      const node = document.querySelector(selector);
      const text = compact(node?.innerText || node?.textContent || "");
      if (text) return text;
    }
    return "";
  }

  function uniqueText(selectorList) {
    const parts = [];
    for (const selector of selectorList || []) {
      const text = compact(document.querySelector(selector)?.innerText || document.querySelector(selector)?.textContent || "");
      if (text && !parts.includes(text)) parts.push(text);
    }
    return compact(parts.join("\n"));
  }

  function firstMatch(text, pattern) {
    return compact(String(text || "").match(pattern)?.[0] || "");
  }

  function firstNonEmpty(...values) {
    return values.map(compact).find(Boolean) || "";
  }

  function compact(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  window.GetJobsBossDetailCollector = Object.freeze({
    collectCurrentDetail
  });
})();
