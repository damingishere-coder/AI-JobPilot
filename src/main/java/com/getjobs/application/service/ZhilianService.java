package com.getjobs.application.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.getjobs.application.entity.ZhilianConfigEntity;
import com.getjobs.application.entity.ZhilianOptionEntity;
import com.getjobs.application.entity.ZhilianJobDataEntity;
import com.getjobs.application.mapper.ZhilianConfigMapper;
import com.getjobs.application.mapper.ZhilianOptionMapper;
import com.getjobs.application.mapper.ZhilianJobDataMapper;
import com.getjobs.worker.zhilian.ZhilianConfig;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.context.annotation.DependsOn;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.Statement;
import java.util.*;
import java.util.stream.Collectors;

@Service
@Slf4j
@RequiredArgsConstructor
@DependsOn("databaseSchemaService")
public class ZhilianService {
    public static final int DEFAULT_SEARCH_JOB_LIMIT = 20;
    public static final int MIN_SEARCH_JOB_LIMIT = 1;
    public static final int MAX_SEARCH_JOB_LIMIT = 200;
    public static final String DEFAULT_CITY_CODE = "489";
    public static final String DEFAULT_SALARY_CODE = "0000,9999999";

    private final ZhilianConfigMapper zhilianConfigMapper;
    private final ZhilianOptionMapper zhilianOptionMapper;
    private final ZhilianJobDataMapper zhilianJobDataMapper;
    private final DataSource dataSource;
    private final ProfileService profileService;

    public Long getCurrentProfileId() {
        return profileService.getCurrentProfileId();
    }

    /** 获取第一条配置（通常只有一条） */
    public ZhilianConfigEntity getFirstConfig() {
        Long profileId = profileService.getCurrentProfileIdOrNull();
        if (profileId == null) return null;
        QueryWrapper<ZhilianConfigEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("profile_id", profileId);
        wrapper.orderByAsc("id");
        wrapper.last("LIMIT 1");
        return zhilianConfigMapper.selectOne(wrapper);
    }

    /** 从专表构建 ZhilianConfig */
    public ZhilianConfig loadZhilianConfig() {
        ZhilianConfigEntity entity = getFirstConfig();
        ZhilianConfig config = new ZhilianConfig();
        if (entity == null) {
            log.warn("zhilian_config 表为空，使用默认空配置");
            config.setKeywords(new ArrayList<>());
            config.setCityCode(DEFAULT_CITY_CODE);
            config.setSalary(DEFAULT_SALARY_CODE);
            config.setSearchJobLimit(DEFAULT_SEARCH_JOB_LIMIT);
            return config;
        }

        // 关键词解析：支持逗号或括号列表
        config.setKeywords(parseListString(entity.getKeywords()));
        config.setSearchJobLimit(normalizeSearchJobLimit(entity.getSearchJobLimit()));
        config.setCityCode(normalizeCityCode(entity.getCityCode()));
        config.setSalary(normalizeSalaryCode(entity.getSalary()));
        return config;
    }

    public List<String> parseListString(String raw) {
        if (raw == null || raw.trim().isEmpty()) return new ArrayList<>();
        String s = raw.trim().replace('，', ',');
        if (s.startsWith("[") && s.endsWith("]")) s = s.substring(1, s.length() - 1);
        if (s.trim().isEmpty()) return new ArrayList<>();
        return java.util.Arrays.stream(s.split(","))
                .map(String::trim)
                .map(this::stripWrapperQuotes)
                .filter(str -> !str.isEmpty())
                .collect(Collectors.toList());
    }

    private String safeTrim(String s) { return s == null ? null : s.trim(); }

    private String stripWrapperQuotes(String value) {
        if (value == null || value.length() < 2) return value;
        char first = value.charAt(0);
        char last = value.charAt(value.length() - 1);
        if ((first == '"' && last == '"') || (first == '\'' && last == '\'')) {
            return value.substring(1, value.length() - 1).trim();
        }
        return value;
    }

    /**
     * 选择性更新：若传入 ID 则按 ID 更新；否则更新第一条记录（不存在则插入）
     */
    public ZhilianConfigEntity updateConfig(ZhilianConfigEntity config) {
        if (config == null) return null;
        config.setId(null);
        config.setCityCode(normalizeCityCode(config.getCityCode()));
        config.setSalary(normalizeSalaryCode(config.getSalary()));
        config.setSearchJobLimit(normalizeSearchJobLimit(config.getSearchJobLimit()));
        return saveOrUpdateFirstSelective(config);
    }

    /**
     * 保存或选择性更新第一条记录（仅覆盖非空字段）
     */
    public ZhilianConfigEntity saveOrUpdateFirstSelective(ZhilianConfigEntity incoming) {
        ZhilianConfigEntity first = getFirstConfig();
        java.time.LocalDateTime now = java.time.LocalDateTime.now();
        if (first == null) {
            ZhilianConfigEntity toInsert = new ZhilianConfigEntity();
            toInsert.setProfileId(profileService.getCurrentProfileId());
            toInsert.setKeywords(incoming.getKeywords());
            toInsert.setCityCode(incoming.getCityCode());
            toInsert.setSalary(incoming.getSalary());
            toInsert.setSearchJobLimit(normalizeSearchJobLimit(incoming.getSearchJobLimit()));
            toInsert.setCreatedAt(now);
            toInsert.setUpdatedAt(now);
            zhilianConfigMapper.insert(toInsert);
            return getFirstConfig();
        } else {
            ZhilianConfigEntity toUpdate = new ZhilianConfigEntity();
            toUpdate.setId(first.getId());
            toUpdate.setProfileId(profileService.getCurrentProfileId());
            if (incoming.getKeywords() != null) toUpdate.setKeywords(incoming.getKeywords());
            if (incoming.getCityCode() != null) toUpdate.setCityCode(incoming.getCityCode());
            if (incoming.getSalary() != null) toUpdate.setSalary(incoming.getSalary());
            if (incoming.getSearchJobLimit() != null) {
                toUpdate.setSearchJobLimit(normalizeSearchJobLimit(incoming.getSearchJobLimit()));
            } else if (first.getSearchJobLimit() == null) {
                toUpdate.setSearchJobLimit(DEFAULT_SEARCH_JOB_LIMIT);
            }
            toUpdate.setCreatedAt(first.getCreatedAt());
            toUpdate.setUpdatedAt(now);
            zhilianConfigMapper.updateById(toUpdate);
            return zhilianConfigMapper.selectById(first.getId());
        }
    }

    // ========== Option 辅助 ==========

    public List<ZhilianOptionEntity> getOptionsByType(String type) {
        return zhilianOptionMapper.selectList(
                new QueryWrapper<ZhilianOptionEntity>()
                        .eq("type", type)
                        .orderByAsc("sort_order", "id")
        );
    }

    public String normalizeCityCode(String raw) {
        String city = safeTrim(raw);
        if (city == null || city.isEmpty() || "不限".equals(city) || "0".equals(city)) {
            return DEFAULT_CITY_CODE;
        }
        if (city.chars().allMatch(Character::isDigit)) {
            return city;
        }
        String code = getCodeByTypeAndName("city", city);
        if (code == null || code.isBlank()) {
            log.warn("智联配置中的城市 {} 未在 zhilian_option 表中找到，回退为全国", city);
            return DEFAULT_CITY_CODE;
        }
        return code;
    }

    public String normalizeSalaryCode(String raw) {
        String salary = safeTrim(raw);
        if (salary == null || salary.isEmpty() || "不限".equals(salary) || "0".equals(salary)) {
            return DEFAULT_SALARY_CODE;
        }
        if (isKnownSalaryCode(salary)) {
            return salary;
        }
        ZhilianOptionEntity byCode = getOptionByTypeAndCode("salary", salary);
        if (byCode != null) {
            return byCode.getCode();
        }
        String code = getCodeByTypeAndName("salary", salary);
        if (code == null || code.isBlank()) {
            log.warn("智联配置中的薪资 {} 不是官方薪资区间，回退为不限", salary);
            return DEFAULT_SALARY_CODE;
        }
        return code;
    }

    private boolean isKnownSalaryCode(String code) {
        return Set.of(
                DEFAULT_SALARY_CODE,
                "0000,4000",
                "4001,6000",
                "6001,8000",
                "8001,10000",
                "10001,15000",
                "15001,25000",
                "25001,35000",
                "35001,50000",
                "50001,9999999"
        ).contains(code);
    }

    public ZhilianOptionEntity getOptionByTypeAndCode(String type, String code) {
        return zhilianOptionMapper.selectOne(
                new QueryWrapper<ZhilianOptionEntity>()
                        .eq("type", type)
                        .eq("code", code)
                        .last("LIMIT 1")
        );
    }

    public String getCodeByTypeAndName(String type, String name) {
        ZhilianOptionEntity e = zhilianOptionMapper.selectOne(
                new QueryWrapper<ZhilianOptionEntity>()
                        .eq("type", type)
                        .eq("name", name)
                        .last("LIMIT 1")
        );
        return e == null ? null : e.getCode();
    }

    public String getNameByTypeAndCode(String type, String code) {
        ZhilianOptionEntity e = getOptionByTypeAndCode(type, code);
        return e == null ? null : e.getName();
    }

    // ==================== 数据操作 ====================

    public int normalizeSearchJobLimit(Integer raw) {
        if (raw == null || raw < MIN_SEARCH_JOB_LIMIT) {
            return DEFAULT_SEARCH_JOB_LIMIT;
        }
        return Math.min(raw, MAX_SEARCH_JOB_LIMIT);
    }

    public boolean existsByJobId(String jobId) {
        if (jobId == null || jobId.trim().isEmpty()) return false;
        Long profileId = profileService.getCurrentProfileIdOrNull();
        if (profileId == null) return false;
        QueryWrapper<ZhilianJobDataEntity> w = new QueryWrapper<>();
        w.eq("profile_id", profileId).eq("job_id", jobId).last("LIMIT 1");
        Long c = zhilianJobDataMapper.selectCount(w);
        return c != null && c > 0;
    }

    public boolean existsByTitleAndCompany(String jobTitle, String companyName) {
        if (jobTitle == null || companyName == null) return false;
        Long profileId = profileService.getCurrentProfileIdOrNull();
        if (profileId == null) return false;
        QueryWrapper<ZhilianJobDataEntity> w = new QueryWrapper<>();
        w.eq("profile_id", profileId).eq("job_title", jobTitle).eq("company_name", companyName).last("LIMIT 1");
        Long c = zhilianJobDataMapper.selectCount(w);
        return c != null && c > 0;
    }

    public void insertJob(ZhilianJobDataEntity entity) {
        if (entity == null) return;
        entity.setProfileId(profileService.getCurrentProfileId());
        LocalDateTime now = LocalDateTime.now();
        entity.setCreateTime(now);
        entity.setUpdateTime(now);
        if (entity.getDeliveryStatus() == null) entity.setDeliveryStatus(DeliveryStatus.NOT_DELIVERED);
        zhilianJobDataMapper.insert(entity);
    }

    public ZhilianJobDataEntity upsertChromeJob(ZhilianJobDataEntity entity) {
        return upsertChromeJob(entity, null);
    }

    public ZhilianJobDataEntity upsertChromeJob(ZhilianJobDataEntity entity, String scanRunId) {
        if (entity == null) return null;
        Long profileId = profileService.getCurrentProfileId();
        entity.setProfileId(profileId);
        if (scanRunId != null && !scanRunId.isBlank()) {
            entity.setScanRunId(scanRunId.trim());
        }
        ZhilianJobDataEntity existing = null;
        if (entity.getJobId() != null && !entity.getJobId().isBlank()) {
            QueryWrapper<ZhilianJobDataEntity> wrapper = new QueryWrapper<>();
            wrapper.eq("profile_id", profileId).eq("job_id", entity.getJobId());
            applyScanRunFilter(wrapper, scanRunId);
            wrapper.last("LIMIT 1");
            existing = zhilianJobDataMapper.selectOne(wrapper);
        }
        if (existing == null && entity.getJobTitle() != null && entity.getCompanyName() != null) {
            QueryWrapper<ZhilianJobDataEntity> wrapper = new QueryWrapper<>();
            wrapper.eq("profile_id", profileId)
                    .eq("job_title", entity.getJobTitle())
                    .eq("company_name", entity.getCompanyName());
            applyScanRunFilter(wrapper, scanRunId);
            wrapper.last("LIMIT 1");
            existing = zhilianJobDataMapper.selectOne(wrapper);
        }

        LocalDateTime now = LocalDateTime.now();
        if (existing == null) {
            entity.setDeliveryStatus(entity.getDeliveryStatus() == null ? DeliveryStatus.NOT_DELIVERED : entity.getDeliveryStatus());
            entity.setCreateTime(now);
            entity.setUpdateTime(now);
            zhilianJobDataMapper.insert(entity);
            return entity;
        }

        entity.setId(existing.getId());
        entity.setProfileId(profileId);
        entity.setCreateTime(existing.getCreateTime());
        entity.setUpdateTime(now);
        entity.setDeliveryStatus(nextChromeDeliveryStatus(existing.getDeliveryStatus(), entity.getDeliveryStatus()));
        entity.setFailureType(existing.getFailureType());
        entity.setFailureReason(existing.getFailureReason());
        entity.setScanRunId(firstNonBlank(entity.getScanRunId(), existing.getScanRunId()));
        entity.setAiScore(existing.getAiScore());
        entity.setAiDecision(existing.getAiDecision());
        entity.setAiReason(existing.getAiReason());
        entity.setPriorityCompany(existing.getPriorityCompany());
        zhilianJobDataMapper.updateById(entity);
        return zhilianJobDataMapper.selectById(existing.getId());
    }

    private void applyScanRunFilter(QueryWrapper<ZhilianJobDataEntity> wrapper, String scanRunId) {
        if (scanRunId != null && !scanRunId.isBlank()) {
            wrapper.eq("scan_run_id", scanRunId.trim());
        }
    }

    private String firstNonBlank(String... values) {
        if (values == null) return null;
        for (String value : values) {
            if (value != null && !value.isBlank()) return value;
        }
        return null;
    }

    private String nextChromeDeliveryStatus(String existingStatus, String incomingStatus) {
        if (DeliveryStatus.isDelivered(incomingStatus)) {
            return incomingStatus;
        }
        if (existingStatus != null && (DeliveryStatus.CHROME_ACCEPTED_STATUSES.contains(existingStatus)
                || DeliveryStatus.FILTERED.equals(existingStatus))) {
            return existingStatus;
        }
        if (incomingStatus != null && !incomingStatus.isBlank()) return incomingStatus;
        return existingStatus == null || existingStatus.isBlank() ? DeliveryStatus.NOT_DELIVERED : existingStatus;
    }

    public ZhilianJobDataEntity getZhilianJobById(Long id) {
        if (id == null) return null;
        Long profileId = profileService.getCurrentProfileIdOrNull();
        if (profileId == null) return null;
        QueryWrapper<ZhilianJobDataEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("id", id).eq("profile_id", profileId).last("LIMIT 1");
        return zhilianJobDataMapper.selectOne(wrapper);
    }

    public void markDeliveredByJobId(String jobId) {
        updateDeliveryStatusByJobId(jobId, DeliveryStatus.DELIVERED);
    }

    public void markWaitingConfirmByJobId(String jobId) {
        updateDeliveryStatusByJobId(jobId, DeliveryStatus.WAITING_CONFIRM);
    }

    public void markWaitingConfirmByJobId(String jobId, Long profileId) {
        updateDeliveryStatusByJobId(jobId, DeliveryStatus.WAITING_CONFIRM, profileId);
    }

    public void updateDeliveryStatusByJobId(String jobId, String status) {
        updateDeliveryStatusByJobId(jobId, status, profileService.getCurrentProfileIdOrNull());
    }

    public void updateDeliveryStatusByJobId(String jobId, String status, Long profileId) {
        updateDeliveryStatusByJobId(jobId, status, profileId, null, null);
    }

    public void updateDeliveryStatusByJobId(String jobId, String status, Long profileId, String failureType, String failureReason) {
        if (jobId == null || jobId.trim().isEmpty()) return;
        if (profileId == null) return;
        ZhilianJobDataEntity upd = new ZhilianJobDataEntity();
        upd.setDeliveryStatus(status);
        if (DeliveryStatus.isDelivered(status)) {
            upd.setFailureType("");
            upd.setFailureReason("");
        } else if (DeliveryStatus.isDeliveryFailed(status)) {
            upd.setFailureType(normalizeFailureType(failureType));
            upd.setFailureReason(firstNonBlank(failureReason, DeliveryStatus.DELIVERY_FAILED));
        }
        upd.setUpdateTime(LocalDateTime.now());
        com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper<ZhilianJobDataEntity> uw =
                new com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper<>();
        uw.eq("profile_id", profileId).eq("job_id", jobId);
        zhilianJobDataMapper.update(upd, uw);
    }

    private String normalizeFailureType(String failureType) {
        if (failureType == null || failureType.isBlank()) return DeliveryStatus.UNKNOWN_FAILURE_TYPE;
        return failureType.trim();
    }

    public void markDeliveredByTitleAndCompany(String jobTitle, String companyName) {
        updateDeliveryStatusByTitleAndCompany(jobTitle, companyName, DeliveryStatus.DELIVERED);
    }

    public void markWaitingConfirmByTitleAndCompany(String jobTitle, String companyName) {
        updateDeliveryStatusByTitleAndCompany(jobTitle, companyName, DeliveryStatus.WAITING_CONFIRM);
    }

    public void markWaitingConfirmByTitleAndCompany(String jobTitle, String companyName, Long profileId) {
        updateDeliveryStatusByTitleAndCompany(jobTitle, companyName, DeliveryStatus.WAITING_CONFIRM, profileId);
    }

    public void updateDeliveryStatusByTitleAndCompany(String jobTitle, String companyName, String status) {
        updateDeliveryStatusByTitleAndCompany(jobTitle, companyName, status, profileService.getCurrentProfileIdOrNull());
    }

    public void updateDeliveryStatusByTitleAndCompany(String jobTitle, String companyName, String status, Long profileId) {
        if (jobTitle == null || companyName == null) return;
        if (profileId == null) return;
        ZhilianJobDataEntity upd = new ZhilianJobDataEntity();
        upd.setDeliveryStatus(status);
        upd.setUpdateTime(LocalDateTime.now());
        com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper<ZhilianJobDataEntity> uw =
                new com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper<>();
        uw.eq("profile_id", profileId).eq("job_title", jobTitle).eq("company_name", companyName);
        zhilianJobDataMapper.update(upd, uw);
    }

    public ZhilianJobDataEntity updateDeliveryStatusById(Long id, String status) {
        return updateDeliveryStatusById(id, status, null, null);
    }

    public ZhilianJobDataEntity updateDeliveryStatusById(Long id, String status, String failureType, String failureReason) {
        if (id == null || status == null || status.isBlank()) {
            throw new IllegalArgumentException("岗位ID和状态不能为空");
        }
        ZhilianJobDataEntity current = getZhilianJobById(id);
        if (current == null) return null;
        ZhilianJobDataEntity update = new ZhilianJobDataEntity();
        update.setId(id);
        update.setDeliveryStatus(status);
        if (DeliveryStatus.isDelivered(status)) {
            update.setFailureType("");
            update.setFailureReason("");
        } else if (DeliveryStatus.isDeliveryFailed(status)) {
            update.setFailureType(normalizeFailureType(failureType));
            update.setFailureReason(firstNonBlank(failureReason, DeliveryStatus.DELIVERY_FAILED));
        }
        update.setUpdateTime(LocalDateTime.now());
        zhilianJobDataMapper.updateById(update);
        return getZhilianJobById(id);
    }

    // ==================== 投递分析（Dashboard）与列表 ====================

    /** 薪资解析结果 */
    public static class SalaryInfo {
        public Integer minK;      // 最小K（单位：K/月）
        public Integer maxK;      // 最大K（单位：K/月）
        public Integer months;    // 月数（默认12）
        public Double medianK;    // 中位数K
        public Long annualTotal;  // 年包（单位：元）
    }

    /** 解析薪资字符串，支持示例：20-40K、35-65K·16薪、30K·15薪、面议（返回null） */
    public static SalaryInfo parseSalary(String salary) {
        if (salary == null) return null;
        String s = salary.trim();
        if (s.isEmpty()) return null;
        if (s.contains("面议")) return null;
        s = s.replace(" ", "");

        Integer months = 12;
        java.util.regex.Matcher mMonths = java.util.regex.Pattern.compile("[·\\.\\-]?([0-9]+)薪").matcher(s);
        if (mMonths.find()) {
            try { months = Integer.parseInt(mMonths.group(1)); } catch (Exception ignore) {}
            s = s.substring(0, mMonths.start());
        }

        Integer minK = null, maxK = null;
        java.util.regex.Matcher mRange = java.util.regex.Pattern.compile("^(\\d+)-(\\d+)[Kk]$").matcher(s);
        java.util.regex.Matcher mSingle = java.util.regex.Pattern.compile("^(\\d+)[Kk]$").matcher(s);
        if (mRange.find()) {
            try { minK = Integer.parseInt(mRange.group(1)); maxK = Integer.parseInt(mRange.group(2)); } catch (Exception ignore) {}
        } else if (mSingle.find()) {
            try { minK = Integer.parseInt(mSingle.group(1)); maxK = minK; } catch (Exception ignore) {}
        } else {
            String cleaned = s.replaceAll("[^0-9Kk\\-]", "");
            mRange = java.util.regex.Pattern.compile("^(\\d+)-(\\d+)[Kk]$").matcher(cleaned);
            mSingle = java.util.regex.Pattern.compile("^(\\d+)[Kk]$").matcher(cleaned);
            if (mRange.find()) {
                try { minK = Integer.parseInt(mRange.group(1)); maxK = Integer.parseInt(mRange.group(2)); } catch (Exception ignore) {}
            } else if (mSingle.find()) {
                try { minK = Integer.parseInt(mSingle.group(1)); maxK = minK; } catch (Exception ignore) {}
            }
        }

        if (minK == null || maxK == null) return null;

        SalaryInfo info = new SalaryInfo();
        info.minK = minK;
        info.maxK = maxK;
        info.months = months != null ? months : 12;
        info.medianK = (minK + maxK) / 2.0;
        info.annualTotal = Math.round(info.medianK * 1000 * info.months);
        return info;
    }

    /** KPI 指标 */
    public static class Kpi {
        public long total;
        public long delivered;
        public long waitingConfirm;
        public long pending;
        public long filtered; // 智联暂不区分，置0或来源于 delivery_status
        public long failed;   // 智暂不区分，置0或来源于 delivery_status
        public Double avgMonthlyK; // 平均中位数K
    }

    /** 通用 name-value 项 */
    public static class NameValue { public String name; public long value; public NameValue(){} public NameValue(String n,long v){name=n;value=v;} }
    /** 薪资桶 */
    public static class BucketValue { public String bucket; public long value; public BucketValue(){} public BucketValue(String b,long v){bucket=b;value=v;} }

    /** 图表集合 */
    public static class Charts {
        public List<NameValue> byStatus;
        public List<NameValue> byCity;
        public List<NameValue> byCompany;
        public List<NameValue> byExperience;
        public List<NameValue> byDegree;
        public List<BucketValue> salaryBuckets;
        public List<NameValue> dailyTrend; // date 作为 name
        public List<NameValue> byFailureType;
    }

    /** 统计响应 */
    public static class StatsResponse { public Kpi kpi; public Charts charts; }

    /** 获取智联投递统计（带筛选） */
    public StatsResponse getZhilianStats(
            List<String> statuses,
            String location,
            String experience,
            String degree,
            Double minK,
            Double maxK,
            String keyword
    ) {
        return getZhilianStats(statuses, location, experience, degree, minK, maxK, keyword, null);
    }

    public StatsResponse getZhilianStats(
            List<String> statuses,
            String location,
            String experience,
            String degree,
            Double minK,
            Double maxK,
            String keyword,
            String scanRunId
    ) {
        QueryWrapper<ZhilianJobDataEntity> wrapper = new QueryWrapper<>();
        String effectiveScanRunId = normalizeExplicitZhilianScanRunId(scanRunId);
        if (effectiveScanRunId != null && !effectiveScanRunId.isBlank()) wrapper.eq("scan_run_id", effectiveScanRunId);
        if (statuses != null && !statuses.isEmpty()) {
            wrapper.in("delivery_status", statuses.stream().filter(Objects::nonNull).map(String::trim).collect(Collectors.toSet()));
        }
        if (location != null && !location.trim().isEmpty()) wrapper.eq("location", location.trim());
        if (experience != null && !experience.trim().isEmpty()) wrapper.eq("experience", experience.trim());
        if (degree != null && !degree.trim().isEmpty()) wrapper.eq("degree", degree.trim());
        if (keyword != null && !keyword.trim().isEmpty()) {
            String kw = keyword.trim();
            wrapper.and(w -> w.like("company_name", kw)
                    .or().like("job_title", kw));
        }

        wrapper.orderByDesc("create_time");
        Long profileId = profileService.getCurrentProfileIdOrNull();
        if (profileId == null) return emptyStatsResponse();
        wrapper.eq("profile_id", profileId);
        List<ZhilianJobDataEntity> all = zhilianJobDataMapper.selectList(wrapper);

        List<ZhilianJobDataEntity> filtered = new ArrayList<>();
        for (ZhilianJobDataEntity e : all) {
            if (minK == null && maxK == null) {
                filtered.add(e);
            } else {
                SalaryInfo info = parseSalary(e.getSalary());
                if (info == null || info.medianK == null) continue;
                boolean ok = true;
                if (minK != null) ok = ok && (info.medianK >= minK);
                if (maxK != null) ok = ok && (info.medianK <= maxK);
                if (ok) filtered.add(e);
            }
        }

        Kpi kpi = new Kpi();
        kpi.total = filtered.size();
        kpi.delivered = filtered.stream().filter(e -> DeliveryStatus.isDelivered(e.getDeliveryStatus())).count();
        kpi.waitingConfirm = filtered.stream().filter(e -> DeliveryStatus.isWaitingConfirm(e.getDeliveryStatus())).count();
        kpi.pending = filtered.stream().filter(e -> DeliveryStatus.NOT_DELIVERED.equals(nullSafe(e.getDeliveryStatus()))).count();
        kpi.filtered = filtered.stream().filter(e -> DeliveryStatus.FILTERED.equals(nullSafe(e.getDeliveryStatus()))).count();
        kpi.failed = filtered.stream().filter(e -> DeliveryStatus.isDeliveryFailed(e.getDeliveryStatus())).count();
        {
            List<Double> medians = new ArrayList<>();
            for (ZhilianJobDataEntity e : filtered) {
                SalaryInfo info = parseSalary(e.getSalary());
                if (info == null || info.medianK == null) continue;
                medians.add(info.medianK);
            }
            kpi.avgMonthlyK = medians.isEmpty() ? null : medians.stream().mapToDouble(d -> d).average().orElse(0.0);
        }

        Charts charts = new Charts();
        charts.byStatus = new ArrayList<>();
        charts.byCity = new ArrayList<>();
        charts.byCompany = new ArrayList<>();
        charts.byExperience = new ArrayList<>();
        charts.byDegree = new ArrayList<>();
        charts.salaryBuckets = new ArrayList<>();
        charts.dailyTrend = new ArrayList<>();
        charts.byFailureType = new ArrayList<>();

        Map<String, Long> byStatus = filtered.stream()
                .collect(Collectors.groupingBy(e -> nullSafe(e.getDeliveryStatus()), Collectors.counting()));
        byStatus.forEach((k, v) -> charts.byStatus.add(new NameValue(k, v)));

        Map<String, Long> byFailureType = filtered.stream()
                .filter(e -> DeliveryStatus.isDeliveryFailed(e.getDeliveryStatus()))
                .collect(Collectors.groupingBy(e -> nullSafeFailureType(e.getFailureType()), Collectors.counting()));
        byFailureType.forEach((k, v) -> charts.byFailureType.add(new NameValue(k, v)));

        Map<String, Long> byCity = filtered.stream()
                .filter(e -> e.getLocation() != null && !e.getLocation().trim().isEmpty())
                .collect(Collectors.groupingBy(e -> nullSafe(e.getLocation()), Collectors.counting()));
        byCity.forEach((k, v) -> charts.byCity.add(new NameValue(k, v)));

        Map<String, Long> byCompany = filtered.stream()
                .filter(e -> e.getCompanyName() != null && !e.getCompanyName().trim().isEmpty())
                .collect(Collectors.groupingBy(e -> nullSafe(e.getCompanyName()), Collectors.counting()));
        byCompany.forEach((k, v) -> charts.byCompany.add(new NameValue(k, v)));

        Map<String, Long> byExp = filtered.stream()
                .filter(e -> e.getExperience() != null && !e.getExperience().trim().isEmpty())
                .collect(Collectors.groupingBy(e -> nullSafe(e.getExperience()), Collectors.counting()));
        byExp.forEach((k, v) -> charts.byExperience.add(new NameValue(k, v)));

        Map<String, Long> byDegree = filtered.stream()
                .filter(e -> e.getDegree() != null && !e.getDegree().trim().isEmpty())
                .collect(Collectors.groupingBy(e -> nullSafe(e.getDegree()), Collectors.counting()));
        byDegree.forEach((k, v) -> charts.byDegree.add(new NameValue(k, v)));

        // 每日趋势（按日期聚合 create_time）
        Map<String, Long> byDay = filtered.stream()
                .filter(e -> e.getCreateTime() != null)
                .collect(Collectors.groupingBy(e -> e.getCreateTime().toLocalDate().toString(), Collectors.counting()));
        byDay.entrySet().stream().sorted(Map.Entry.comparingByKey())
                .forEach(en -> charts.dailyTrend.add(new NameValue(en.getKey(), en.getValue())));

        // 薪资桶
        long b0_10=0,b10_15=0,b15_20=0,b20_top=0,b_ge_top=0;
        double maxMedian = 0.0;
        List<Double> medians = new ArrayList<>();
        for (ZhilianJobDataEntity e : filtered) {
            SalaryInfo info = parseSalary(e.getSalary());
            if (info == null || info.medianK == null) continue;
            double m = info.medianK;
            medians.add(m);
            if (m > maxMedian) maxMedian = m;
        }
        int topEdge = (int) Math.ceil(maxMedian / 5.0) * 5;
        if (topEdge <= 20) topEdge = 25;
        for (double m : medians) {
            if (m < 10) b0_10++;
            else if (m < 15) b10_15++;
            else if (m < 20) b15_20++;
            else if (m < topEdge) b20_top++;
            else b_ge_top++;
        }
        charts.salaryBuckets.add(new BucketValue("0-10K", b0_10));
        charts.salaryBuckets.add(new BucketValue("10-15K", b10_15));
        charts.salaryBuckets.add(new BucketValue("15-20K", b15_20));
        charts.salaryBuckets.add(new BucketValue("20-" + topEdge + "K", b20_top));
        charts.salaryBuckets.add(new BucketValue(">=" + topEdge + "K", b_ge_top));

        StatsResponse resp = new StatsResponse();
        resp.kpi = kpi;
        resp.charts = charts;
        return resp;
    }

    /** 列表查询（分页 + 筛选 + 关键词 + 薪资区间基于中位数K） */
    public PagedResult listZhilianJobs(
            List<String> statuses,
            String location,
            String experience,
            String degree,
            Double minK,
            Double maxK,
            String keyword,
            int page,
            int size
    ) {
        return listZhilianJobs(statuses, location, experience, degree, minK, maxK, keyword, page, size, null);
    }

    public PagedResult listZhilianJobs(
            List<String> statuses,
            String location,
            String experience,
            String degree,
            Double minK,
            Double maxK,
            String keyword,
            int page,
            int size,
            String scanRunId
    ) {
        if (page <= 0) page = 1;
        if (size <= 0) size = 20;

        QueryWrapper<ZhilianJobDataEntity> wrapper = new QueryWrapper<>();
        Long profileId = profileService.getCurrentProfileIdOrNull();
        if (profileId == null) {
            PagedResult empty = new PagedResult();
            empty.items = Collections.emptyList();
            empty.total = 0;
            empty.page = page;
            empty.size = size;
            return empty;
        }
        wrapper.eq("profile_id", profileId);
        String effectiveScanRunId = normalizeExplicitZhilianScanRunId(scanRunId);
        if (effectiveScanRunId != null && !effectiveScanRunId.isBlank()) wrapper.eq("scan_run_id", effectiveScanRunId);
        if (statuses != null && !statuses.isEmpty()) {
            wrapper.in("delivery_status", statuses.stream().filter(Objects::nonNull).map(String::trim).collect(Collectors.toSet()));
        }
        if (location != null && !location.trim().isEmpty()) wrapper.eq("location", location.trim());
        if (experience != null && !experience.trim().isEmpty()) wrapper.eq("experience", experience.trim());
        if (degree != null && !degree.trim().isEmpty()) wrapper.eq("degree", degree.trim());

        if (keyword != null && !keyword.trim().isEmpty()) {
            String kw = keyword.trim();
            wrapper.and(w -> w.like("company_name", kw)
                    .or().like("job_title", kw));
        }

        wrapper.orderByDesc("create_time");
        List<ZhilianJobDataEntity> all = zhilianJobDataMapper.selectList(wrapper);

        List<ZhilianJobDataEntity> filtered = new ArrayList<>();
        for (ZhilianJobDataEntity e : all) {
            if (minK == null && maxK == null) {
                filtered.add(e);
            } else {
                SalaryInfo info = parseSalary(e.getSalary());
                if (info == null || info.medianK == null) continue;
                boolean ok = true;
                if (minK != null) ok = ok && (info.medianK >= minK);
                if (maxK != null) ok = ok && (info.medianK <= maxK);
                if (ok) filtered.add(e);
            }
        }

        int total = filtered.size();
        int from = Math.max(0, (page - 1) * size);
        int to = Math.min(total, from + size);

        PagedResult pr = new PagedResult();
        pr.items = filtered.subList(from, to);
        pr.total = total;
        pr.page = page;
        pr.size = size;
        return pr;
    }

    public String normalizeExplicitZhilianScanRunId(String scanRunId) {
        return scanRunId != null && !scanRunId.isBlank() ? scanRunId.trim() : null;
    }

    public static class PagedResult {
        public List<ZhilianJobDataEntity> items;
        public long total;
        public int page;
        public int size;
    }

    /**
     * 清空智联投递分析数据。用于切换候选人/简历前重置旧岗位和旧 AI 结果。
     */
    public Map<String, Object> clearZhilianAnalysisData() {
        Map<String, Object> resp = new HashMap<>();
        Connection conn = null;
        boolean originalAutoCommit = true;
        try {
            conn = dataSource.getConnection();
            originalAutoCommit = conn.getAutoCommit();
            conn.setAutoCommit(false);

            int analysisDeleted;
            int jobsDeleted;
            try (Statement st = conn.createStatement()) {
                Long profileId = profileService.getCurrentProfileId();
                analysisDeleted = st.executeUpdate("DELETE FROM job_ai_analysis WHERE lower(platform)='zhilian' AND profile_id=" + profileId);
                jobsDeleted = st.executeUpdate("DELETE FROM zhilian_data WHERE profile_id=" + profileId);
                try { st.executeUpdate("DELETE FROM sqlite_sequence WHERE name='zhilian_data'"); } catch (Exception ignore) {}
            }

            conn.commit();
            resp.put("success", true);
            resp.put("message", "智联投递分析数据已清空");
            resp.put("jobsDeleted", jobsDeleted);
            resp.put("analysisDeleted", analysisDeleted);
            resp.put("total", 0);
        } catch (Exception e) {
            try { if (conn != null) conn.rollback(); } catch (Exception ignore) {}
            log.warn("清空智联投递分析数据失败: {}", e.getMessage());
            resp.put("success", false);
            resp.put("message", "清空失败: " + e.getMessage());
        } finally {
            try { if (conn != null) conn.setAutoCommit(originalAutoCommit); } catch (Exception ignore) {}
            try { if (conn != null) conn.close(); } catch (Exception ignore) {}
        }
        return resp;
    }

    private static String nullSafe(String s) { return s == null ? "" : s.trim(); }

    private static String nullSafeFailureType(String s) { return s == null || s.trim().isEmpty() ? DeliveryStatus.UNKNOWN_FAILURE_TYPE : s.trim(); }

    private StatsResponse emptyStatsResponse() {
        StatsResponse resp = new StatsResponse();
        resp.kpi = new Kpi();
        resp.charts = new Charts();
        resp.charts.byStatus = new ArrayList<>();
        resp.charts.byCity = new ArrayList<>();
        resp.charts.byCompany = new ArrayList<>();
        resp.charts.byExperience = new ArrayList<>();
        resp.charts.byDegree = new ArrayList<>();
        resp.charts.salaryBuckets = new ArrayList<>();
        resp.charts.dailyTrend = new ArrayList<>();
        resp.charts.byFailureType = new ArrayList<>();
        return resp;
    }
}
