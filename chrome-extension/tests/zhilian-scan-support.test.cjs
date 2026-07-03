const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadSupport() {
  const window = {};
  const context = vm.createContext({ window, globalThis: window, URLSearchParams });
  const source = fs.readFileSync(path.resolve(__dirname, "..", "zhilian-scan-support.js"), "utf8");
  vm.runInContext(source, context, { filename: "zhilian-scan-support.js" });
  return window.GetJobsZhilianScanSupport;
}

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
