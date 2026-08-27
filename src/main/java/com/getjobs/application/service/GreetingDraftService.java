package com.getjobs.application.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.getjobs.application.entity.BossConfigEntity;
import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.entity.Job51Entity;
import com.getjobs.application.entity.JobAiAnalysisEntity;
import com.getjobs.application.entity.JobGreetingDraftEntity;
import com.getjobs.application.entity.LiepinEntity;
import com.getjobs.application.entity.ZhilianJobDataEntity;
import com.getjobs.application.mapper.JobAiAnalysisMapper;
import com.getjobs.application.mapper.JobGreetingDraftMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Locale;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class GreetingDraftService {
    public static final String USER_EDITED = "USER_EDITED";
    public static final String AI_GREETING = "AI_GREETING";
    public static final String PROFILE_DEFAULT = "PROFILE_DEFAULT";
    public static final String EMPTY = "EMPTY";

    private final ProfileService profileService;
    private final BossService bossService;
    private final ZhilianService zhilianService;
    private final LiepinService liepinService;
    private final Job51Service job51Service;
    private final JobAiAnalysisMapper jobAiAnalysisMapper;
    private final JobGreetingDraftMapper jobGreetingDraftMapper;

    public GreetingView resolveForJob(String platform, Long jobRowId) {
        JobIdentity identity = resolveIdentity(platform, jobRowId);
        return resolve(identity);
    }

    public GreetingView resolve(String platform, String jobKey) {
        Long profileId = profileService.getCurrentProfileId();
        return resolve(new JobIdentity(profileId, normalizePlatform(platform), normalizeJobKey(jobKey)));
    }

    @Transactional
    public GreetingView save(String platform, Long jobRowId, String content, String expectedUpdatedAt) {
        JobIdentity identity = resolveIdentity(platform, jobRowId);
        String normalizedContent = content == null ? "" : content.trim();
        if (normalizedContent.isEmpty()) {
            throw new IllegalArgumentException("沟通草稿不能为空；如需恢复 AI 原稿，请使用恢复操作");
        }
        if (normalizedContent.length() > 1000) {
            throw new IllegalArgumentException("沟通草稿不能超过 1000 个字符");
        }

        JobGreetingDraftEntity current = findDraft(identity);
        assertExpectedTimestamp(current, expectedUpdatedAt);
        LocalDateTime now = LocalDateTime.now();
        if (current == null) {
            JobGreetingDraftEntity created = new JobGreetingDraftEntity();
            created.setProfileId(identity.profileId());
            created.setPlatform(identity.platform());
            created.setJobKey(identity.jobKey());
            created.setContent(normalizedContent);
            created.setVersion(1);
            created.setCreatedAt(now);
            created.setUpdatedAt(now);
            try {
                if (jobGreetingDraftMapper.insert(created) != 1) {
                    throw new IllegalStateException("沟通草稿保存失败");
                }
            } catch (RuntimeException e) {
                if (findDraft(identity) != null) {
                    throw new StaleDraftException("草稿已被其他页面创建，请刷新后重试");
                }
                throw e;
            }
        } else {
            JobGreetingDraftEntity update = new JobGreetingDraftEntity();
            update.setContent(normalizedContent);
            update.setVersion(current.getVersion() + 1);
            update.setUpdatedAt(now);
            UpdateWrapper<JobGreetingDraftEntity> wrapper = new UpdateWrapper<>();
            wrapper.eq("id", current.getId()).eq("version", current.getVersion());
            if (jobGreetingDraftMapper.update(update, wrapper) != 1) {
                throw new StaleDraftException("草稿已被其他页面更新，请刷新后重试");
            }
        }
        return resolve(identity);
    }

    @Transactional
    public GreetingView reset(String platform, Long jobRowId, String expectedUpdatedAt) {
        JobIdentity identity = resolveIdentity(platform, jobRowId);
        JobGreetingDraftEntity current = findDraft(identity);
        assertExpectedTimestamp(current, expectedUpdatedAt);
        if (current != null && jobGreetingDraftMapper.deleteById(current.getId()) != 1) {
            throw new StaleDraftException("草稿已被其他页面更新，请刷新后重试");
        }
        return resolve(identity);
    }

    private GreetingView resolve(JobIdentity identity) {
        JobGreetingDraftEntity draft = findDraft(identity);
        JobAiAnalysisEntity ai = findLatestAi(identity);
        String aiGreeting = trimToNull(ai == null ? null : ai.getGreeting());
        String draftContent = trimToNull(draft == null ? null : draft.getContent());
        String profileDefault = trimToNull(defaultGreeting());

        String source;
        String finalGreeting;
        if (draftContent != null) {
            source = USER_EDITED;
            finalGreeting = draftContent;
        } else if (aiGreeting != null) {
            source = AI_GREETING;
            finalGreeting = aiGreeting;
        } else if (profileDefault != null) {
            source = PROFILE_DEFAULT;
            finalGreeting = profileDefault;
        } else {
            source = EMPTY;
            finalGreeting = "";
        }
        return new GreetingView(
                aiGreeting == null ? "" : aiGreeting,
                draftContent == null ? "" : draftContent,
                source,
                draft == null ? null : draft.getUpdatedAt(),
                finalGreeting
        );
    }

    private JobIdentity resolveIdentity(String rawPlatform, Long jobRowId) {
        if (jobRowId == null) throw new IllegalArgumentException("岗位 ID 不能为空");
        long profileId = profileService.getCurrentProfileId();
        String platform = normalizePlatform(rawPlatform);
        String jobKey;
        switch (platform) {
            case "boss" -> {
                BossJobDataEntity job = bossService.getBossJobById(jobRowId);
                requireProfile(job == null ? null : job.getProfileId(), profileId);
                jobKey = firstNonBlank(job == null ? null : job.getEncryptId(), String.valueOf(jobRowId));
            }
            case "zhilian" -> {
                ZhilianJobDataEntity job = zhilianService.getZhilianJobById(jobRowId);
                requireProfile(job == null ? null : job.getProfileId(), profileId);
                jobKey = firstNonBlank(job == null ? null : job.getJobId(), String.valueOf(jobRowId));
            }
            case "liepin" -> {
                LiepinEntity job = liepinService.getLiepinJobById(jobRowId);
                requireProfile(job == null ? null : job.getProfileId(), profileId);
                jobKey = String.valueOf(job.getJobId());
            }
            case "51job" -> {
                Job51Entity job = job51Service.getJob51ById(jobRowId);
                requireProfile(job == null ? null : job.getProfileId(), profileId);
                jobKey = String.valueOf(job.getJobId());
            }
            default -> throw new IllegalArgumentException("不支持的平台: " + rawPlatform);
        }
        return new JobIdentity(profileId, platform, normalizeJobKey(jobKey));
    }

    private JobGreetingDraftEntity findDraft(JobIdentity identity) {
        QueryWrapper<JobGreetingDraftEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("profile_id", identity.profileId())
                .eq("platform", identity.platform())
                .eq("job_key", identity.jobKey())
                .last("LIMIT 1");
        return jobGreetingDraftMapper.selectOne(wrapper);
    }

    private JobAiAnalysisEntity findLatestAi(JobIdentity identity) {
        QueryWrapper<JobAiAnalysisEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("profile_id", identity.profileId())
                .eq("platform", identity.platform())
                .eq("job_key", identity.jobKey())
                .orderByDesc("created_at")
                .orderByDesc("id")
                .last("LIMIT 1");
        return jobAiAnalysisMapper.selectOne(wrapper);
    }

    private String defaultGreeting() {
        BossConfigEntity config = bossService.getFirstConfig();
        return config == null ? null : config.getSayHi();
    }

    private void assertExpectedTimestamp(JobGreetingDraftEntity current, String expectedUpdatedAt) {
        String expected = trimToNull(expectedUpdatedAt);
        if (current == null) {
            if (expected != null) throw new StaleDraftException("草稿已被恢复或删除，请刷新后重试");
            return;
        }
        String actual = Objects.toString(current.getUpdatedAt(), "");
        if (expected == null || !actual.equals(expected)) {
            throw new StaleDraftException("草稿已被其他页面更新，请刷新后重试");
        }
    }

    private void requireProfile(Long actualProfileId, long expectedProfileId) {
        if (actualProfileId == null || actualProfileId != expectedProfileId) {
            throw new IllegalArgumentException("当前档案下未找到该岗位");
        }
    }

    private String normalizePlatform(String platform) {
        if (platform == null || platform.isBlank()) throw new IllegalArgumentException("平台不能为空");
        return platform.trim().toLowerCase(Locale.ROOT);
    }

    private String normalizeJobKey(String jobKey) {
        if (jobKey == null || jobKey.isBlank()) throw new IllegalArgumentException("岗位标识不能为空");
        return jobKey.trim();
    }

    private String firstNonBlank(String first, String fallback) {
        return first == null || first.isBlank() ? fallback : first.trim();
    }

    private String trimToNull(String value) {
        if (value == null || value.isBlank()) return null;
        return value.trim();
    }

    private record JobIdentity(long profileId, String platform, String jobKey) {
    }

    public record GreetingView(
            String aiGreeting,
            String greetingDraft,
            String greetingSource,
            LocalDateTime greetingUpdatedAt,
            String finalGreeting
    ) {
    }

    public static final class StaleDraftException extends RuntimeException {
        public StaleDraftException(String message) {
            super(message);
        }
    }
}
