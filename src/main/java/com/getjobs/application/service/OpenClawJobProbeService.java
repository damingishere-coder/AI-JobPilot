package com.getjobs.application.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.dto.ChromeJobDto;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.TimeUnit;

@Slf4j
@Service
public class OpenClawJobProbeService {
    private static final ObjectMapper mapper = new ObjectMapper();
    private static final Duration COMMAND_TIMEOUT = Duration.ofSeconds(45);

    @Value("${app.openclaw.command:}")
    private String openClawCommand;

    @Value("${app.openclaw.profile:user}")
    private String defaultProfile;

    @Value("${app.openclaw.detail-limit:5}")
    private int defaultDetailLimit;

    public Map<String, Object> status(String profile) {
        String browserProfile = normalizeProfile(profile);
        CommandResult result = runOpenClaw(List.of(
                "browser",
                "--browser-profile",
                browserProfile,
                "--json",
                "tabs"
        ), COMMAND_TIMEOUT);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("success", result.success());
        response.put("profile", browserProfile);
        response.put("command", ExternalToolSupport.resolveOpenClawCommand(openClawCommand)
                + " browser --browser-profile " + browserProfile + " tabs --json");
        response.put("message", result.success()
                ? "OpenClaw浏览器通路可用"
                : buildOpenClawFailureMessage(result));
        response.put("stdout", truncate(result.stdout(), 2000));
        response.put("stderr", truncate(result.stderr(), 2000));
        return response;
    }

    public Map<String, Object> probe(Map<String, Object> payload) {
        String platform = normalizePlatform(stringValue(payload, "platform", "zhilian"));
        String browserProfile = normalizeProfile(stringValue(payload, "profile", defaultProfile));
        Map<String, Object> config = mapValue(payload, "config");
        String keyword = firstKeyword(config.get("keywords"));
        String searchUrl = buildSearchUrl(platform, keyword, config);
        int detailLimit = intValue(payload, "detailLimit", defaultDetailLimit);

        CommandResult openResult = runOpenClaw(List.of(
                "browser",
                "--browser-profile",
                browserProfile,
                "open",
                searchUrl,
                "--label",
                "getjobs-" + platform + "-openclaw"
        ), COMMAND_TIMEOUT);
        if (!openResult.success()) {
            return failure(browserProfile, searchUrl, "OpenClaw打开" + platformName(platform) + "搜索页失败", openResult);
        }

        CommandResult waitResult = runOpenClaw(List.of(
                "browser",
                "--browser-profile",
                browserProfile,
                "wait",
                "--text",
                keyword
        ), Duration.ofSeconds(20));
        if (!waitResult.success()) {
            log.info("OpenClaw等待关键词渲染未成功，继续尝试读取页面：{}", waitResult.stderr());
        }

        CommandResult collectResult = evaluate(browserProfile, collectListFunction());
        if (!collectResult.success()) {
            return failure(browserProfile, searchUrl, "OpenClaw读取" + platformName(platform) + "列表失败", collectResult);
        }

        List<ChromeJobDto> jobs = parseJobs(collectResult.stdout(), keyword);
        List<ChromeJobDto> enriched = enrichDetails(browserProfile, jobs, keyword, Math.max(0, Math.min(detailLimit, jobs.size())));

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("success", true);
        response.put("platform", platform);
        response.put("profile", browserProfile);
        response.put("searchUrl", searchUrl);
        response.put("keyword", keyword);
        response.put("received", jobs.size());
        response.put("detailChecked", enriched.size());
        response.put("jobs", enriched);
        response.put("message", "OpenClaw实验采集完成，未执行真实投递");
        return response;
    }

    private List<ChromeJobDto> enrichDetails(String profile, List<ChromeJobDto> jobs, String keyword, int limit) {
        List<ChromeJobDto> enriched = new ArrayList<>(jobs);
        for (int i = 0; i < limit; i++) {
            ChromeJobDto job = enriched.get(i);
            if (job.getUrl() == null || job.getUrl().isBlank()) {
                continue;
            }
            CommandResult openDetail = runOpenClaw(List.of(
                    "browser",
                    "--browser-profile",
                    profile,
                    "navigate",
                    job.getUrl()
            ), COMMAND_TIMEOUT);
            if (!openDetail.success()) {
                log.warn("OpenClaw打开详情失败：{} {}", job.getUrl(), openDetail.stderr());
                continue;
            }

            CommandResult detail = evaluate(profile, detailFunction());
            if (!detail.success()) {
                log.warn("OpenClaw读取详情失败：{} {}", job.getUrl(), detail.stderr());
                continue;
            }
            ChromeJobDto detailJob = parseOneJob(detail.stdout(), keyword);
            if (detailJob != null) {
                mergeJob(job, detailJob);
            }
        }
        return enriched;
    }

    private CommandResult evaluate(String profile, String fn) {
        return runOpenClaw(List.of(
                "browser",
                "--browser-profile",
                profile,
                "--json",
                "evaluate",
                "--timeout-ms",
                "30000",
                "--fn",
                fn
        ), COMMAND_TIMEOUT);
    }

    private CommandResult runOpenClaw(List<String> args, Duration timeout) {
        List<String> command = ExternalToolSupport.buildProcessCommand(
                ExternalToolSupport.resolveOpenClawCommand(openClawCommand),
                args
        );
        ProcessBuilder processBuilder = new ProcessBuilder(command);
        processBuilder.redirectErrorStream(false);
        try {
            Process process = processBuilder.start();
            boolean finished = process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS);
            if (!finished) {
                process.destroyForcibly();
                return new CommandResult(false, -1, "", "OpenClaw命令超时");
            }
            String stdout = readStream(process.inputReader(StandardCharsets.UTF_8));
            String stderr = readStream(process.errorReader(StandardCharsets.UTF_8));
            return new CommandResult(process.exitValue() == 0, process.exitValue(), stdout, stderr);
        } catch (IOException e) {
            return new CommandResult(false, -1, "", e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new CommandResult(false, -1, "", "OpenClaw命令被中断");
        }
    }

    private String readStream(BufferedReader reader) throws IOException {
        StringBuilder out = new StringBuilder();
        try (reader) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!out.isEmpty()) {
                    out.append('\n');
                }
                out.append(line);
            }
        }
        return out.toString();
    }

    private List<ChromeJobDto> parseJobs(String raw, String keyword) {
        JsonNode root = extractJson(raw);
        JsonNode node = unwrapResult(root);
        if (node == null || node.isMissingNode() || node.isNull()) {
            return List.of();
        }
        try {
            if (node.isTextual()) {
                node = mapper.readTree(node.asText());
            }
            List<ChromeJobDto> jobs = mapper.convertValue(node, new TypeReference<>() {});
            jobs.forEach(job -> {
                if (job.getKeyword() == null || job.getKeyword().isBlank()) {
                    job.setKeyword(keyword);
                }
            });
            return jobs;
        } catch (Exception e) {
            log.warn("OpenClaw岗位JSON解析失败：{}", truncate(raw, 500), e);
            return List.of();
        }
    }

    private ChromeJobDto parseOneJob(String raw, String keyword) {
        JsonNode root = extractJson(raw);
        JsonNode node = unwrapResult(root);
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        try {
            if (node.isTextual()) {
                node = mapper.readTree(node.asText());
            }
            ChromeJobDto job = mapper.convertValue(node, ChromeJobDto.class);
            if (job.getKeyword() == null || job.getKeyword().isBlank()) {
                job.setKeyword(keyword);
            }
            return job;
        } catch (Exception e) {
            log.warn("OpenClaw详情JSON解析失败：{}", truncate(raw, 500), e);
            return null;
        }
    }

    private JsonNode extractJson(String raw) {
        if (raw == null || raw.isBlank()) {
            return mapper.missingNode();
        }
        String text = raw.trim();
        try {
            return mapper.readTree(text);
        } catch (Exception ignored) {
            int objectIndex = text.indexOf('{');
            int arrayIndex = text.indexOf('[');
            int start = objectIndex < 0 ? arrayIndex : (arrayIndex < 0 ? objectIndex : Math.min(objectIndex, arrayIndex));
            if (start >= 0) {
                int objectEnd = text.lastIndexOf('}');
                int arrayEnd = text.lastIndexOf(']');
                int end = Math.max(objectEnd, arrayEnd);
                if (end > start) {
                    try {
                        return mapper.readTree(text.substring(start, end + 1));
                    } catch (Exception nested) {
                        return mapper.missingNode();
                    }
                }
            }
            return mapper.missingNode();
        }
    }

    private JsonNode unwrapResult(JsonNode root) {
        if (root == null || root.isMissingNode()) {
            return mapper.missingNode();
        }
        if (root.has("result")) return root.get("result");
        if (root.has("value")) return root.get("value");
        if (root.has("data")) return root.get("data");
        return root;
    }

    private void mergeJob(ChromeJobDto target, ChromeJobDto source) {
        if (source == null) return;
        if (isBlank(target.getTitle())) target.setTitle(source.getTitle());
        if (isBlank(target.getCompany())) target.setCompany(source.getCompany());
        if (isBlank(target.getSalary())) target.setSalary(source.getSalary());
        if (isBlank(target.getLocation())) target.setLocation(source.getLocation());
        if (isBlank(target.getExperience())) target.setExperience(source.getExperience());
        if (isBlank(target.getDegree())) target.setDegree(source.getDegree());
        if (isBlank(target.getHrName())) target.setHrName(source.getHrName());
        if (isBlank(target.getHrTitle())) target.setHrTitle(source.getHrTitle());
        if (isBlank(target.getHrActive())) target.setHrActive(source.getHrActive());
        if (!isBlank(source.getDescription())) target.setDescription(source.getDescription());
        if (isBlank(target.getRecruitmentStatus())) target.setRecruitmentStatus(source.getRecruitmentStatus());
        if (isBlank(target.getCompanyAddress())) target.setCompanyAddress(source.getCompanyAddress());
        if (isBlank(target.getIndustry())) target.setIndustry(source.getIndustry());
        if (isBlank(target.getCompanyInfo())) target.setCompanyInfo(source.getCompanyInfo());
        if (isBlank(target.getFinancingStage())) target.setFinancingStage(source.getFinancingStage());
        if (isBlank(target.getCompanyScale())) target.setCompanyScale(source.getCompanyScale());
        if (isBlank(target.getUserId())) target.setUserId(source.getUserId());
    }

    private String buildSearchUrl(String platform, String keyword, Map<String, Object> config) {
        if ("zhilian".equals(platform)) {
            return buildZhilianSearchUrl(keyword, config);
        }
        return buildBossSearchUrl(keyword, config);
    }

    private String buildBossSearchUrl(String keyword, Map<String, Object> config) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("city", firstListValue(config.getOrDefault("cityCode", "101280600")));
        putIfNotBlank(params, "jobType", stringValue(config, "jobType", ""));
        putList(params, "salary", config.get("salary"));
        putList(params, "experience", config.get("experience"));
        putList(params, "degree", config.get("degree"));
        putList(params, "scale", config.get("scale"));
        putList(params, "industry", config.get("industry"));
        putList(params, "stage", config.get("stage"));
        params.put("query", keyword);

        StringBuilder query = new StringBuilder();
        params.forEach((key, value) -> {
            if (!query.isEmpty()) query.append('&');
            query.append(URLEncoder.encode(key, StandardCharsets.UTF_8));
            query.append('=');
            query.append(URLEncoder.encode(value, StandardCharsets.UTF_8));
        });
        return "https://www.zhipin.com/web/geek/job?" + query;
    }

    private String buildZhilianSearchUrl(String keyword, Map<String, Object> config) {
        String city = firstListValue(config.getOrDefault("cityCode", ""));
        StringBuilder query = new StringBuilder();
        appendParam(query, "kw", keyword);
        if (!city.isBlank()) {
            appendParam(query, "cityId", city);
        }
        String salary = Objects.toString(config.getOrDefault("salary", ""), "").trim();
        if (!salary.isBlank()) {
            appendParam(query, "salary", salary);
        }
        return "https://www.zhaopin.com/sou/jl" + (city.isBlank() ? "" : city) + "/kw" +
                URLEncoder.encode(keyword, StandardCharsets.UTF_8) +
                "?kt=3" + (query.isEmpty() ? "" : "&" + query);
    }

    private void appendParam(StringBuilder query, String key, String value) {
        if (value == null || value.isBlank()) return;
        if (!query.isEmpty()) query.append('&');
        query.append(URLEncoder.encode(key, StandardCharsets.UTF_8));
        query.append('=');
        query.append(URLEncoder.encode(value, StandardCharsets.UTF_8));
    }

    private void putList(Map<String, String> params, String key, Object raw) {
        List<String> values = toList(raw);
        if (!values.isEmpty()) {
            params.put(key, String.join(",", values));
        }
    }

    private void putIfNotBlank(Map<String, String> params, String key, String value) {
        if (value != null && !value.isBlank()) {
            params.put(key, value);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> mapValue(Map<String, Object> payload, String key) {
        if (payload == null) {
            return new HashMap<>();
        }
        Object value = payload.get(key);
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> out = new HashMap<>();
            map.forEach((k, v) -> out.put(String.valueOf(k), v));
            return out;
        }
        return new HashMap<>();
    }

    private List<String> toList(Object raw) {
        if (raw == null) return List.of();
        if (raw instanceof List<?> list) {
            return list.stream().map(Objects::toString).map(String::trim).filter(item -> !item.isBlank()).toList();
        }
        String value = Objects.toString(raw, "").trim();
        if (value.isBlank()) return List.of();
        if (value.startsWith("[") && value.endsWith("]")) {
            value = value.substring(1, value.length() - 1);
        }
        String[] parts = value.split(",");
        List<String> out = new ArrayList<>();
        for (String part : parts) {
            String item = part.trim().replaceAll("^\"|\"$", "");
            if (!item.isBlank()) out.add(item);
        }
        return out;
    }

    private String firstKeyword(Object raw) {
        List<String> values = toList(raw);
        return values.isEmpty() ? "AI产品运营" : values.get(0);
    }

    private String firstListValue(Object raw) {
        List<String> values = toList(raw);
        return values.isEmpty() ? Objects.toString(raw, "101280600") : values.get(0);
    }

    private String stringValue(Map<String, Object> payload, String key, String fallback) {
        if (payload == null) return fallback;
        Object value = payload.get(key);
        return value == null || String.valueOf(value).isBlank() ? fallback : String.valueOf(value);
    }

    private int intValue(Map<String, Object> payload, String key, int fallback) {
        if (payload == null) return fallback;
        Object value = payload.get(key);
        if (value instanceof Number number) return number.intValue();
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private String normalizeProfile(String profile) {
        return profile == null || profile.isBlank() ? defaultProfile : profile.trim();
    }

    private String normalizePlatform(String platform) {
        if ("boss".equalsIgnoreCase(platform)) return "boss";
        return "zhilian";
    }

    private String platformName(String platform) {
        return "boss".equals(platform) ? "Boss" : "智联招聘";
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private Map<String, Object> failure(String profile, String searchUrl, String message, CommandResult result) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("success", false);
        response.put("profile", profile);
        response.put("searchUrl", searchUrl);
        response.put("message", message + "：" + buildOpenClawFailureMessage(result));
        response.put("stdout", truncate(result.stdout(), 2000));
        response.put("stderr", truncate(result.stderr(), 2000));
        return response;
    }

    private String buildOpenClawFailureMessage(CommandResult result) {
        return ExternalToolSupport.buildOpenClawFailureMessage(result.stdout(), result.stderr(), result.exitCode());
    }

    private String truncate(String value, int max) {
        if (value == null) return "";
        return value.length() <= max ? value : value.substring(0, max) + "...";
    }

    private String collectListFunction() {
        return """
                () => {
                  const compact = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
                  const textOf = (root, selectors) => {
                    for (const selector of selectors) {
                      const node = root.querySelector(selector);
                      const text = compact(node?.innerText || node?.textContent || '');
                      if (text) return text;
                    }
                    return '';
                  };
                  const idOf = (url) => {
                    const match = String(url || '').match(/\\/job_detail\\/([^/?#]+)/);
                    return match ? match[1] : '';
                  };
                  const cardRoot = (node) => node.closest?.('.job-card-wrapper, .job-primary, li, [class*="job-card"]') || node;
                  const nodes = Array.from(document.querySelectorAll('a[href*="/job_detail/"]'))
                    .map(cardRoot)
                    .filter((node, index, list) => node && list.indexOf(node) === index)
                    .slice(0, 20);
                  return JSON.stringify(nodes.map((root) => {
                    const link = root.querySelector('a[href*="/job_detail/"]') || (root.matches?.('a[href*="/job_detail/"]') ? root : null);
                    const url = link ? new URL(link.getAttribute('href'), window.location.origin).href : '';
                    const text = compact(root.innerText || root.textContent || '');
                    return {
                      id: idOf(url),
                      title: textOf(root, ['.job-name', '.job-title', '[class*="job-name"]', 'a[href*="/job_detail/"]']) || text.split(' ')[0] || '',
                      company: textOf(root, ['.company-name', '[class*="company-name"]', '.boss-name', '[class*="brand-name"]']),
                      salary: textOf(root, ['.salary', '.job-salary', '[class*="salary"]']),
                      location: textOf(root, ['.job-area', '.company-location', '[class*="location"]']),
                      hrName: textOf(root, ['.boss-name', '[class*="boss-name"]']),
                      description: text,
                      url
                    };
                  }).filter((job) => job.title && job.company && job.url));
                }
                """;
    }

    private String detailFunction() {
        return """
                () => {
                  const compact = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
                  const textOf = (selectors) => {
                    for (const selector of selectors) {
                      const node = document.querySelector(selector);
                      const text = compact(node?.innerText || node?.textContent || '');
                      if (text) return text;
                    }
                    return '';
                  };
                  const idOf = (url) => {
                    const match = String(url || '').match(/\\/job_detail\\/([^/?#]+)/);
                    return match ? match[1] : '';
                  };
                  const description = textOf([
                    '.job-detail-section .text',
                    '.job-detail-section',
                    '.job-description',
                    '.job-sec .job-sec-text',
                    '.job-sec .text',
                    '.job-sec-text',
                    '[class*="job-detail"]'
                  ]);
                  return JSON.stringify({
                    id: idOf(location.href),
                    title: textOf(['.job-name', '.job-title', '[class*="job-name"]', 'h1']),
                    company: textOf(['.company-name', '[class*="company-name"]', '[class*="brand-name"]']),
                    salary: textOf(['.salary', '.job-salary', '[class*="salary"]']),
                    location: textOf(['.job-area', '.location-address', '[class*="location"]']),
                    experience: textOf(['.job-tags span:nth-child(1)', '.tag-list span:nth-child(1)']),
                    degree: textOf(['.job-tags span:nth-child(2)', '.tag-list span:nth-child(2)']),
                    hrName: textOf(['.boss-name', '[class*="boss-name"]']),
                    hrTitle: textOf(['.boss-title', '[class*="boss-title"]']),
                    description,
                    url: location.href,
                    companyAddress: textOf(['.location-address', '[class*="address"]']),
                    industry: textOf(['.industry', '[class*="industry"]']),
                    companyInfo: textOf(['.company-info', '[class*="company-info"]']),
                    financingStage: textOf(['.stage', '[class*="stage"]']),
                    companyScale: textOf(['.scale', '[class*="scale"]'])
                  });
                }
                """;
    }

    private record CommandResult(boolean success, int exitCode, String stdout, String stderr) {}
}
