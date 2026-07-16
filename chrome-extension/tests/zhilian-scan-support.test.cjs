const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadSupport(existingSupport) {
  const window = existingSupport ? { GetJobsZhilianScanSupport: existingSupport } : {};
  const context = vm.createContext({ window, globalThis: window, URL, URLSearchParams });
  const source = fs.readFileSync(path.resolve(__dirname, "..", "zhilian-scan-support.js"), "utf8");
  vm.runInContext(source, context, { filename: "zhilian-scan-support.js" });
  return window.GetJobsZhilianScanSupport;
}

test("replaces a stale Zhilian support module after extension reload", () => {
  const staleSupport = Object.freeze({ version: "2026-07-03-official-search-params" });
  const support = loadSupport(staleSupport);

  assert.notEqual(support, staleSupport);
  assert.equal(support.version, "2026-07-16-search-resume-navigation-1");
  assert.equal(typeof support.isZhilianUrl, "function");
});

test("recognizes supported Zhilian pages without trusting lookalike hosts", () => {
  const support = loadSupport();

  assert.equal(support.isZhilianUrl("https://www.zhaopin.com/"), true);
  assert.equal(support.isZhilianUrl("https://sou.zhaopin.com/"), true);
  assert.equal(support.isZhilianSearchUrl("https://www.zhaopin.com/sou/jl489/kwtoken/p1"), true);
  assert.equal(support.isZhilianSearchUrl("https://www.zhaopin.com/jobdetail/demo.htm"), false);
  assert.equal(support.isZhilianUrl("https://zhaopin.com.example.com/sou/"), false);
  assert.equal(support.isZhilianUrl("http://www.zhaopin.com/sou/"), false);
});

test("keeps the Zhilian resume URL guard and background search navigation wired", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "zhilian-content.js"), "utf8");

  assert.match(source, /function isZhilianUrl\(rawUrl\)/);
  assert.match(source, /!isFreshScanTask\(task\) \|\| !isZhilianUrl\(window\.location\.href\)/);
  assert.match(source, /requestBackgroundNavigation\(url, "search"\)/);
});

test("builds a Zhilian search URL with official city and salary params", () => {
  const support = loadSupport();

  assert.equal(
    support.buildSearchUrl("Java", { cityCode: "765", salary: "10001,15000" }),
    "https://www.zhaopin.com/sou/jl765/?kw=Java&sl=10001%2C15000"
  );
});

test("omits sl when salary is unlimited", () => {
  const support = loadSupport();

  assert.equal(
    support.buildSearchUrl("Java", { cityCode: "765", salary: "0" }),
    "https://www.zhaopin.com/sou/jl765/?kw=Java"
  );
  assert.equal(
    support.buildSearchUrl("Java", { cityCode: "765", salary: "\u4e0d\u9650" }),
    "https://www.zhaopin.com/sou/jl765/?kw=Java"
  );
  assert.equal(
    support.buildSearchUrl("Java", { cityCode: "765", salary: "0000,9999999" }),
    "https://www.zhaopin.com/sou/jl765/?kw=Java"
  );
});

test("normalizes legacy custom salary and pagination", () => {
  const support = loadSupport();

  assert.equal(
    support.buildSearchUrl("Java", { cityCode: "jl765", salary: "12000,30000" }, 3),
    "https://www.zhaopin.com/sou/jl765/?kw=Java&p=3"
  );
  assert.equal(
    JSON.stringify(support.normalizedSearchParamsForCursor({ cityCode: "0", salary: "12000,30000" })),
    JSON.stringify({ cityCode: "489", salary: "0000,9999999" })
  );
});
