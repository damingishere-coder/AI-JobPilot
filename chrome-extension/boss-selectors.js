(function () {
  if (window.GetJobsBossSelectors) return;

  const DETAIL_LINK_SELECTOR = "a[href*='/job_detail/'], a[href*='job_detail']";
  const CARD_ROOT_SELECTOR = [
    "li.job-card-box",
    ".job-card-wrapper",
    "[class*='job-card-wrapper']",
    "[class*='job-card-box']",
    ".job-list-box > li",
    ".search-job-result > li",
    "[ka^='search_list_']",
    "[data-jobid]",
    "[data-job-id]",
    "[data-jid]",
    "[data-securityid]",
    "[data-security-id]"
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
    "[ka^='search_list_']",
    "[data-jobid]",
    "[data-job-id]",
    "[data-jid]",
    "[data-securityid]",
    "[data-security-id]",
    DETAIL_LINK_SELECTOR
  ];

  const SEARCH_RESULT_SELECTORS = [
    ".job-list-box",
    ".search-job-result",
    ".job-card-wrapper",
    ".job-card-body",
    "li.job-card-box",
    "[class*='job-card']",
    DETAIL_LINK_SELECTOR
  ];

  const FIELD_SELECTORS = {
    title: [
      ".job-name",
      ".job-title",
      "[class*='job-name']",
      "[class*='job-title']",
      "[ka*='job-name']",
      "h3",
      "h2"
    ],
    company: [
      ".company-name",
      "[class*='company-name']",
      "[class*='brand-name']",
      "[class*='company-title']",
      "[ka*='company']"
    ],
    salary: [
      ".salary",
      ".job-salary",
      "[class*='salary']"
    ],
    location: [
      ".job-area",
      ".company-location",
      "[class*='job-area']",
      "[class*='location']",
      "[class*='address']"
    ],
    experience: [
      ".tag-list",
      "[class*='tag-list']",
      "[class*='job-tags']",
      "[class*='experience']"
    ],
    degree: [
      ".tag-list",
      "[class*='tag-list']",
      "[class*='job-tags']",
      "[class*='degree']"
    ],
    hrName: [
      ".boss-name",
      "[class*='boss-name']",
      "[class*='recruiter']"
    ]
  };

  const DETAIL_FIELD_SELECTORS = {
    title: [".job-title", ".job-name", ".job-detail-header .name", "h1"],
    company: [".company-name", ".sider-company .name", ".company-card .name", "[class*='company-name']"],
    salary: [".salary", ".job-banner .salary", "[class*='salary']"],
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
      "[class*='job-sec']"
    ],
    companyInfo: [
      ".job-sec.company-info",
      ".company-info",
      ".sider-company",
      ".company-detail",
      "[class*='company-info']"
    ],
    address: [".job-address", ".location-address", "[class*='address']"],
    hrName: [".boss-name", "[class*='boss-name']", ".boss-info .name", ".recruiter-name"],
    hrTitle: [".boss-title", "[class*='boss-title']", ".boss-info .gray", ".recruiter-title"],
    hrActive: [".boss-active-time", "[class*='active']"]
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
