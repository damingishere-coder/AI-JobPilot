(function (root) {
  const VERSION = "2026-09-10-continuous-scan";
  const text = (node) => String(node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  const field = (node, selector) => text(node?.querySelector(selector));
  const idFromUrl = (url) => String(url || "").match(/\/jobdetail\/([^/?#.]+)\.htm/i)?.[1] || "";

  function readCard(card) {
    const titleNode = card?.querySelector(".job-card__title-clamp [aria-label]");
    const tags = field(card, ".job-card__skill-tags");
    const href = card?.querySelector("a[href*='jobdetail']")?.getAttribute("href") || "";
    const id = card?.getAttribute("data-job-id") || card?.getAttribute("data-position-id") || idFromUrl(href);
    return {
      id, url: href,
      title: String(titleNode?.getAttribute("aria-label") || field(card, ".job-card__title-clamp")).replace(/\s+/g, " ").trim(),
      company: field(card, ".job-card__company-name"),
      salary: field(card, ".job-card__salary"),
      location: field(card, ".job-card__location"),
      experience: tags.match(/经验不限|不限经验|在校\/应届|应届|[0-9]+-[0-9]+年|[0-9]+年以内|[0-9]+年以上/)?.[0] || "",
      degree: tags.match(/学历不限|本科|大专|硕士|博士|高中|中专/)?.[0] || ""
    };
  }

  const failure = (reason, summary = {}, extra = {}) => ({ job: null, reason, summary, ...extra });
  const retryable = new Set(["CARD_NOT_READY", "CARD_DETACHED", "DETAIL_TIMEOUT", "DETAIL_NOT_SWITCHED"]);
  const failureLabels = Object.freeze({
    CARD_NOT_READY: "岗位标题或公司尚未渲染", CARD_DETACHED: "岗位卡片已被页面替换",
    AMBIGUOUS_IDENTITY: "同名卡片无法唯一确认身份", DETAIL_TIMEOUT: "详情加载超时",
    DETAIL_NOT_SWITCHED: "详情仍停留在上一岗位", IDENTITY_MISMATCH: "详情身份与目标岗位不符",
    BODY_INCOMPLETE: "岗位正文不足", KEYWORD_TIMEOUT: "关键词采集时间已用尽", STOPPED: "扫描已停止"
  });

  // Reacquire only by independently observed card fields, never by its old index.
  function locateCard(document, card, summary) {
    if (card?.isConnected) return card;
    const fields = ["title", "company", "salary", "location"].filter(key => summary[key]);
    if (!summary.title || !summary.company || fields.length < 2) return null;
    const matches = Array.from(document.querySelectorAll(".job-list-panel .job-card"))
      .filter(candidate => { const item = readCard(candidate); return fields.every(key => item[key] === summary[key]); });
    return matches.length === 1 ? matches[0] : null;
  }

  async function prepareCard(document, card, { sleep, shouldStop, deadline = Infinity, summary = readCard(card) }) {
    for (let poll = 0; poll < 10; poll++) {
      if (await shouldStop()) return failure("STOPPED", summary);
      if (Date.now() >= deadline) return failure("KEYWORD_TIMEOUT", summary);
      card = locateCard(document, card, summary);
      if (!card) return failure("CARD_DETACHED", summary);
      card.scrollIntoView?.({ block: "center" });
      const current = readCard(card);
      if (["title", "company", "salary", "location"].some(key => summary[key] && current[key] && summary[key] !== current[key])) {
        return failure("IDENTITY_MISMATCH", summary);
      }
      summary = { ...summary, ...Object.fromEntries(Object.entries(current).filter(([, value]) => value)) };
      if (current.title && current.company) return { card, summary: current };
      await sleep(Math.min(500, Math.max(0, deadline - Date.now())));
    }
    return failure("CARD_NOT_READY", summary);
  }

  function inspectDetail(document, card, expectedId = "") {
    if (!card?.isConnected) return failure("CARD_DETACHED");
    const panel = document.querySelector(".job-split-layout__right");
    const item = readCard(card);
    if (!item.title || !item.company) return failure("CARD_NOT_READY", item);
    if (!panel || !card.classList.contains("job-card--active")) return failure("DETAIL_TIMEOUT", item);
    const title = field(panel, ".job-detail-summary__title-text");
    const url = root.GetJobsZhilianScanSupport.normalizeJobUrl(panel.querySelector('a[href*="/jobdetail/"]')?.getAttribute("href"));
    const id = idFromUrl(url);
    const description = field(panel, ".job-description__content");
    if (!id || !title) return failure("DETAIL_TIMEOUT", item);
    if ((expectedId && id !== expectedId) || title !== item.title) return failure("IDENTITY_MISMATCH", item, { actualId: id });
    if (description.length < 30) return failure("BODY_INCOMPLETE", item, { actualId: id });
    const tags = Array.from(panel.querySelectorAll(".job-detail-summary__tag")).map(text);
    return { job: {
      ...item, id, url, title, description,
      salary: field(panel, ".job-detail-summary__salary") || item.salary,
      location: tags[0] || item.location,
      experience: tags.find(t => /经验|应届|\d.*年/.test(t) && !/发布/.test(t)) || item.experience,
      degree: tags.find(t => /学历|本科|大专|硕士|博士|高中|中专/.test(t)) || item.degree,
      source: "zhilian-split-panel",
      detailVerified: true
    }, summary: item, reason: "" };
  }

  function readDetail(document, card, expectedId = "") {
    return inspectDetail(document, card, expectedId).job;
  }

  async function selectOnce(document, card, { expectedId = "", sleep, shouldStop, deadline = Infinity, summary, transition, preparedCard }) {
    const prepared = preparedCard || await prepareCard(document, card, { sleep, shouldStop, deadline, summary });
    if (!prepared.card) return prepared;
    card = prepared.card;
    if (!expectedId) {
      const summary = readCard(card);
      const indistinguishable = Array.from(document.querySelectorAll(".job-list-panel .job-card"))
        .filter(candidate => JSON.stringify(readCard(candidate)) === JSON.stringify(summary));
      // There is no DOM identity to distinguish identical cards. Do not guess
      // which backend job a cached panel belongs to; report and skip instead.
      if (indistinguishable.length > 1) return failure("AMBIGUOUS_IDENTITY", summary);
    }
    if (!transition.initialized) {
      transition.previousUrl = document.querySelector('.job-split-layout__right a[href*="/jobdetail/"]')?.getAttribute("href") || "";
      transition.wasActive = card.classList.contains("job-card--active");
      transition.initialized = true;
    }
    if (await shouldStop()) return failure("STOPPED", prepared.summary);
    if (Date.now() >= deadline) return failure("KEYWORD_TIMEOUT", prepared.summary);
    if (!card.isConnected) return failure("CARD_DETACHED", prepared.summary);
    if (["title", "company", "salary", "location"].some(key => prepared.summary[key] && readCard(card)[key] !== prepared.summary[key])) return failure("IDENTITY_MISMATCH", prepared.summary);
    // Select only the title area; company, chat and application controls are never clicked.
    card.querySelector(".job-card__title-clamp")?.click();
    let lastSignature = "";
    let result = failure("DETAIL_TIMEOUT", prepared.summary);
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await shouldStop()) return failure("STOPPED", prepared.summary);
      if (Date.now() >= deadline) return failure("KEYWORD_TIMEOUT", prepared.summary);
      await sleep(Math.min(500, deadline - Date.now()));
      if (await shouldStop()) return failure("STOPPED", prepared.summary);
      if (Date.now() >= deadline) return failure("KEYWORD_TIMEOUT", prepared.summary);
      result = inspectDetail(document, card, expectedId);
      if (result.reason === "CARD_DETACHED" || result.reason === "CARD_NOT_READY") return { ...result, summary: prepared.summary };
      const job = result.job;
      if (job && ["title", "company", "salary", "location"].some(key => prepared.summary[key] && readCard(card)[key] !== prepared.summary[key])) return failure("IDENTITY_MISMATCH", prepared.summary);
      if (!transition.wasActive && idFromUrl(transition.previousUrl) === (job?.id || result.actualId)) result = failure("DETAIL_NOT_SWITCHED", prepared.summary);
      if (!result.job) {
        lastSignature = "";
        continue;
      }
      const signature = `${job.id}\n${job.description}\n${job.salary}\n${job.location}`;
      if (signature === lastSignature) return result;
      lastSignature = signature;
    }
    return result.job ? failure("DETAIL_TIMEOUT", prepared.summary) : result;
  }

  async function selectAndReadResult(document, card, hooks) {
    let summary = hooks.preparedCard?.summary || readCard(card);
    const transition = {};
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await selectOnce(document, card, { ...hooks, summary, transition, preparedCard: attempt === 0 ? hooks.preparedCard : null });
      summary = result.summary || summary;
      if (result.job || !retryable.has(result.reason) || attempt === 1) return { ...result, retries: attempt };
    }
  }

  async function selectAndRead(document, card, hooks) {
    return (await selectAndReadResult(document, card, hooks)).job;
  }

  root.GetJobsZhilianModernCollector = Object.freeze({ version: VERSION, readCard, readDetail, prepareCard,
    selectAndRead, selectAndReadResult, failureLabels });
})(typeof window === "undefined" ? globalThis : window);
