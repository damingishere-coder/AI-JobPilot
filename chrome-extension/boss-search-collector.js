(function () {
  if (window.GetJobsBossSearchCollector) return;

  const SALARY_PATTERN = /(?:\d+(?:\.\d+)?-\d+(?:\.\d+)?[Kk](?:·\d+薪)?|\d+(?:\.\d+)?[Kk]以上|面议)/;
  const EXPERIENCE_PATTERN = /(经验不限|不限经验|在校\/应届|应届|1年以内|[0-9]+-[0-9]+年|[0-9]+年以内|[0-9]+年以上)/;
  const DEGREE_PATTERN = /(学历不限|本科|大专|硕士|博士|高中|中专)/;
  const LOCATION_PATTERN = /(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|长沙|重庆|天津|郑州|厦门|合肥|佛山|东莞|珠海|中山|青岛|济南|福州|昆明|南昌|宁波|无锡|全国|远程)(?:·[^\s，,。]{1,12})?/;

  function collectVisibleJobs(options = {}) {
    const selectors = window.GetJobsBossSelectors || {};
    const keyword = resolveKeyword(options.keyword);
    const candidates = collectCandidateRoots(selectors);
    const jobs = [];
    const failures = [];
    const seen = new Set();
    const missingFieldCounts = {
      title: 0,
      company: 0,
      salary: 0,
      location: 0,
      url: 0,
      keyword: 0
    };

    candidates.forEach((root, index) => {
      try {
        const job = parseCard(root, keyword, selectors);
        const missingFields = requiredMissingFields(job);
        missingFields.forEach((field) => {
          missingFieldCounts[field] = (missingFieldCounts[field] || 0) + 1;
        });

        if (!isCollectableBossJob(job)) {
          failures.push({
            index: index + 1,
            reason: `缺少必要字段：${missingFields.join("、") || "岗位信息"}`,
            missingFields,
            text: compact(root?.innerText || root?.textContent || "").slice(0, 240)
          });
          return;
        }

        const key = job.id ? `id:${job.id}` : job.url ? `url:${job.url}` : `ct:${job.company}:${job.title}`;
        if (seen.has(key)) return;
        seen.add(key);
        jobs.push(job);

        if (missingFields.length) {
          failures.push({
            index: index + 1,
            reason: `已入库，但缺少字段：${missingFields.join("、")}`,
            missingFields,
            title: job.title,
            company: job.company
          });
        }
      } catch (error) {
        failures.push({
          index: index + 1,
          reason: error?.message || String(error),
          missingFields: [],
          text: compact(root?.innerText || root?.textContent || "").slice(0, 240)
        });
      }
    });

    return {
      jobs,
      keyword,
      candidateCount: candidates.length,
      parsedCount: jobs.length,
      skippedCount: Math.max(0, candidates.length - jobs.length),
      missingFieldCounts,
      failures: failures.slice(0, 20)
    };
  }

  function collectCandidateRoots(selectors) {
    const roots = [];
    const detailLinkSelector = selectors.DETAIL_LINK_SELECTOR || "a[href*='/job_detail/'], a[href*='job_detail']";
    Array.from(document.querySelectorAll(detailLinkSelector))
      .map((node) => resolveCardRoot(node, selectors))
      .filter(isRendered)
      .forEach((node) => roots.push(node));

    for (const selector of selectors.JOB_CARD_SELECTORS || []) {
      Array.from(document.querySelectorAll(selector))
        .map((node) => resolveCardRoot(node, selectors))
        .filter(isRendered)
        .forEach((node) => roots.push(node));
    }

    return uniqueNodes(roots).filter(isLikelyJobCard);
  }

  function parseCard(root, keyword, selectors) {
    const text = compact(root?.innerText || root?.textContent || "");
    const lines = cardLines(root);
    const detailLinkSelector = selectors.DETAIL_LINK_SELECTOR || "a[href*='/job_detail/'], a[href*='job_detail']";
    const link = root?.matches?.(detailLinkSelector)
      ? root
      : root?.querySelector?.(detailLinkSelector);
    let url = normalizeBossJobUrl(
      link?.getAttribute?.("href")
        || link?.href
        || attr(root, ["data-url", "data-href", "href"])
        || extractJobUrlFromText(text)
    );
    const id = compact(
      extractBossId(url)
        || attr(root, ["data-jobid", "data-job-id", "data-jid", "data-id", "data-encrypt-id", "data-securityid", "data-security-id"])
    );
    if (!url && id) url = `https://www.zhipin.com/job_detail/${id}.html`;

    const fieldSelectors = selectors.FIELD_SELECTORS || {};
    const salary = firstNonEmpty(textOf(root, fieldSelectors.salary), firstMatch(text, SALARY_PATTERN));
    const title = cleanField(firstNonEmpty(
      textOf(root, fieldSelectors.title),
      attr(link, ["title", "aria-label"]),
      compact(link?.innerText || link?.textContent || ""),
      lines.find((line) => isLikelyTitle(line, salary))
    ), salary);
    const company = cleanField(firstNonEmpty(
      textOf(root, fieldSelectors.company),
      attr(root, ["data-company", "data-company-name", "data-brand-name"]),
      lines.find((line) => isLikelyCompany(line, title, salary))
    ), salary);
    const location = firstNonEmpty(
      textOf(root, fieldSelectors.location),
      firstMatch(lines.join(" "), LOCATION_PATTERN)
    );
    const experience = firstNonEmpty(
      firstMatch(textOf(root, fieldSelectors.experience), EXPERIENCE_PATTERN),
      firstMatch(text, EXPERIENCE_PATTERN)
    );
    const degree = firstNonEmpty(
      firstMatch(textOf(root, fieldSelectors.degree), DEGREE_PATTERN),
      firstMatch(text, DEGREE_PATTERN)
    );

    return {
      id,
      title,
      company,
      salary,
      location,
      experience,
      degree,
      hrName: textOf(root, fieldSelectors.hrName),
      hrTitle: "",
      hrActive: "",
      description: text.slice(0, 2000),
      deliveryStatus: "LIST_COLLECTED",
      url,
      keyword,
      source: "boss-dom-card",
      salarySource: "dom_untrusted"
    };
  }

  function resolveCardRoot(node, selectors) {
    if (!node) return node;
    const cardRootSelector = selectors.CARD_ROOT_SELECTOR || "li.job-card-box, .job-card-wrapper, [class*='job-card'], li";
    const root = node.closest?.(cardRootSelector);
    if (root) return root;
    return node.parentElement || node;
  }

  function isRendered(node) {
    if (!node || node === document.body || node === document.documentElement) return false;
    const style = window.getComputedStyle?.(node);
    if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
    return Boolean(node.offsetParent !== null || node.getClientRects?.().length);
  }

  function isLikelyJobCard(node) {
    const text = compact(node?.innerText || node?.textContent || "");
    if (text.length < 6) return false;
    const selectors = window.GetJobsBossSelectors || {};
    if (node.querySelector?.(selectors.DETAIL_LINK_SELECTOR || "a[href*='job_detail']")) return true;
    if (attr(node, ["data-jobid", "data-job-id", "data-jid", "data-encrypt-id", "data-securityid", "data-security-id"])) return true;
    return Boolean(firstMatch(text, SALARY_PATTERN) || /工程师|开发|运营|产品|经理|设计|测试|销售|顾问|算法|前端|后端|全栈|实习|专员/i.test(text));
  }

  function requiredMissingFields(job) {
    return ["title", "company", "salary", "location", "url", "keyword"].filter((field) => {
      if (field === "url") return !isBossJobDetailUrl(job?.url);
      return !compact(job?.[field]);
    });
  }

  function resolveKeyword(fallback) {
    try {
      const current = new URL(window.location.href);
      const query = current.searchParams.get("query") || current.searchParams.get("keyword") || "";
      if (query) return compact(decodeURIComponent(query.replace(/\+/g, " ")));
    } catch {
      // URL 解析失败时继续使用前端传入的关键词。
    }
    return compact(String(fallback || "").split(/[,，\n]/)[0]) || "当前搜索页";
  }

  function textOf(root, selectorList) {
    for (const selector of selectorList || []) {
      const node = root?.querySelector?.(selector);
      const text = compact(node?.innerText || node?.textContent || "");
      if (text) return text;
    }
    return "";
  }

  function cardLines(root) {
    return String(root?.innerText || root?.textContent || "")
      .split(/\n+/)
      .map(compact)
      .filter(Boolean)
      .filter((line, index, lines) => lines.indexOf(line) === index);
  }

  function isLikelyTitle(line, salary) {
    const value = cleanField(line, salary);
    if (!value || value.length > 80 || isNoisy(value)) return false;
    if (isNonJobNavigationTitle(value)) return false;
    if (isLikelyCompany(value, "", salary)) return false;
    return /工程师|开发|运营|产品|经理|设计|测试|销售|顾问|算法|前端|后端|全栈|Java|Python|Go|C\+\+|Android|iOS|数据|实习|专员|主管|总监/i.test(value)
      || value.length <= 30;
  }

  function isLikelyCompany(line, title, salary) {
    const value = cleanField(line, salary);
    if (!value || value === compact(title) || value.length > 80 || isNoisy(value)) return false;
    return /公司|集团|科技|网络|信息|咨询|有限|股份|软件|智能|数据|传媒|教育|金融|电子|电商|服务|中心|工作室|Inc\.?|Ltd\.?/i.test(value);
  }

  function isNoisy(value) {
    return /经验|学历|本科|大专|硕士|博士|薪|面议|招聘|刚刚|今日|活跃|在线|发布|收藏|感兴趣|立即沟通|继续沟通|已沟通|已投递/.test(value)
      || SALARY_PATTERN.test(value);
  }

  function cleanField(value, salary) {
    return compact(String(value || "")
      .replace(salary || "", "")
      .replace(/立即沟通|继续沟通|感兴趣|收藏/g, ""));
  }

  function normalizeBossJobUrl(value) {
    const support = window.GetJobsBossScanSupport || {};
    if (support.normalizeBossJobUrl) {
      return support.normalizeBossJobUrl(value, window.location.origin);
    }
    const raw = String(value || "").trim();
    if (!raw) return "";
    const match = raw.match(/https?:\/\/[^\s"'<>]*job_detail[^\s"'<>]*/i)
      || raw.match(/\/[^\s"'<>]*job_detail[^\s"'<>]*/i);
    const candidate = match ? match[0] : raw;
    if (!/job_detail/i.test(candidate)) return "";
    try {
      const parsed = new URL(candidate, window.location.origin);
      parsed.hash = "";
      if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("zhipin.com")) return "";
      if (!parsed.pathname.includes("/job_detail/")) return "";
      return parsed.href;
    } catch {
      return "";
    }
  }

  function extractJobUrlFromText(text) {
    const source = String(text || "");
    const match = source.match(/https?:\/\/[^\s"'<>]*job_detail[^\s"'<>]*/i)
      || source.match(/\/[^\s"'<>]*job_detail[^\s"'<>]*/i);
    return match ? match[0] : "";
  }

  function extractBossId(url) {
    const match = String(url || "").match(/\/job_detail\/([^/?#]+?)(?:\.html)?(?:[?#]|$)/i);
    return compact(match?.[1] || "");
  }

  function isCollectableBossJob(job) {
    return Boolean(job?.title && job?.company && isBossJobDetailUrl(job?.url) && !isNonJobNavigationTitle(job?.title));
  }

  function isBossJobDetailUrl(url) {
    const support = window.GetJobsBossScanSupport || {};
    if (support.isBossJobDetailUrl) {
      return support.isBossJobDetailUrl(url, window.location.origin);
    }
    return Boolean(extractBossId(normalizeBossJobUrl(url)));
  }

  function isNonJobNavigationTitle(value) {
    const support = window.GetJobsBossScanSupport || {};
    if (support.isNonJobNavigationTitle) return support.isNonJobNavigationTitle(value);
    return /^(职位搜索|搜索职位|岗位搜索|搜索岗位|职位|岗位|工作搜索|公司搜索|搜索公司|全部职位|全部岗位|返回列表)$/.test(compact(value));
  }

  function attr(node, names) {
    for (const name of names || []) {
      const value = node?.getAttribute?.(name);
      if (value) return compact(value);
    }
    return "";
  }

  function firstMatch(text, pattern) {
    return compact(String(text || "").match(pattern)?.[0] || "");
  }

  function firstNonEmpty(...values) {
    return values.map(compact).find(Boolean) || "";
  }

  function uniqueNodes(nodes) {
    return Array.from(new Set((nodes || []).filter(Boolean)));
  }

  function compact(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  window.GetJobsBossSearchCollector = Object.freeze({
    collectVisibleJobs,
    resolveKeyword
  });
})();
