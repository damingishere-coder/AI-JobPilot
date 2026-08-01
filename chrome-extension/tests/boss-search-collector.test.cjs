const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const EXTENSION_DIR = path.resolve(__dirname, "..");

class FakeElement {
  constructor({ text = "", attrs = {}, fields = {} } = {}) {
    this.innerText = text;
    this.textContent = text;
    this.attrs = attrs;
    this.fields = fields;
    this.offsetParent = {};
    this.parentElement = null;
    this.cardRoot = null;
  }

  getAttribute(name) {
    return this.attrs[name] || null;
  }

  querySelector(selector) {
    if (selector.includes("job_detail")) return this.fields.detailLink || null;
    if (selector.includes("job-name") || selector.includes("job-title") || selector === "h3" || selector === "h2") {
      return this.fields.title || null;
    }
    if (selector.includes("company-name") || selector.includes("brand-name") || selector.includes("company-title") || selector.includes("company")) {
      return this.fields.company || null;
    }
    if (selector.includes("salary")) return this.fields.salary || null;
    if (selector.includes("job-area") || selector.includes("location") || selector.includes("address")) {
      return this.fields.location || null;
    }
    if (selector.includes("tag-list") || selector.includes("job-tags") || selector.includes("experience") || selector.includes("degree")) {
      return this.fields.tags || null;
    }
    if (selector.includes("boss-name") || selector.includes("recruiter")) return this.fields.hrName || null;
    return null;
  }

  matches(selector) {
    return Boolean(selector.includes("job_detail") && this.attrs.href);
  }

  closest() {
    return this.cardRoot || this;
  }

  getClientRects() {
    return [1];
  }
}

function field(text) {
  return new FakeElement({ text });
}

function createCard(index) {
  const title = field(`Java开发工程师${index}`);
  const company = field(`示例科技公司${index}`);
  const salary = field("20-30K·13薪");
  const location = field("深圳·南山");
  const tags = field("3-5年 本科");
  const hrName = field(`招聘经理${index}`);
  const link = new FakeElement({
    text: title.innerText,
    attrs: { href: `https://www.zhipin.com/job_detail/mock-${index}.html` }
  });
  const text = [
    title.innerText,
    salary.innerText,
    location.innerText,
    tags.innerText,
    company.innerText,
    hrName.innerText
  ].join("\n");
  const root = new FakeElement({
    text,
    fields: { title, company, salary, location, tags, hrName, detailLink: link }
  });
  link.cardRoot = root;
  return { root, link };
}

function createNavigationCard(titleText, href) {
  const title = field(titleText);
  const company = field("示例导航公司");
  const salary = field("20-30K");
  const location = field("深圳·南山");
  const tags = field("3-5年 本科");
  const link = new FakeElement({
    text: title.innerText,
    attrs: { href }
  });
  const root = new FakeElement({
    text: [title.innerText, salary.innerText, location.innerText, tags.innerText, company.innerText].join("\n"),
    fields: { title, company, salary, location, tags, detailLink: link }
  });
  link.cardRoot = root;
  return { root, link };
}

function loadCollector(cardCount = 6, extraCards = []) {
  const cards = Array.from({ length: cardCount }, (_, index) => createCard(index + 1)).concat(extraCards);
  const roots = cards.map((card) => card.root);
  const links = cards.map((card) => card.link);
  const body = new FakeElement({ text: roots.map((root) => root.innerText).join("\n") });
  const document = {
    body,
    documentElement: new FakeElement(),
    title: "Boss采集模拟搜索页",
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      if (selector.includes("job_detail")) return links;
      if (selector === "li.job-card-box") return roots;
      if (selector === ".job-list-box") return [new FakeElement({ text: body.innerText })];
      return [];
    }
  };
  const window = {
    document,
    location: {
      href: "https://www.zhipin.com/web/geek/job?city=101280600&query=Java",
      origin: "https://www.zhipin.com"
    },
    getComputedStyle() {
      return { display: "block", visibility: "visible", opacity: "1" };
    }
  };
  window.window = window;

  const context = vm.createContext({
    window,
    document,
    URL,
    console
  });
  for (const file of ["boss-selectors.js", "boss-debug.js", "boss-search-collector.js"]) {
    vm.runInContext(fs.readFileSync(path.join(EXTENSION_DIR, file), "utf8"), context, { filename: file });
  }
  return window;
}

test("collects at least five visible Boss cards with required list fields", () => {
  const window = loadCollector(6);
  const result = window.GetJobsBossSearchCollector.collectVisibleJobs({ keyword: "Java" });

  assert.equal(result.candidateCount, 6);
  assert.equal(result.jobs.length, 6);
  for (const job of result.jobs) {
    for (const fieldName of ["title", "company", "salary", "location", "url", "keyword"]) {
      assert.ok(job[fieldName], `${fieldName} should not be empty`);
    }
    assert.equal(job.deliveryStatus, "LIST_COLLECTED");
    assert.equal(job.source, "boss-dom-card");
    assert.equal(job.salarySource, "dom_untrusted");
  }
});

test("reports selector counts and detail links for diagnostics", () => {
  const window = loadCollector(6);
  const diagnostics = window.GetJobsBossDebug.collect();

  assert.equal(diagnostics.detailLinkCount, 6);
  assert.equal(diagnostics.selectorCounts["li.job-card-box"], 6);
  assert.match(diagnostics.firstCardText, /Java开发工程师1/);
  assert.equal(diagnostics.isLoginPage, false);
  assert.equal(diagnostics.isSecurityPage, false);
  assert.equal(diagnostics.isSearchPage, true);
  assert.equal(diagnostics.bodyText, undefined);
});

test("skips Boss navigation and non-Boss detail links", () => {
  const window = loadCollector(2, [
    createNavigationCard("职位搜索", "https://www.zhipin.com/web/geek/job?city=101280600&query=Java"),
    createNavigationCard("Java开发工程师外链", "https://example.com/job_detail/not-boss.html")
  ]);
  const result = window.GetJobsBossSearchCollector.collectVisibleJobs({ keyword: "Java" });

  assert.equal(result.candidateCount, 4);
  assert.equal(result.jobs.length, 2);
  assert.equal(result.jobs.some((job) => job.title === "职位搜索"), false);
  assert.equal(result.jobs.some((job) => job.url.includes("example.com")), false);
});
