(function (root) {
  const VERSION = "structural-fixture/1";
  const REDACTION_VERSION = "structural-fixture/2";
  const errors = Object.freeze({
    UNSUPPORTED_PAGE: "当前页面不是受支持的 BOSS / 智联 HTTPS 招聘页。",
    CHAT_PAGE: "聊天页面不支持导出，请切换到岗位搜索列表或详情。",
    INVALID_TYPE: "样本类型不支持，请重新选择。",
    NO_STRUCTURE: "未找到该类型的白名单结构。请确认岗位已加载；页面结构可能尚未适配，不会改为保存整页。",
    TOO_LARGE: "页面结构过大，已停止导出。请减少加载的岗位后重试，不会输出截断样本。",
    NO_ACTIVE_TAB: "未找到当前标签页，请保持招聘页面在前台。",
    PAGE_CHANGED: "页面已变化或未返回有效样本，请在页面稳定后重新生成。",
    CAPTURE_FAILED: "无法读取页面，请刷新招聘标签页并重新加载扩展后再试。"
  });
  const warningMessages = Object.freeze({
    MISSING_JOB_CARDS: "缺少可识别的岗位卡片结构",
    MISSING_TITLE: "缺少岗位标题",
    MISSING_COMPANY: "缺少公司名称",
    MISSING_DESCRIPTION: "缺少职位描述（JD）",
    MISSING_JOB_IDENTITY: "缺少岗位 ID 或详情链接，不能验证岗位关联"
  });
  function fail(code) { const error = new Error(errors[code]); error.code = code; throw error; }
  const roots = Object.freeze({
    boss: {
      // Bounded patterns already supported by boss-selectors.js. Never use body/main or generic content roots.
      SEARCH: ".job-list-box, .search-job-result, .pagination, .job-card-wrapper, .job-card-body, li.job-card-box, [class*='job-card'], [class*='search-list'], [class*='result-list'], [class*='job-list']",
      JOB_DETAIL: ".job-banner, .job-detail-header, .job-description, .job-detail-section, .job-sec, .job-sec-text, .job-detail, .detail-content, [class*='job-detail'], [class*='job-sec'], [class*='description'], .company-info, .company-name, .job-address",
      BLOCKER: ".dialog, .modal, .dialog-wrap, .login-dialog, .verify-dialog, .verify-box"
    },
    zhilian: {
      SEARCH: ".job-list-panel, .job-split-layout__right, .pagination",
      JOB_DETAIL: ".job-list-panel, .job-split-layout__right",
      BLOCKER: ".dialog, .modal, .dialog-wrap, .login-dialog, .verify-dialog, .verify-box"
    }
  });
  const classes = new Set(("job-list-box search-job-result pagination next prev disabled empty loading " +
    "job-card-box job-card-wrapper job-card-body job-card job-name job-title company-name salary job-salary job-area tag-list " +
    "job-banner job-detail-header job-description job-detail-section job-sec job-sec-text job-detail detail-content text company-info job-address " +
    "boss-name boss-title boss-active-time dialog modal dialog-wrap login-dialog verify-dialog verify-box " +
    "job-list-panel job-split-layout__right job-card--active job-card__title-clamp job-card__salary job-card__skill-tags " +
    "job-card__company-name job-card__location job-detail-summary__title-text job-detail-summary__salary " +
    "job-detail-summary__tag job-description__content company-intro").split(" "));
  const tags = new Set("div section article main ul ol li a span p h1 h2 h3 h4 button br strong em label".split(" "));
  const excluded = "script, style, link, img, svg, iframe, object, embed, input, textarea, select, form, [contenteditable], .item-myself, .message-list, .chat-list, .chat-message, .boss-info, .recruiter-info";
  const fixedText = new Set(["请先登录", "登录", "扫码登录", "请完成安全验证", "安全验证", "滑动验证", "加载中", "暂无职位", "暂无相关职位", "页面加载失败", "刷新", "确认投递", "投递简历", "立即沟通", "继续沟通", "已沟通", "已投递", "已申请", "已发送", "发送失败", "发送中", "投递成功", "已向对方发送简历和打招呼语", "今日沟通次数已用完", "我知道了", "取消", "确定", "下一页", "上一页", "查看更多信息"]);
  const fields = [
    [".job-name,.job-title,.job-card__title-clamp,.job-detail-summary__title-text", "title"],
    [".company-name,.job-card__company-name", "company"],
    [".salary,.job-salary,.job-card__salary,.job-detail-summary__salary", "salary"],
    [".job-area,.job-card__location", "location"],
    [".tag-list,.job-card__skill-tags", "tags"],
    [".job-description,.job-description__content,.job-sec-text", "description"],
    [".company-info,.company-intro", "companyInfo"],
    [".job-address", "address"]
  ];
  function platformFor(href) {
    const url = new URL(href);
    if (url.protocol !== "https:") fail("UNSUPPORTED_PAGE");
    if (/(^|\.)zhipin\.com$/i.test(url.hostname)) return "boss";
    if (/(^|\.)zhaopin\.com$/i.test(url.hostname)) return "zhilian";
    fail("UNSUPPORTED_PAGE");
  }
  // No outerHTML of the source, storage, network, page click or form reads.
  // Free text and attributes are substituted, not regex-scrubbed and retained.
  function capture(document, href, pageType) {
    const platform = platformFor(href);
    if (/\/(chat|im|message)(\/|$)/i.test(new URL(href).pathname)) fail("CHAT_PAGE");
    const selector = roots[platform][pageType];
    if (!selector) fail("INVALID_TYPE");
    const candidates = Array.from(document.querySelectorAll(selector));
    if (candidates.length > 1000) fail("TOO_LARGE");
    const selected = candidates
      .filter(node => tags.has(node.localName) && !node.closest(excluded))
      .filter((node, _, all) => !all.some(parent => parent !== node && parent.contains(node)));
    if (selected.length > 200) fail("TOO_LARGE");
    if (!selected.length) fail("NO_STRUCTURE");
    const out = document.implementation.createHTMLDocument("脱敏结构样本");
    const identities = new Map(), titles = new Map(), companies = new Map();
    let visited = 0;
    const alias = (map, value, prefix) => {
      if (!map.has(value)) map.set(value, `${prefix}${String(map.size + 1).padStart(3, "0")}`);
      return map.get(value);
    };
    const identity = value => alias(identities, value, "fixture");
    function substitute(value, parent) {
      const text = String(value || "").replace(/\s+/g, " ").trim();
      if (!text) return " ";
      if (fixedText.has(text)) return text;
      if (/^今日还可沟通\d{1,3}次$/.test(text)) return text === "今日还可沟通0次" ? text : "今日还可沟通3次";
      const field = fields.find(([selector]) => parent?.closest(selector))?.[1];
      if (field === "title") return alias(titles, text, "示例产品运营");
      if (field === "company") return alias(companies, text, "示例科技公司");
      if (field === "salary") return platform === "boss" ? "15-25K" : "8000-12000元";
      if (field === "location") return "北京";
      if (field === "tags") return "3-5年 本科";
      if (parent?.closest(".job-detail-summary__tag")) return /年/.test(text) ? "3-5年" : /本科|硕士|大专|博士/.test(text) ? "本科" : "北京";
      if (field === "description") return "岗位职责：负责示例产品的需求分析和数据运营。任职要求：具备产品分析与项目协作经验。";
      if (field === "companyInfo") return "公司介绍：提供示例企业软件服务的虚构公司。";
      if (field === "address") return "示例办公地址";
      return "脱敏文本";
    }
    function copy(node, depth = 0) {
      if (++visited > 5000 || depth > 60) fail("TOO_LARGE");
      if (node.nodeType === 3) return out.createTextNode(substitute(node.textContent, node.parentElement));
      if (node.nodeType !== 1 || node.matches(excluded)) return null;
      if (!tags.has(node.localName)) return null;
      const clone = out.createElement(node.localName);
      const allowed = Array.from(node.classList).filter(name => classes.has(name));
      if (allowed.length) clone.className = allowed.join(" ");
      for (const attr of ["data-jobid", "data-job-id", "data-jid", "data-position-id"]) {
        const value = node.getAttribute(attr);
        if (value) clone.setAttribute(attr, identity(value));
      }
      if (node.hasAttribute("aria-label")) clone.setAttribute("aria-label", substitute(node.getAttribute("aria-label"), node));
      if (node.hasAttribute("disabled")) clone.setAttribute("disabled", "");
      if (node.hasAttribute("hidden")) clone.setAttribute("hidden", "");
      if (["dialog", "button"].includes(node.getAttribute("role"))) clone.setAttribute("role", node.getAttribute("role"));
      if (node.localName === "a") {
        try {
          const url = new URL(node.getAttribute("href") || "", href);
          const id = platform === "boss" ? url.pathname.match(/^\/job_detail\/([^/.]+)(?:\.html)?$/)?.[1] : url.pathname.match(/^\/jobdetail\/([^/.]+)\.htm$/)?.[1];
          if (id && platformFor(url.href) === platform) clone.setAttribute("href", platform === "boss" ? `https://www.zhipin.com/job_detail/${identity(id)}.html` : `https://www.zhaopin.com/jobdetail/${identity(id)}.htm`);
        } catch { /* Drop every non-job, external or malformed URL. */ }
      }
      const style = document.defaultView?.getComputedStyle(node) || node.style;
      for (const [key, values] of Object.entries({ display: ["none", "block", "flex", "grid", "inline", "inline-block"], visibility: ["hidden", "visible"], position: ["fixed", "absolute", "relative", "static"], opacity: ["0", "1"] })) {
        if (values.includes(style[key])) clone.style[key] = style[key];
      }
      for (const child of node.childNodes) {
        const result = copy(child, depth + 1);
        if (result) clone.appendChild(result);
      }
      return clone;
    }
    for (const node of selected) {
      const result = copy(node);
      if (result) out.body.appendChild(result);
    }
    if (!out.body.children.length) fail("NO_STRUCTURE");
    // Coverage describes retained structural markers, never claims the real text or platform flow was verified.
    const count = selector => out.body.querySelectorAll(selector).length;
    const coverage = {
      jobCards: count(".job-card-box,.job-card-wrapper,.job-card-body,.job-card"),
      titles: count(".job-name,.job-title,.job-card__title-clamp,.job-detail-summary__title-text"),
      companies: count(".company-name,.job-card__company-name"),
      descriptions: count(".job-description,.job-sec-text,.job-detail-section .text,.job-description__content"),
      jobIdentities: count("[data-jobid],[data-job-id],[data-jid],[data-position-id],a[href*='/job_detail/'],a[href*='/jobdetail/']")
    };
    const warnings = [];
    if (pageType === "SEARCH" && !coverage.jobCards) warnings.push("MISSING_JOB_CARDS");
    if (pageType !== "BLOCKER") {
      if (!coverage.titles) warnings.push("MISSING_TITLE");
      if (!coverage.companies) warnings.push("MISSING_COMPANY");
      if (!coverage.jobIdentities) warnings.push("MISSING_JOB_IDENTITY");
    }
    if (pageType === "JOB_DETAIL" && !coverage.descriptions) warnings.push("MISSING_DESCRIPTION");
    return {
      format: VERSION, platform, pageType,
      provenance: { kind: "structural-redacted", capturedAt: new Date().toISOString(), source: "user-triggered-extension-export", content: "synthetic-replacements", redactionVersion: REDACTION_VERSION },
      html: out.body.innerHTML, rootCount: selected.length, nodeCount: visited,
      coverage, warnings,
      reviewRequired: true,
      limitations: ["自由文本与身份已替换，不能证明真实正文解析正确", "只保留白名单类名和有限样式，不是完整视觉快照", "岗位别名仅在本次导出内部保持关联", "不采集聊天，未知结构需要另写合成样本"]
    };
  }
  function captureSafely(document, href, pageType) {
    try { return { ok: true, bundle: capture(document, href, pageType) }; }
    catch (error) { return { ok: false, errorCode: Object.hasOwn(errors, error?.code) ? error.code : "CAPTURE_FAILED" }; }
  }
  root.GetJobsFixtureExporter = Object.freeze({
    capture, captureSafely, platformFor, version: REDACTION_VERSION,
    errorMessage: code => Object.hasOwn(errors, code) ? errors[code] : errors.CAPTURE_FAILED,
    warningMessage: code => Object.hasOwn(warningMessages, code) ? warningMessages[code] : "部分结构未识别"
  });
})(typeof window !== "undefined" ? window : globalThis);
