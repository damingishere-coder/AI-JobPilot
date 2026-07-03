package com.getjobs.worker.zhilian;

import com.getjobs.application.entity.ZhilianJobDataEntity;
import com.getjobs.application.service.JobAiAnalysisService;
import com.getjobs.application.service.ZhilianService;
import com.getjobs.worker.utils.Job;
import com.getjobs.worker.utils.PlaywrightUtil;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import lombok.RequiredArgsConstructor;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Scope;
import org.springframework.stereotype.Component;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;

/**
 * @author loks666
     * 智联招聘岗位扫描 - Playwright版本
 */
@Slf4j
@Component
@Scope("prototype")
@RequiredArgsConstructor
public class ZhiLian {

    @Setter
    private Page page;

    @Setter
    private ZhilianConfig config;

    @Setter
    private ProgressCallback progressCallback;

    @Setter
    private Supplier<Boolean> shouldStopCallback;

    private final List<Job> resultList = new ArrayList<>();
    private boolean isLimit = false;
    private int maxPage = 500;

    private static final String HOME_URL = "https://www.zhaopin.com/sou/";
    private static final Set<String> OFFICIAL_ZHILIAN_SALARY_CODES = Set.of(
            "0000,4000",
            "4001,6000",
            "6001,8000",
            "8001,10000",
            "10001,15000",
            "15001,25000",
            "25001,35000",
            "35001,50000",
            "50001,9999999"
    );

    private final ZhilianService zhilianService;
    private final JobAiAnalysisService jobAiAnalysisService;

    private static class PageJob {
        int index;
        String jobId;
        String jobTitle;
        String companyName;
        String jobLink;
        String salary;
        String location;
        String experience;
        String degree;

        PageJob(int index, String jobId, String jobTitle, String companyName, String jobLink,
                String salary, String location, String experience, String degree) {
            this.index = index;
            this.jobId = jobId;
            this.jobTitle = jobTitle;
            this.companyName = companyName;
            this.jobLink = jobLink;
            this.salary = salary;
            this.location = location;
            this.experience = experience;
            this.degree = degree;
        }
    }

    /**
     * 进度回调接口
     */
    @FunctionalInterface
    public interface ProgressCallback {
        void accept(String message, Integer current, Integer total);
    }

    /**
     * 准备工作：加载配置、初始化数据
     */
    public void prepare() {
        log.info("智联招聘准备工作开始...");
        resultList.clear();
        isLimit = false;
        log.info("智联招聘准备工作完成");
    }

    /**
     * 执行扫描任务
     * @return 待确认数量
     */
    public int execute() {
        log.info("智联招聘扫描任务开始...");
        long startTime = System.currentTimeMillis();

        try {
            // 遍历所有关键词进行投递
            for (String keyword : config.getKeywords()) {
                if (shouldStop() || isLimit) {
                    sendProgress("用户取消扫描或已达上限", null, null);
                    break;
                }

                String baseUrl = buildSearchUrl(keyword, 1);
                deliverByKeyword(keyword, baseUrl);
            }

            long duration = System.currentTimeMillis() - startTime;
            String message = String.format("智联招聘扫描完成，共生成%d个待确认岗位，用时%s",
                resultList.size(), formatDuration(duration));
            log.info(message);
            sendProgress(message, null, null);

            if (!resultList.isEmpty()) {
                log.info("新增待确认岗位如下:");
                resultList.forEach(job -> log.info(job.toString()));
            } else {
                log.info("未生成新的待确认岗位...");
            }

        } catch (Exception e) {
            log.error("智联招聘扫描过程出现异常", e);
            sendProgress("扫描出现异常: " + e.getMessage(), null, null);
        }

        return resultList.size();
    }

    /**
     * 按关键词扫描
     */
    private void deliverByKeyword(String keyword, String baseUrl) {
        if (isLimit) {
            return;
        }

        try {
            log.info("开始扫描关键词: {}", keyword);
            sendProgress("正在搜索关键词: " + keyword, null, null);

            // 导航到搜索页面（路径参数：jl+城市码 + p1 + sl）
            page.navigate(baseUrl);
            PlaywrightUtil.sleep(2);

            // 在搜索框输入关键词并触发搜索（Enter键更稳健）
            try {
                Locator keywordInput = findKeywordInput();
                if (keywordInput == null || keywordInput.count() == 0) {
                    log.warn("未找到搜索输入框，跳过关键词: {}", keyword);
                    return;
                }
                keywordInput.fill("");
                keywordInput.fill(keyword);
                try { keywordInput.press("Enter"); } catch (Exception ignored) {}
                PlaywrightUtil.sleep(2);
            } catch (Exception e) {
                log.warn("搜索框输入关键词失败，跳过当前关键词: {}", e.getMessage());
                return;
            }

            // 等待岗位列表加载（CSS选择器）
            try {
                page.waitForSelector("div.joblist-box__item",
                    new Page.WaitForSelectorOptions().setTimeout(10_000));
            } catch (Exception e) {
                log.warn("等待岗位列表超时，跳过当前关键词");
                return;
            }

            // 遍历所有页面：仅以“下一页”按钮禁用状态为主，最多50页
            int pageNum = 1;
            KeywordScanState scanState = new KeywordScanState(searchJobLimit());
            while (pageNum <= 50) {
                if (shouldStop() || isLimit) {
                    sendProgress("用户取消扫描或已达上限", null, null);
                    return;
                }

                log.info("开始扫描【{}】关键词，第【{}】页...", keyword, pageNum);
                sendProgress(String.format("正在扫描第%d页", pageNum), pageNum, 50);

                // 等待岗位列表出现（CSS选择器）
                try {
                    page.waitForSelector("div.positionlist",
                        new Page.WaitForSelectorOptions().setTimeout(10_000));
                } catch (Exception e) {
                    log.warn("等待岗位列表失败，刷新页面重试");
                    page.reload();
                    PlaywrightUtil.sleep(1);
                }

                // 扫描当前页面
                if (!deliverCurrentPage(keyword, scanState)) {
                    break;
                }
                if (scanState.reachedLimit()) {
                    log.info("关键词【{}】已达到每关键词AI分析上限: {}", keyword, scanState.limit);
                    break;
                }

                PlaywrightUtil.sleep(2);

                // 判断是否还有下一页
                if (isNextDisabled()) {
                    log.info("下一页按钮不可点击，结束翻页");
                    break;
                }

                // 点击下一页
                Locator nextBtn = page.locator("a.soupager__btn:has-text(\"下一页\")");
                if (nextBtn.count() > 0) {
                    try { nextBtn.first().scrollIntoViewIfNeeded(); } catch (Exception ignored) {}
                    nextBtn.first().click();
                    PlaywrightUtil.sleep(2);
                    pageNum++;
                } else {
                    log.info("未找到下一页按钮，结束翻页");
                    break;
                }
            }

            log.info("关键词【{}】扫描完成", keyword);
        } catch (Exception e) {
            log.error("扫描关键词【{}】时出现异常", keyword, e);
        }
    }

    /**
     * 扫描当前页面的所有职位
     * @return 是否继续扫描下一页
     */
    private boolean deliverCurrentPage(String keyword, KeywordScanState scanState) {
        try {
            page.waitForSelector("div.joblist-box__item",
                    new Page.WaitForSelectorOptions().setTimeout(15000));

            if (checkIsLimit()) {
                sendProgress("用户取消扫描或已达上限", null, null);
                return false;
            }

            Locator cards = page.locator("div.joblist-box__item");
            int count = cards.count();
            log.info("检测到当前页岗位数量: {}", count);

            List<PageJob> jobs = new ArrayList<>();
            // 统一采集当前页岗位后再保存（不在循环中逐个入库）
            List<ZhilianJobDataEntity> toInsert = new ArrayList<>();

            for (int i = 0; i < count; i++) {
                if (shouldStop()) {
                    sendProgress("用户取消扫描或已达上限", null, null);
                    return false;
                }

                Locator card = cards.nth(i);
                String jobTitle = safeGetText(card, "a.jobinfo__name");
                String jobLink = null;
                try { jobLink = card.locator("a.jobinfo__name").getAttribute("href"); } catch (Exception ignored) {}
                String salary = safeGetText(card, "p.jobinfo__salary");
                String location = safeGetText(card, "div.jobinfo__other-info div.jobinfo__other-info-item > span");
                String experience = safeGetText(card, "div.jobinfo__other-info-item:nth-child(2)");
                String degree = safeGetText(card, "div.jobinfo__other-info-item:nth-child(3)");
                String companyName = safeGetText(card, "div.companyinfo__name");

                String jobId = extractJobIdFromLink(jobLink);

                try {
                    String jid = jobId == null ? "" : jobId.trim();
                    String jtitle = jobTitle == null ? "" : jobTitle.trim();
                    if (jid.isEmpty() || jtitle.isEmpty()) {
                        log.info("岗位缺少jobId或jobTitle，跳过采集：title={}，company={}", jtitle, companyName);
                    } else {
                        boolean exists = false;
                        try { exists = zhilianService.existsByJobId(jid); } catch (Exception checkEx) {
                            log.warn("查询jobId是否已存在失败: {}", checkEx.getMessage());
                        }
                        if (exists) {
                            log.info("jobId已存在，跳过采集：jobId={}，title={}", jid, jtitle);
                        } else {
                            ZhilianJobDataEntity entity = new ZhilianJobDataEntity();
                            entity.setJobId(jid);
                            entity.setJobTitle(jtitle);
                            entity.setJobLink(jobLink);
                            entity.setSalary(salary);
                            entity.setLocation(location);
                            entity.setExperience(experience);
                            entity.setDegree(degree);
                            entity.setCompanyName(companyName);
                            entity.setDeliveryStatus("未投递");
                            toInsert.add(entity);
                        }
                    }
                } catch (Exception ex) {
                    log.warn("采集岗位数据失败: {}", ex.getMessage());
                }

                jobs.add(new PageJob(i, jobId, jobTitle, companyName, jobLink, salary, location, experience, degree));
            }

            // 统一保存采集到的一整页岗位
            if (!toInsert.isEmpty()) {
                for (ZhilianJobDataEntity entity : toInsert) {
                    try {
                        zhilianService.insertJob(entity);
                        log.info("已保存岗位数据：jobId={}，title={}，company={}", entity.getJobId(), entity.getJobTitle(), entity.getCompanyName());
                    } catch (Exception ex) {
                        log.warn("保存岗位数据失败: {}", ex.getMessage());
                    }
                }
            }

            for (PageJob pj : jobs) {
                if (scanState.reachedLimit()) {
                    sendProgress("已达到每关键词AI分析上限：" + scanState.limit, scanState.analyzed, scanState.limit);
                    return false;
                }
                if (shouldStop()) {
                    sendProgress("用户取消扫描或已达上限", null, null);
                    return false;
                }

                try {
                    String jobDescription = fetchJobDescription(pj.jobLink);
                    scanState.analyzed++;
                    sendProgress("正在AI分析：" + pj.jobTitle, scanState.analyzed, scanState.limit);
                    JobAiAnalysisService.JobAnalysisRequest analysisRequest = new JobAiAnalysisService.JobAnalysisRequest();
                    analysisRequest.setProfileId(zhilianService.getCurrentProfileId());
                    analysisRequest.setPlatform("zhilian");
                    analysisRequest.setKeyword(keyword);
                    analysisRequest.setJobKey(pj.jobId);
                    analysisRequest.setCompanyName(pj.companyName);
                    analysisRequest.setJobName(pj.jobTitle);
                    analysisRequest.setSalary(pj.salary);
                    analysisRequest.setLocation(pj.location);
                    analysisRequest.setExperience(pj.experience);
                    analysisRequest.setDegree(pj.degree);
                    analysisRequest.setJobDescription(jobDescription.isEmpty()
                            ? String.join(" | ", pj.salary, pj.location, pj.experience, pj.degree)
                            : jobDescription);
                    JobAiAnalysisService.AnalysisResult analysis = jobAiAnalysisService.analyzeJob(analysisRequest);
                    if (!analysis.shouldApply()) {
                        log.info("AI跳过智联岗位 | 公司：{} | 岗位：{} | 分数：{} | 原因：{}",
                                pj.companyName, pj.jobTitle, analysis.getScore(), analysis.getSummary());
                        sendProgress("AI跳过：" + pj.jobTitle + "（" + analysis.getScore() + "分）", null, null);
                        continue;
                    }

                    try {
                        if (pj.jobId != null && !pj.jobId.isEmpty()) {
                            zhilianService.markWaitingConfirmByJobId(pj.jobId);
                            log.info("已加入待确认：jobId={}，title={}，company={}", pj.jobId, pj.jobTitle, pj.companyName);
                        } else if (pj.jobTitle != null && pj.companyName != null) {
                            zhilianService.markWaitingConfirmByTitleAndCompany(pj.jobTitle, pj.companyName);
                            log.info("已加入待确认：title={}，company={}", pj.jobTitle, pj.companyName);
                        }
                        sendProgress("待确认：" + pj.jobTitle + "（" + analysis.getScore() + "分）", null, null);
                        Job job = new Job();
                        job.setJobName(pj.jobTitle);
                        job.setCompanyName(pj.companyName);
                        job.setSalary(pj.salary);
                        job.setJobArea(pj.location);
                        resultList.add(job);
                    } catch (Exception ex) {
                        log.warn("更新待确认状态失败: {}", ex.getMessage());
                    }
                } catch (Exception scanEx) {
                    log.warn("扫描岗位失败，继续下一个岗位: {}", scanEx.getMessage());
                }

                if (checkIsLimit()) {
                    sendProgress("用户取消扫描或已达上限", null, null);
                    return false;
                }
            }

            return true;
        } catch (Exception e) {
            log.error("扫描当前页面失败", e);
            try {
                saveCurrentPageHtml();
                log.info("已保存当前页面到 src/main/java/com/getjobs/worker/zhilian/page.html 以便排查");
            } catch (Exception saveEx) {
                log.warn("保存当前页面HTML失败: {}", saveEx.getMessage());
            }
            return false;
        }
    }

    private int searchJobLimit() {
        Integer limit = config == null ? null : config.getSearchJobLimit();
        if (limit == null || limit < 1) return 20;
        return Math.min(limit, 200);
    }

    private static class KeywordScanState {
        private final int limit;
        private int analyzed;

        KeywordScanState(int limit) {
            this.limit = limit;
        }

        boolean reachedLimit() {
            return analyzed >= limit;
        }
    }

    /**
     * 处理投递弹窗
     */
    private void handleDeliveryDialog() {
        try {
            // 获取所有页面
            List<Page> pages = page.context().pages();
            if (pages.size() < 2) {
                log.warn("未检测到投递弹窗页面");
                return;
            }

            // 切换到最新打开的页面（投递弹窗）
            Page dialogPage = pages.get(pages.size() - 1);

            try {
                // 检查投递结果（CSS选择器）
                Locator deliverResult = dialogPage.locator("div.deliver-dialog");
                if (deliverResult.count() > 0) {
                    String text = deliverResult.textContent();
                    if (text != null && text.contains("申请成功")) {
                        log.info("岗位申请成功！");
                    }
                }
            } catch (Exception e) {
                log.debug("读取投递结果失败: {}", e.getMessage());
            }

            // 关闭弹窗
            try {
                Locator closeButton = dialogPage.locator("img[title='close-icon']");
                if (closeButton.count() > 0) {
                    closeButton.click();
                    PlaywrightUtil.sleep(1);
                }
            } catch (Exception e) {
                log.debug("关闭投递弹窗失败: {}", e.getMessage());
                if (checkIsLimit()) {
                    return;
                }
            }

            // 投递相似职位
            deliverSimilarJobs(dialogPage);

            // 关闭弹窗页面
            try {
                dialogPage.close();
            } catch (Exception e) {
                log.debug("关闭弹窗页面失败: {}", e.getMessage());
            }

        } catch (Exception e) {
            log.error("处理投递弹窗失败", e);
        }
    }

    /**
     * 投递相似职位
     */
    private void deliverSimilarJobs(Page dialogPage) {
        try {
            // 全选相似职位
            Locator selectAllCheckbox = dialogPage.locator("div.applied-select-all input");
            if (selectAllCheckbox.count() > 0 && !selectAllCheckbox.isChecked()) {
                selectAllCheckbox.click();
                PlaywrightUtil.sleep(1);
            }

            // 获取相似职位列表
            Locator jobs = dialogPage.locator("div.recommend-job");
            int jobCount = jobs.count();

            if (jobCount == 0) {
                log.info("没有匹配到相似职位");
                return;
            }

            // 记录相似职位信息
            for (int i = 0; i < jobCount; i++) {
                try {
                    Locator jobElement = jobs.nth(i);
                    String jobName = safeGetText(jobElement, ".recommend-job__position");
                    String salary = safeGetText(jobElement, "span.recommend-job__demand__salary");
                    String years = safeGetText(jobElement, "span.recommend-job__demand__experience").replace("\n", " ");
                    String education = safeGetText(jobElement, "span.recommend-job__demand__educational").replace("\n", " ");
                    String companyName = safeGetText(jobElement, ".recommend-job__cname");
                    String companyTag = safeGetText(jobElement, ".recommend-job__demand__cinfo").replace("\n", " ");

                    Job job = new Job();
                    job.setJobName(jobName);
                    job.setSalary(salary);
                    job.setCompanyTag(companyTag);
                    job.setCompanyName(companyName);
                    job.setJobInfo(years + "·" + education);

                    log.info("投递【{}】公司【{}】岗位，薪资【{}】，要求【{}·{}】，规模【{}】",
                        companyName, jobName, salary, years, education, companyTag);
                    resultList.add(job);
                } catch (Exception e) {
                    log.debug("记录相似职位信息失败: {}", e.getMessage());
                }
            }

            // 点击投递按钮
            Locator postButton = dialogPage.locator("div.applied-select-all button");
            if (postButton.count() > 0) {
                postButton.click();
                PlaywrightUtil.sleep(2);
                log.info("相似职位投递成功！");
            }

        } catch (Exception e) {
            log.error("投递相似职位异常: {}", e.getMessage());
        }
    }

    /**
     * 检查是否达到投递上限
     */
    private boolean checkIsLimit() {
        try {
            PlaywrightUtil.sleep(1);
            Locator result = page.locator("//div[@class='a-job-apply-workflow']");
            if (result.count() > 0) {
                String text = result.textContent();
                if (text != null && text.contains("达到上限")) {
                    log.info("今日投递已达上限！");
                    isLimit = true;
                    return true;
                }
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 设置最大页数（已废弃：使用“下一页不可点击”+最多50页）
     */
    private void setMaxPages() {
        // 保留方法避免旧调用报错，但不再依赖输入框改页码
        maxPage = 50;
    }

    /**
     * 构建智联官方搜索 URL：/sou/jl{城市码}/?kw=...&sl=...
     */
    private String buildSearchUrl(String keyword, int pageNum) {
        int page = Math.max(1, pageNum);
        String cityCode = normalizeZhilianCityCode(config == null ? null : config.getCityCode());
        String salaryCode = normalizeZhilianSalaryCode(config == null ? null : config.getSalary());
        StringBuilder url = new StringBuilder(HOME_URL);
        url.append("jl").append(cityCode).append("/");
        List<String> params = new ArrayList<>();
        params.add("kw=" + URLEncoder.encode(keyword == null ? "" : keyword, StandardCharsets.UTF_8));
        if (!salaryCode.isBlank()) {
            params.add("sl=" + URLEncoder.encode(salaryCode, StandardCharsets.UTF_8));
        }
        if (page > 1) {
            params.add("p=" + page);
        }
        url.append("?").append(String.join("&", params));
        return url.toString();
    }

    private String normalizeZhilianCityCode(String raw) {
        String city = raw == null ? "" : raw.trim();
        if (city.isEmpty() || "0".equals(city) || "不限".equals(city)) {
            return ZhilianService.DEFAULT_CITY_CODE;
        }
        if (city.startsWith("jl") || city.startsWith("JL")) {
            city = city.substring(2);
        }
        return city.chars().allMatch(Character::isDigit) ? city : ZhilianService.DEFAULT_CITY_CODE;
    }

    private String normalizeZhilianSalaryCode(String raw) {
        String salary = raw == null ? "" : raw.trim();
        if (salary.isEmpty()
                || "0".equals(salary)
                || "不限".equals(salary)
                || ZhilianService.DEFAULT_SALARY_CODE.equals(salary)) {
            return "";
        }
        return OFFICIAL_ZHILIAN_SALARY_CODES.contains(salary) ? salary : "";
    }

    /**
     * 查找搜索关键词输入框（多候选选择器，提高鲁棒性）
     */
    private Locator findKeywordInput() {
        String[] candidates = new String[] {
            "input[placeholder*='职位']",
            "input[placeholder*='公司']",
            "input[name='kw']",
            "input[type='text']",
            "input[class*='search'], input[class*='sou'], input[class*='input']"
        };
        for (String sel : candidates) {
            try {
                Locator lc = page.locator(sel);
                if (lc != null && lc.count() > 0) {
                    return lc.first();
                }
            } catch (Exception ignored) {}
        }
        return null;
    }

    /**
     * 判断“下一页”是否不可点击
     */
    private boolean isNextDisabled() {
        try {
            Locator nextBtn = page.locator("a.soupager__btn:has-text(\"下一页\")");
            if (nextBtn.count() == 0) return true;
            String cls = null;
            try { cls = nextBtn.first().getAttribute("class"); } catch (Exception ignored) {}
            String disabledAttr = null;
            try { disabledAttr = nextBtn.first().getAttribute("disabled"); } catch (Exception ignored) {}
            if (cls != null && cls.contains("soupager__btn--disable")) return true;
            return disabledAttr != null && ("disabled".equalsIgnoreCase(disabledAttr) || "true".equalsIgnoreCase(disabledAttr));
        } catch (Exception e) {
            return false;
        }
    }

    private String extractJobIdFromLink(String link) {
        if (link == null) return null;
        try {
            int i = link.indexOf("jobdetail/");
            int j = link.lastIndexOf(".htm");
            if (i >= 0 && j > i) {
                return link.substring(i + "jobdetail/".length(), j);
            }
        } catch (Exception ignored) {}
        return null;
    }

    private String fetchJobDescription(String jobLink) {
        if (jobLink == null || jobLink.trim().isEmpty()) return "";
        Page detailPage = null;
        try {
            detailPage = page.context().newPage();
            detailPage.navigate(jobLink, new Page.NavigateOptions().setTimeout(12_000));
            PlaywrightUtil.sleep(1);
            String[] selectors = {
                    "div.describtion__detail-content",
                    "div.job-detail__desc",
                    "div[class*='job-detail']",
                    "div[class*='describtion']",
                    "section"
            };
            for (String selector : selectors) {
                try {
                    Locator el = detailPage.locator(selector);
                    if (el.count() > 0) {
                        String text = el.first().innerText();
                        if (text != null && text.trim().length() > 20) {
                            return text.trim();
                        }
                    }
                } catch (Exception ignored) {}
            }
            return detailPage.locator("body").innerText();
        } catch (Exception e) {
            log.debug("获取智联岗位详情失败: {}", e.getMessage());
            return "";
        } finally {
            try { if (detailPage != null) detailPage.close(); } catch (Exception ignored) {}
        }
    }

    /**
     * 安全获取文本内容
     */
    private String safeGetText(Locator parent, String selector) {
        try {
            Locator element = parent.locator(selector);
            if (element.count() > 0) {
                return element.textContent();
            }
        } catch (Exception e) {
            log.debug("获取文本失败: {}", e.getMessage());
        }
        return "";
    }

    /**
     * 格式化时长
     */
    private String formatDuration(long millis) {
        long seconds = millis / 1000;
        long minutes = seconds / 60;
        long hours = minutes / 60;

        if (hours > 0) {
            return String.format("%d小时%d分钟", hours, minutes % 60);
        } else if (minutes > 0) {
            return String.format("%d分钟%d秒", minutes, seconds % 60);
        } else {
            return String.format("%d秒", seconds);
        }
    }

    /**
     * 将当前页面内容保存到项目内 page.html，覆盖原文件
     */
    private void saveCurrentPageHtml() {
        try {
            String html = page.content();
            java.nio.file.Path path = java.nio.file.Paths.get("src/main/java/com/getjobs/worker/zhilian/page.html");
            java.nio.file.Files.createDirectories(path.getParent());
            java.nio.file.Files.writeString(path, html, java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new RuntimeException("写入 page.html 失败", e);
        }
    }

    /**
     * 发送进度消息
     */
    private void sendProgress(String message, Integer current, Integer total) {
        if (progressCallback != null) {
            progressCallback.accept(message, current, total);
        }
    }

    /**
     * 检查是否应该停止
     */
    private boolean shouldStop() {
        return shouldStopCallback != null && shouldStopCallback.get();
    }
}
