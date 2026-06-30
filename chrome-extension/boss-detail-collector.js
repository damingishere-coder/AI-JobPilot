(function () {
  if (window.GetJobsBossDetailCollector) return;

  function collectCurrentDetail(baseJob = {}) {
    const selectors = window.GetJobsBossSelectors?.DETAIL_FIELD_SELECTORS || {};
    const bodyText = compact(document.body?.innerText || document.body?.textContent || "");
    const description = firstNonEmpty(
      uniqueText(selectors.description),
      extractBodySection(bodyText, /(?:岗位职责|职位描述|工作内容|任职要求|岗位要求|任职资格|职位要求|工作职责|岗位描述|工作描述)/)
    );
    const companyInfo = firstNonEmpty(
      uniqueText(selectors.companyInfo),
      extractBodySection(bodyText, /(?:公司介绍|公司简介|企业介绍|关于我们|公司信息)/)
    );
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
      description: firstNonEmpty(description, baseJob.description, bodyText.slice(0, 2000)),
      companyInfo: firstNonEmpty(companyInfo, baseJob.companyInfo),
      companyAddress: firstNonEmpty(textOf(selectors.address), baseJob.companyAddress),
      currentUrl: window.location.href
    };

    return {
      ...fields,
      missingFields: ["title", "company", "description"].filter((field) => !compact(fields[field]))
    };
  }

  /**
   * 从页面文本中按关键词定位提取段落内容
   * 搜索关键词标志（如"岗位职责"），提取其后的文本直到下一个分节标题
   */
  function extractBodySection(bodyText, sectionPattern) {
    if (!bodyText) return "";
    const match = bodyText.match(sectionPattern);
    if (!match) return "";
    const startIndex = match.index;
    const afterSection = bodyText.slice(startIndex);
    // 截取到下一个分节标题（如"公司信息"、"HR"等）或最多2000字符
    const endMatch = afterSection.slice(match[0].length).match(/\n(?:公司|岗位|HR|工作|联系|地址|福利|薪资|[A-Z])[^\n]{0,20}\n/);
    const endIndex = endMatch ? endMatch.index + match[0].length : Math.min(afterSection.length, 2000);
    return compact(afterSection.slice(0, endIndex));
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
