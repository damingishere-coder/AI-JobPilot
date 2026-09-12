package com.getjobs.application.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.Objects;

/** Shared by AI generation and the final, user-visible greeting. */
@Component
public class GreetingPolicy {
    public static final int MAX_CHARACTERS = 150;
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
        String instruction = "招呼语正文不超过150个Unicode字符，正文中的标点和空格计入字数；150是上限，不必凑满。参考模板如有旧字数或结构要求，以本规则为准。"
                + "根据当前岗位JD选择候选人最有分量的一项真实匹配亮点，优先具体行动和有依据的成果，不罗列履历。"
                + "开头灵活，可以从亮点、相关经历或对岗位的具体关注切入，不套用固定顺序，不逐句复述岗位要求。"
                + "用本人向HR打招呼的自然口吻，避免分析报告腔、夸大承诺和套话；结尾留一个与工作有关、容易回应的交流入口。"
                + "岗位定制体现在亮点选择和交流切入点，不要求出现‘岗位要求’等固定措辞。只依据简历与岗位资料，不虚构经历或成果。";
        String url = urlFor(profileId);
        if (!url.isEmpty()) {
            instruction += "只生成正文，不生成作品推荐语或网址；系统会在末尾单独附上个人作品集推荐及网址 " + url
                    + "，该末尾推荐部分不占正文150字额度。"
                    + "只依据已提供的简历与岗位资料，不推测网站内容，不把个人作品描述成任职或商业成果。";
        }
        return instruction + "\n";
    }

    public static int count(String text) {
        return text.codePointCount(0, text.length());
    }

    public String portfolioSuffix(Long profileId) {
        String url = urlFor(profileId);
        return url.isEmpty() ? "" : "个人作品集：" + url;
    }

    public String body(String text, Long profileId) {
        String value = text == null ? "" : text.trim();
        String suffix = portfolioSuffix(profileId);
        return !suffix.isEmpty() && value.endsWith(suffix)
                ? value.substring(0, value.length() - suffix.length()).stripTrailing() : value;
    }

    public boolean isValid(String text, Long profileId) {
        if (text == null || text.isBlank() || body(text, profileId).isBlank()
                || count(body(text, profileId)) > MAX_CHARACTERS) return false;
        String url = urlFor(profileId);
        return url.isEmpty() || (text.contains(url) && text.indexOf(url) == text.lastIndexOf(url));
    }

    /** Preserve stored originals; only adapt the final preview, without new AI calls. */
    public String prepare(String original, Long profileId) {
        String text = original == null ? "" : original.trim();
        if (text.isEmpty()) return text;
        String url = urlFor(profileId);
        String suffix = portfolioSuffix(profileId);
        if (isValid(text, profileId) && (suffix.isEmpty() || text.endsWith(suffix))) return text;
        if (!url.isEmpty()) {
            text = text.replaceAll("(?:也附上个人作品集，供您了解我的实践[：:]?\\s*|(?:个人)?作品集[：:]\\s*)" + java.util.regex.Pattern.quote(url), "")
                    .replace(url, "").replaceAll("[，。；]{2,}", "。").trim();
        }
        int budget = MAX_CHARACTERS;
        // Keep complete clauses. Never cut a URL, surrogate pair, or an unfinished claim.
        StringBuilder prefix = new StringBuilder();
        for (String clause : text.split("(?<=[，。！？；\\n])")) {
            if (count(prefix + clause) > budget) break;
            prefix.append(clause);
        }
        if (count(text) <= budget) prefix = new StringBuilder(text);
        String body = prefix.toString().stripTrailing();
        if (!body.isEmpty() && !body.matches("(?s).*[，。！？；：]$")) {
            if (count(body) < budget) body += "。";
        }
        if (body.isEmpty()) body = url.isEmpty() ? "您好，希望有机会进一步沟通。" : "您好，供您了解我的实践。";
        return body + (suffix.isEmpty() ? "" : "\n" + suffix);
    }

    /** Manual changes must be reviewable and may not be silently shortened. */
    public void validateDraft(String text, Long profileId) {
        if (!isValid(text, profileId)) {
            throw new IllegalArgumentException("话术正文不能为空且不能超过150个字符（含正文标点和空格）；末尾个人作品集推荐及网址不占正文额度"
                    + (urlFor(profileId).isEmpty() ? "" : "，且必须包含一次完整作品集网址：" + urlFor(profileId)));
        }
    }
}
