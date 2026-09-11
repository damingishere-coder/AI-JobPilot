package com.getjobs.application.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.Objects;

/** Shared by AI generation and the final, user-visible greeting. */
@Component
public class GreetingPolicy {
    public static final int MAX_CHARACTERS = 100;
    private final String portfolioUrl;
    private final Long portfolioProfileId;

    public GreetingPolicy(@Value("${greeting.portfolio-url:}") String portfolioUrl,
                          @Value("${greeting.portfolio-profile-id:0}") Long portfolioProfileId) {
        this.portfolioUrl = portfolioUrl == null ? "" : portfolioUrl.trim();
        this.portfolioProfileId = portfolioProfileId;
        if (!this.portfolioUrl.isEmpty()) {
            URI uri = URI.create(this.portfolioUrl);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                    || uri.getUserInfo() != null || count(this.portfolioUrl) > 60
                    || portfolioProfileId == null || portfolioProfileId <= 0) {
                throw new IllegalArgumentException("作品集须配置有效 HTTPS 网址（最多60字符）和所属档案 ID");
            }
        }
    }

    public String urlFor(Long profileId) {
        return Objects.equals(portfolioProfileId, profileId) ? portfolioUrl : "";
    }

    public String instruction(Long profileId) {
        String instruction = "整条招呼语不超过100个Unicode字符，正文、推荐语、完整网址、标点、空格均计入总数。"
                + "根据当前岗位JD选择一项真实匹配经历，简洁自然，不虚构经历或成果。";
        String url = urlFor(profileId);
        if (!url.isEmpty()) {
            instruction += "必须完整包含一次个人作品集网址 " + url
                    + " 。按‘岗位需求→真实匹配经历→个人作品集’自然衔接；关联较弱时用‘也附上个人作品集，供您了解我的实践’。"
                    + "只依据已提供的简历与岗位资料，不推测网站内容，不把个人作品描述成任职或商业成果。";
        }
        return instruction + "\n";
    }

    public static int count(String text) {
        return text.codePointCount(0, text.length());
    }

    public boolean isValid(String text, Long profileId) {
        if (text == null || text.isBlank() || count(text) > MAX_CHARACTERS) return false;
        String url = urlFor(profileId);
        return url.isEmpty() || (text.contains(url) && text.indexOf(url) == text.lastIndexOf(url));
    }

    /** Preserve stored originals; only adapt the final preview, without new AI calls. */
    public String prepare(String original, Long profileId) {
        String text = original == null ? "" : original.trim();
        if (text.isEmpty() || isValid(text, profileId)) return text;
        String url = urlFor(profileId);
        String suffix = url.isEmpty() ? "" : "个人作品集：" + url;
        if (!url.isEmpty()) {
            text = text.replaceAll("(?:个人)?作品集[：:]\\s*" + java.util.regex.Pattern.quote(url), "")
                    .replace(url, "").replaceAll("[，。；]{2,}", "。").trim();
        }
        int budget = MAX_CHARACTERS - count(suffix);
        // Keep complete clauses. Never cut a URL, surrogate pair, or an unfinished claim.
        StringBuilder prefix = new StringBuilder();
        for (String clause : text.split("(?<=[，。！？；\\n])")) {
            if (count(prefix + clause) > budget) break;
            prefix.append(clause);
        }
        if (count(text) <= budget) prefix = new StringBuilder(text);
        String body = prefix.toString().stripTrailing();
        if (!body.isEmpty() && !body.matches("(?s).*[，。！？；：]$")) {
            if (count(body) + 1 > budget) body = "";
            else body += "。";
        }
        if (body.isEmpty()) body = url.isEmpty() ? "您好，希望有机会进一步沟通。" : "您好，供您了解我的实践。";
        return body + suffix;
    }

    /** Manual changes must be reviewable and may not be silently shortened. */
    public void validateDraft(String text, Long profileId) {
        if (!isValid(text, profileId)) {
            throw new IllegalArgumentException("整条话术（含正文、作品推荐、完整网址、标点和空格）不能超过100个字符"
                    + (urlFor(profileId).isEmpty() ? "" : "，且必须包含一次完整作品集网址：" + urlFor(profileId)));
        }
    }
}
