package com.getjobs.application.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.getjobs.application.entity.ProfileEntity;
import com.getjobs.application.mapper.ProfileMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@DependsOn("databaseSchemaService")
public class ProfileService {
    private static final List<String> PROFILE_RELATED_TABLES = List.of(
            "ai",
            "resume_profile",
            "boss_config",
            "zhilian_config",
            "boss_data",
            "zhilian_data",
            "job_ai_analysis",
            "priority_company"
    );

    private final ProfileMapper profileMapper;
    private final JdbcTemplate jdbcTemplate;

    @Transactional(readOnly = true)
    public List<ProfileEntity> listProfiles() {
        return profileMapper.selectList(new QueryWrapper<ProfileEntity>().orderByAsc("id"));
    }

    @Transactional(readOnly = true)
    public ProfileEntity getCurrentProfile() {
        ProfileEntity active = profileMapper.selectOne(new QueryWrapper<ProfileEntity>()
                .eq("is_active", 1)
                .orderByAsc("id")
                .last("LIMIT 1"));
        if (active != null) {
            return active;
        }
        List<ProfileEntity> all = listProfiles();
        return all.isEmpty() ? null : all.get(0);
    }

    public Long getCurrentProfileId() {
        ProfileEntity current = getCurrentProfile();
        if (current == null || current.getId() == null) {
            throw new IllegalStateException("请先在简历配置页新建档案");
        }
        return current.getId();
    }

    @Transactional(readOnly = true)
    public Long getCurrentProfileIdOrNull() {
        ProfileEntity current = getCurrentProfile();
        return current == null ? null : current.getId();
    }

    @Transactional(readOnly = true)
    public boolean hasProfiles() {
        Long count = profileMapper.selectCount(null);
        return count != null && count > 0;
    }

    @Transactional
    public ProfileEntity createProfile(String name) {
        String normalized = normalizeName(name);
        LocalDateTime now = LocalDateTime.now();
        ProfileEntity entity = new ProfileEntity();
        entity.setName(normalized);
        entity.setIsActive(hasProfiles() ? 0 : 1);
        entity.setCreatedAt(now);
        entity.setUpdatedAt(now);
        profileMapper.insert(entity);
        return entity;
    }

    @Transactional
    public ProfileEntity renameProfile(Long id, String name) {
        ProfileEntity entity = requireProfile(id);
        entity.setName(normalizeName(name));
        entity.setUpdatedAt(LocalDateTime.now());
        profileMapper.updateById(entity);
        return entity;
    }

    @Transactional
    public ProfileEntity activateProfile(Long id) {
        ProfileEntity entity = requireProfile(id);
        profileMapper.update(null, new UpdateWrapper<ProfileEntity>().set("is_active", 0));
        entity.setIsActive(1);
        entity.setUpdatedAt(LocalDateTime.now());
        profileMapper.updateById(entity);
        return entity;
    }

    @Transactional
    public DeleteProfileResult deleteProfile(Long id, boolean force) {
        ProfileEntity entity = requireProfile(id);
        Long count = profileMapper.selectCount(null);
        if (count == null || count <= 1) {
            return new DeleteProfileResult(
                    false,
                    "至少需要保留一个档案。请先新建并切换到其他档案后再删除。",
                    inspectProfileDeleteImpact(id),
                    getCurrentProfile(),
                    false
            );
        }

        Map<String, Long> impactCounts = inspectProfileDeleteImpact(id);
        long relatedTotal = impactCounts.values().stream().mapToLong(Long::longValue).sum();
        if (!force && relatedTotal > 0) {
            return new DeleteProfileResult(
                    false,
                    "该档案下还有关联数据，已阻止直接删除。确认影响范围后可使用 force=true 强制删除。",
                    impactCounts,
                    getCurrentProfile(),
                    true
            );
        }

        boolean wasActive = entity.getIsActive() != null && entity.getIsActive() == 1;
        if (force) {
            deleteProfileRelatedData(id);
        }
        profileMapper.deleteById(id);
        if (wasActive) {
            activateFirstRemainingProfile();
        }
        return new DeleteProfileResult(
                true,
                force && relatedTotal > 0 ? "档案及关联数据已删除" : "档案已删除",
                impactCounts,
                getCurrentProfile(),
                false
        );
    }

    @Transactional(readOnly = true)
    public Map<String, Long> inspectProfileDeleteImpact(Long id) {
        requireProfile(id);
        Map<String, Long> counts = new LinkedHashMap<>();
        for (String table : PROFILE_RELATED_TABLES) {
            counts.put(table, countByProfileId(table, id));
        }
        return counts;
    }

    private long countByProfileId(String table, Long profileId) {
        Long count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE profile_id = ?",
                Long.class,
                profileId
        );
        return count == null ? 0 : count;
    }

    private void deleteProfileRelatedData(Long profileId) {
        for (String table : PROFILE_RELATED_TABLES) {
            jdbcTemplate.update("DELETE FROM " + table + " WHERE profile_id = ?", profileId);
        }
    }

    private void activateFirstRemainingProfile() {
        ProfileEntity next = profileMapper.selectOne(new QueryWrapper<ProfileEntity>()
                .orderByAsc("id")
                .last("LIMIT 1"));
        if (next == null || next.getId() == null) {
            return;
        }
        profileMapper.update(null, new UpdateWrapper<ProfileEntity>().set("is_active", 0));
        next.setIsActive(1);
        next.setUpdatedAt(LocalDateTime.now());
        profileMapper.updateById(next);
    }

    private ProfileEntity requireProfile(Long id) {
        if (id == null) {
            throw new IllegalArgumentException("档案ID不能为空");
        }
        ProfileEntity entity = profileMapper.selectById(id);
        if (entity == null) {
            throw new IllegalArgumentException("档案不存在: " + id);
        }
        return entity;
    }

    private String normalizeName(String name) {
        String normalized = name == null ? "" : name.trim();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("档案名称不能为空");
        }
        if (normalized.length() > 40) {
            normalized = normalized.substring(0, 40);
        }
        return normalized;
    }

    public record DeleteProfileResult(
            boolean success,
            String message,
            Map<String, Long> impactCounts,
            ProfileEntity current,
            boolean forceRequired
    ) {
        public long totalRelatedCount() {
            return impactCounts == null ? 0 : impactCounts.values().stream().mapToLong(Long::longValue).sum();
        }
    }
}
