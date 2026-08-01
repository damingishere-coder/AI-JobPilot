const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadCollector() {
  const window = {};
  window.window = window;
  const context = vm.createContext({
    window,
    URLSearchParams,
    console,
    Set
  });
  const source = fs.readFileSync(path.resolve(__dirname, "..", "boss-api-collector.js"), "utf8");
  vm.runInContext(source, context, { filename: "boss-api-collector.js" });
  return window.GetJobsBossApiCollector;
}

function sampleRawJob(overrides = {}) {
  return {
    encryptJobId: "job-123",
    jobName: "Java开发工程师",
    brandName: "示例科技有限公司",
    salaryDesc: "20-30K·13薪",
    cityName: "深圳",
    areaDistrict: "南山",
    businessDistrict: "科技园",
    jobExperience: "3-5年",
    jobDegree: "本科",
    bossTitle: "招聘经理",
    brandIndustry: "互联网",
    brandStageName: "B轮",
    brandScaleName: "100-499人",
    skills: ["Java", "Spring Boot"],
    welfareList: ["五险一金", "年终奖"],
    securityId: "security-1",
    lid: "lid-1",
    encryptBossId: "boss-1",
    encryptBrandId: "brand-1",
    ...overrides
  };
}

function pageResult(data, overrides = {}) {
  return {
    success: true,
    responseOk: true,
    httpStatus: 200,
    data,
    pageState: { isLoginPage: false, isSecurityPage: false },
    ...overrides
  };
}

test("builds first-page Boss API params with existing filters", () => {
  const collector = loadCollector();
  const request = collector.buildRequest({
    keyword: "Java",
    cityCode: "101280600",
    page: 1,
    pageSize: 10,
    config: {
      jobType: "1901",
      salary: ["0", "405", "406"],
      experience: "[104,105]",
      degree: ["203"],
      scale: "303",
      industry: ["1001"],
      stage: ["804"]
    }
  });

  assert.equal(request.path, "/wapi/zpgeek/search/joblist.json");
  assert.equal(request.params.scene, "1");
  assert.equal(request.params.query, "Java");
  assert.equal(request.params.city, "101280600");
  assert.equal(request.params.page, "1");
  assert.equal(request.params.pageSize, "10");
  assert.equal(request.params.salary, "405,406");
  assert.equal(request.params.experience, "104,105");
});

test("parses a code 0 response as API_SUCCESS", () => {
  const collector = loadCollector();
  const request = collector.buildRequest({ keyword: "Java", cityCode: "101280600", page: 1, pageSize: 10 });
  const result = collector.parsePageResult(pageResult({
    code: 0,
    message: "Success",
    zpData: { jobList: [sampleRawJob()] }
  }), request);

  assert.equal(result.success, true);
  assert.equal(result.diagnosticType, "API_SUCCESS");
  assert.equal(result.candidateCount, 1);
  assert.equal(result.jobs[0].salarySource, "api");
});

test("classifies code 37 without fallback permission", () => {
  const collector = loadCollector();
  const request = collector.buildRequest({ keyword: "Java", cityCode: "101280600", page: 1, pageSize: 10 });
  const result = collector.parsePageResult(pageResult({ code: 37, message: "请求被限制" }, {
    responseOk: false,
    httpStatus: 403
  }), request);

  assert.equal(result.success, false);
  assert.equal(result.diagnosticType, "API_CODE_37");
  assert.equal(result.apiCode, 37);
  assert.equal(collector.shouldFallback(result.diagnosticType), false);
});

test("classifies an empty jobList as API_EMPTY", () => {
  const collector = loadCollector();
  const request = collector.buildRequest({ keyword: "Java", cityCode: "101280600", page: 1, pageSize: 10 });
  const result = collector.parsePageResult(pageResult({ code: 0, message: "Success", zpData: { jobList: [] } }), request);

  assert.equal(result.diagnosticType, "API_EMPTY");
  assert.equal(result.candidateCount, 0);
  assert.equal(collector.shouldFallback(result.diagnosticType), true);
});

test("classifies missing zpData as API_SCHEMA_CHANGED", () => {
  const collector = loadCollector();
  const request = collector.buildRequest({ keyword: "Java", cityCode: "101280600", page: 1, pageSize: 10 });
  const result = collector.parsePageResult(pageResult({ code: 0, message: "Success" }), request);

  assert.equal(result.success, false);
  assert.equal(result.diagnosticType, "API_SCHEMA_CHANGED");
});

test("keeps jobs but reports API_SALARY_MISSING when salaryDesc is absent", () => {
  const collector = loadCollector();
  const request = collector.buildRequest({ keyword: "Java", cityCode: "101280600", page: 1, pageSize: 10 });
  const result = collector.parsePageResult(pageResult({
    code: 0,
    message: "Success",
    zpData: { jobList: [sampleRawJob({ salaryDesc: undefined })] }
  }), request);

  assert.equal(result.success, true);
  assert.equal(result.diagnosticType, "API_SALARY_MISSING");
  assert.equal(result.missingSalaryCount, 1);
  assert.equal(result.jobs[0].salary, "");
  assert.equal(result.jobs[0].salarySource, "api");
});

test("retains securityId and lid in mapped jobs", () => {
  const collector = loadCollector();
  const mapped = collector.mapJob(sampleRawJob(), "Java");

  assert.equal(mapped.securityId, "security-1");
  assert.equal(mapped.lid, "lid-1");
  assert.equal(mapped.encryptBossId, "boss-1");
  assert.equal(mapped.encryptBrandId, "brand-1");
});

test("maps API fields to the existing Chrome job shape without treating brandName as hrName", () => {
  const collector = loadCollector();
  const mapped = collector.mapJob(sampleRawJob(), "Java");

  assert.deepEqual(JSON.parse(JSON.stringify(mapped)), {
    id: "job-123",
    userId: "boss-1",
    title: "Java开发工程师",
    company: "示例科技有限公司",
    salary: "20-30K·13薪",
    location: "深圳·南山·科技园",
    experience: "3-5年",
    degree: "本科",
    hrName: "",
    hrTitle: "招聘经理",
    hrActive: "",
    description: "",
    deliveryStatus: "LIST_COLLECTED",
    url: "https://www.zhipin.com/job_detail/job-123.html",
    industry: "互联网",
    financingStage: "B轮",
    companyScale: "100-499人",
    skills: ["Java", "Spring Boot"],
    welfare: ["五险一金", "年终奖"],
    keyword: "Java",
    source: "boss-search-api",
    salarySource: "api",
    securityId: "security-1",
    lid: "lid-1",
    encryptBossId: "boss-1",
    encryptBrandId: "brand-1"
  });
});

test("falls back to the original collector after an ordinary API request failure", async () => {
  const collector = loadCollector();
  let fallbackCalls = 0;
  const result = await collector.collectWithFallback({
    keyword: "Java",
    cityCode: "101280600",
    page: 1,
    pageSize: 10,
    requestPage: async () => ({ success: false, message: "network failed" })
  }, async (apiResult) => {
    fallbackCalls += 1;
    assert.equal(apiResult.diagnosticType, "API_REQUEST_FAILED");
    return {
      jobs: [{ id: "dom-1", title: "DOM岗位", company: "DOM公司", salarySource: "dom_untrusted" }],
      collectorSource: "boss-dom-card"
    };
  });

  assert.equal(fallbackCalls, 1);
  assert.equal(result.success, true);
  assert.equal(result.diagnosticType, "API_REQUEST_FAILED");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.collectorSource, "boss-dom-card");
  assert.equal(result.jobs[0].salarySource, "dom_untrusted");
});
