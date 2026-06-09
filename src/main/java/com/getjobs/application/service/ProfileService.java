package com.getjobs.application.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.getjobs.application.entity.ProfileEntity;
import com.getjobs.application.mapper.ProfileMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.context.annotation.DependsOn;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
@DependsOn("databaseSchemaService")
public class ProfileService {
    private final ProfileMapper profileMapper;

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
    public void deleteProfile(Long id) {
        ProfileEntity entity = requireProfile(id);
        Long count = profileMapper.selectCount(null);
        boolean wasActive = entity.getIsActive() != null && entity.getIsActive() == 1;
        profileMapper.deleteById(id);
        if (wasActive) {
            ProfileEntity next = profileMapper.selectOne(new QueryWrapper<ProfileEntity>()
                    .orderByAsc("id")
                    .last("LIMIT 1"));
            if (next != null) {
                activateProfile(next.getId());
            }
        }
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
}
