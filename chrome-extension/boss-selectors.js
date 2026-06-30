(function () {
  if (window.GetJobsBossSelectors) return;

  const DETAIL_LINK_SELECTOR = "a[href*='/job_detail/'], a[href*='job_detail'], a[href*='job_detail']";
  const CARD_ROOT_SELECTOR = [
    "li.job-card-box",
    ".job-card-wrapper",
    "[class*='job-card-wrapper']",
    "[class*='job-card-box']",
    ".job-list-box > li",
    ".search-job-result > li",
    ".search-job-result li",
    "[ka^='search_list_']",
    "[data-jobid]",
    "[data-job-id]",
    "[data-jid]",
    "[data-securityid]",
    "[data-security-id]",
    "[class*='search-list'] li",
    "[class*='result-list'] li",
    "[class*='job-list'] li",
    "li[class*='card']",
    ".job-card",
    "[class*='job-card']"
  ].join(", ");

  const JOB_CARD_SELECTORS = [
    "li.job-card-box",
    ".job-card-wrapper",
    ".job-card-body",
    "li[class*='job-card']",
    "[class*='job-card-wrapper']",
    "[class*='job-card-box']",
    ".job-list-box li",
    ".search-job-result li",
    ".search-job-result > li",
    "[ka^='search_list_']",
    "[data-jobid]",
    "[data-job-id]",
    "[data-jid]",
    "[data-securityid]",
    "[data-security-id]",
    "[class*='search-list'] li",
    "[class*='result-list'] li",
    "[class*='job-list'] li",
    "li[class*='card']",
    ".job-card",
    "[class*='job-card']",
    DETAIL_LINK_SELECTOR
  ];

  const SEARCH_RESULT_SELECTORS = [
    ".job-list-box",
    ".search-job-result",
    ".job-card-wrapper",
    ".job-card-body",
    "li.job-card-box",
    "[class*='job-card']",
    "[class*='search-list']",
    "[class*='result-list']",
    "[class*='job-list']",
    DETAIL_LINK_SELECTOR
  ];

  const FIELD_SELECTORS = {
    title: [
      ".job-name",
      ".job-title",
      "[class*='job-name']",
      "[class*='job-title']",
      ".position-name",
      "[class*='position-name']",
      "[class*='position-title']",
      "[ka*='job-name']",
      "h3",
      "h2",
      "a[href*='job_detail']"
    ],
    company: [
      ".company-name",
      "[class*='company-name']",
      "[class*='brand-name']",
      "[class*='company-title']",
      ".company-text",
      "[class*='company-text']",
      "[class*='brand']",
      "[ka*='company']"
    ],
    salary: [
      ".salary",
      ".job-salary",
      "[class*='salary']",
      "[class*='red']",
      "[class*='pay']"
    ],
    location: [
      ".job-area",
      ".company-location",
      "[class*='job-area']",
      "[class*='location']",
      "[class*='address']",
      "[class*='area']"
    ],
    experience: [
      ".tag-list",
      "[class*='tag-list']",
      "[class*='job-tags']",
      "[class*='experience']",
      "[class*='tag']",
      "[class*='label']"
    ],
    degree: [
      ".tag-list",
      "[class*='tag-list']",
      "[class*='job-tags']",
      "[class*='degree']",
      "[class*='tag']",
      "[class*='label']"
    ],
    hrName: [
      ".boss-name",
      "[class*='boss-name']",
      "[class*='recruiter']",
      "[class*='hr-name']",
      "[class*='publisher']"
    ]
  };

  const DETAIL_FIELD_SELECTORS = {
    title: [".job-title", ".job-name", ".job-detail-header .name", "h1", "[class*='job-title']", "[class*='position-name']"],
    company: [".company-name", ".sider-company .name", ".company-card .name", "[class*='company-name']", "[class*='brand-name']"],
    salary: [".salary", ".job-banner .salary", "[class*='salary']", "[class*='pay']"],
    description: [
      ".job-detail-section .text",
      ".job-detail-section",
      ".job-description",
      ".job-sec .job-sec-text",
      ".job-sec .text",
      ".job-sec-text",
      ".job-detail",
      ".detail-content",
      "[class*='job-detail']",
      "[class*='job-sec']",
      "[class*='description']",
      "[class*='content']"
    ],
    companyInfo: [
      ".job-sec.company-info",
      ".company-info",
      ".sider-company",
      ".company-detail",
      "[class*='company-info']",
      "[class*='company-desc']",
      "[class*='company-intro']"
    ],
    address: [".job-address", ".location-address", "[class*='address']", "[class*='location']"],
    hrName: [".boss-name", "[class*='boss-name']", ".boss-info .name", ".recruiter-name", "[class*='hr-name']"],
    hrTitle: [".boss-title", "[class*='boss-title']", ".boss-info .gray", ".recruiter-title", "[class*='hr-title']"],
    hrActive: [".boss-active-time", "[class*='active']", "[class*='online']", "[class*='last-login']"]
  };

  window.GetJobsBossSelectors = Object.freeze({
    DETAIL_LINK_SELECTOR,
    CARD_ROOT_SELECTOR,
    JOB_CARD_SELECTORS: Object.freeze(JOB_CARD_SELECTORS),
    SEARCH_RESULT_SELECTORS: Object.freeze(SEARCH_RESULT_SELECTORS),
    FIELD_SELECTORS: Object.freeze(FIELD_SELECTORS),
    DETAIL_FIELD_SELECTORS: Object.freeze(DETAIL_FIELD_SELECTORS)
  });
})();
