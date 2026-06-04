package com.getjobs.application.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.getjobs.application.entity.ProfileEntity;
import com.getjobs.application.mapper.ProfileMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class ProfileService {
    private final DataSource dataSource;
    private final ProfileMapper profileMapper;

    @PostConstruct
    public void ensureProfileSchema() {
        try (Connection conn = dataSource.getConnection(); Statement stmt = conn.createStatement()) {
            stmt.execute("CREATE TABLE IF NOT EXISTS profile (" +
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                    "name TEXT NOT NULL, " +
                    "is_active INTEGER DEFAULT 0, " +
                    "created_at DATETIME, " +
                    "updated_at DATETIME)");

            ensureAiTable(stmt);
            ensureBossConfigTable(stmt);
            ensureZhilianConfigTable(stmt);
            addProfileColumn(stmt, "resume_profile");
            addProfileColumn(stmt, "ai");
            addProfileColumn(stmt, "boss_config");
            addProfileColumn(stmt, "zhilian_config");
            addProfileColumn(stmt, "boss_data");
            addProfileColumn(stmt, "zhilian_data");
            addProfileColumn(stmt, "job_ai_analysis");
            ensurePriorityCompanyTable(stmt);
            normalizeActiveProfile(stmt);
        } catch (Exception e) {
            log.warn("初始化档案表失败: {}", e.getMessage());
        }
    }

    private void ensureAiTable(Statement stmt) throws Exception {
        stmt.execute("CREATE TABLE IF NOT EXISTS ai (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "profile_id INTEGER, " +
                "introduce TEXT, " +
                "prompt TEXT, " +
                "created_at DATETIME, " +
                "updated_at DATETIME)");
    }

    private void ensureBossConfigTable(Statement stmt) throws Exception {
        stmt.execute("CREATE TABLE IF NOT EXISTS boss_config (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "profile_id INTEGER, " +
                "debugger INTEGER DEFAULT 0, " +
                "wait_time INTEGER DEFAULT 10, " +
                "keywords VARCHAR(500), " +
                "city_code VARCHAR(200), " +
                "industry VARCHAR(200), " +
                "job_type VARCHAR(50), " +
                "experience VARCHAR(50), " +
                "degree VARCHAR(200), " +
                "salary VARCHAR(50), " +
                "scale VARCHAR(200), " +
                "stage VARCHAR(200), " +
                "say_hi TEXT, " +
                "expected_salary_min INTEGER, " +
                "expected_salary_max INTEGER, " +
                "enable_ai INTEGER DEFAULT 1, " +
                "send_img_resume INTEGER DEFAULT 0, " +
                "filter_dead_hr INTEGER DEFAULT 1, " +
                "auto_deliver INTEGER DEFAULT 0, " +
                "search_job_limit INTEGER DEFAULT 20, " +
                "dead_status VARCHAR(200), " +
                "created_at DATETIME, " +
                "updated_at DATETIME)");
    }

    private void ensureZhilianConfigTable(Statement stmt) throws Exception {
        stmt.execute("CREATE TABLE IF NOT EXISTS zhilian_config (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "profile_id INTEGER, " +
                "keywords VARCHAR(500), " +
                "city_code VARCHAR(200), " +
                "salary VARCHAR(50), " +
                "search_job_limit INTEGER DEFAULT 20, " +
                "created_at DATETIME, " +
                "updated_at DATETIME)");
    }

    private void addProfileColumn(Statement stmt, String table) {
        try {
            stmt.execute("ALTER TABLE " + table + " ADD COLUMN profile_id INTEGER");
        } catch (Exception ignored) {
        }
    }

    private void ensurePriorityCompanyTable(Statement stmt) throws Exception {
        stmt.execute("CREATE TABLE IF NOT EXISTS priority_company (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "profile_id INTEGER, " +
                "company_name TEXT NOT NULL, " +
                "enabled INTEGER DEFAULT 1, " +
                "remark TEXT, " +
                "created_at DATETIME, " +
                "updated_at DATETIME, " +
                "UNIQUE(profile_id, company_name))");

        boolean needsRebuild = false;
        boolean hasProfileId = false;
        try (ResultSet rs = stmt.executeQuery("PRAGMA table_info('priority_company')")) {
            while (rs.next()) {
                if ("profile_id".equalsIgnoreCase(rs.getString("name"))) {
                    hasProfileId = true;
                    break;
                }
            }
            needsRebuild = !hasProfileId;
        }
        try (ResultSet rs = stmt.executeQuery("SELECT sql FROM sqlite_master WHERE type='table' AND name='priority_company'")) {
            if (rs.next()) {
                String sql = rs.getString("sql");
                if (sql != null && sql.toUpperCase().contains("COMPANY_NAME TEXT NOT NULL UNIQUE")) {
                    needsRebuild = true;
                }
            }
        }

        if (!needsRebuild) {
            addProfileColumn(stmt, "priority_company");
            try {
                stmt.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_priority_company_profile_name " +
                        "ON priority_company(profile_id, company_name)");
            } catch (Exception ignored) {
            }
            return;
        }

        stmt.execute("CREATE TABLE IF NOT EXISTS priority_company_profile_new (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "profile_id INTEGER, " +
                "company_name TEXT NOT NULL, " +
                "enabled INTEGER DEFAULT 1, " +
                "remark TEXT, " +
                "created_at DATETIME, " +
                "updated_at DATETIME, " +
                "UNIQUE(profile_id, company_name))");
        String profileExpr = hasProfileId ? "profile_id" : "NULL";
        stmt.executeUpdate("INSERT OR IGNORE INTO priority_company_profile_new " +
                "(id, profile_id, company_name, enabled, remark, created_at, updated_at) " +
                "SELECT id, " + profileExpr + ", company_name, enabled, remark, created_at, updated_at " +
                "FROM priority_company");
        stmt.execute("DROP TABLE priority_company");
        stmt.execute("ALTER TABLE priority_company_profile_new RENAME TO priority_company");
    }

    private void normalizeActiveProfile(Statement stmt) {
        try (ResultSet rs = stmt.executeQuery("SELECT id FROM profile WHERE is_active = 1 ORDER BY id ASC LIMIT 1")) {
            Long activeId = rs.next() ? rs.getLong("id") : null;
            if (activeId == null) {
                try (ResultSet first = stmt.executeQuery("SELECT id FROM profile ORDER BY id ASC LIMIT 1")) {
                    activeId = first.next() ? first.getLong("id") : null;
                }
            }
            if (activeId == null) {
                return;
            }
            stmt.executeUpdate("UPDATE profile SET is_active = CASE WHEN id = " + activeId + " THEN 1 ELSE 0 END");
        } catch (Exception e) {
            log.warn("规范化当前档案失败: {}", e.getMessage());
        }
    }

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
