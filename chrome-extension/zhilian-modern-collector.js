(function (root) {
  const VERSION = "2026-09-07-modern-collection";
  const text = (node) => String(node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  const field = (node, selector) => text(node?.querySelector(selector));
  const idFromUrl = (url) => String(url || "").match(/\/jobdetail\/([^/?#.]+)\.htm/i)?.[1] || "";

  function readCard(card) {
    const titleNode = card.querySelector(".job-card__title-clamp [aria-label]");
    const tags = field(card, ".job-card__skill-tags");
    return {
      title: titleNode?.getAttribute("aria-label") || field(card, ".job-card__title-clamp"),
      company: field(card, ".job-card__company-name"),
      salary: field(card, ".job-card__salary"),
      location: field(card, ".job-card__location"),
      experience: tags.match(/经验不限|不限经验|在校\/应届|应届|[0-9]+-[0-9]+年|[0-9]+年以内|[0-9]+年以上/)?.[0] || "",
      degree: tags.match(/学历不限|本科|大专|硕士|博士|高中|中专/)?.[0] || ""
    };
  }

  function readDetail(document, card, expectedId = "") {
    const panel = document.querySelector(".job-split-layout__right");
    if (!panel || !card?.classList.contains("job-card--active")) return null;
    const item = readCard(card);
    const title = field(panel, ".job-detail-summary__title-text");
    const url = root.GetJobsZhilianScanSupport.normalizeJobUrl(panel.querySelector('a[href*="/jobdetail/"]')?.getAttribute("href"));
    const id = idFromUrl(url);
    const description = field(panel, ".job-description__content");
    if (!id || (expectedId && id !== expectedId) || title !== item.title || description.length < 30 || !item.company) return null;
    const tags = Array.from(panel.querySelectorAll(".job-detail-summary__tag")).map(text);
    return {
      ...item, id, url, title, description,
      salary: field(panel, ".job-detail-summary__salary") || item.salary,
      location: tags[0] || item.location,
      experience: tags.find(t => /经验|应届|\d.*年/.test(t) && !/发布/.test(t)) || item.experience,
      degree: tags.find(t => /学历|本科|大专|硕士|博士|高中|中专/.test(t)) || item.degree,
      source: "zhilian-split-panel",
      detailVerified: true
    };
  }

  async function selectAndRead(document, card, { expectedId = "", sleep, shouldStop }) {
    if (!expectedId) {
      const summary = readCard(card);
      const indistinguishable = Array.from(document.querySelectorAll(".job-list-panel .job-card"))
        .filter(candidate => JSON.stringify(readCard(candidate)) === JSON.stringify(summary));
      // There is no DOM identity to distinguish identical cards. Do not guess
      // which backend job a cached panel belongs to; report and skip instead.
      if (indistinguishable.length > 1) return null;
    }
    const previousUrl = document.querySelector('.job-split-layout__right a[href*="/jobdetail/"]')?.getAttribute("href") || "";
    const wasActive = card.classList.contains("job-card--active");
    // Select only the title area; company, chat and application controls are never clicked.
    card.querySelector(".job-card__title-clamp")?.click();
    let lastSignature = "";
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await shouldStop()) return null;
      await sleep(500);
      const job = readDetail(document, card, expectedId);
      if (!job || (!wasActive && idFromUrl(previousUrl) === job.id)) {
        lastSignature = "";
        continue;
      }
      const signature = `${job.id}\n${job.description}\n${job.salary}\n${job.location}`;
      if (signature === lastSignature) return job;
      lastSignature = signature;
    }
    return null;
  }

  root.GetJobsZhilianModernCollector = Object.freeze({ version: VERSION, readCard, readDetail, selectAndRead });
})(typeof window === "undefined" ? globalThis : window);
