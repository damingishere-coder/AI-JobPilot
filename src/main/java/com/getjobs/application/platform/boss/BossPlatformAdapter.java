package com.getjobs.application.platform.boss;

import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.platform.PlatformAdapter;
import com.getjobs.application.platform.PlatformType;
import com.getjobs.application.platform.dto.PlatformDeliveryRequest;
import com.getjobs.application.platform.dto.PlatformDeliveryResult;
import com.getjobs.application.platform.dto.PlatformJobItem;
import com.getjobs.application.platform.dto.PlatformScanRequest;
import com.getjobs.application.service.BossService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
@RequiredArgsConstructor
public class BossPlatformAdapter implements PlatformAdapter {
    private static final int DEFAULT_PAGE = 1;
    private static final int DEFAULT_SIZE = 20;

    private final BossService bossService;

    @Override
    public String platform() {
        return PlatformType.BOSS.code();
    }

    @Override
    public List<PlatformJobItem> scan(PlatformScanRequest request) {
        PlatformScanRequest safeRequest = request == null ? new PlatformScanRequest() : request;
        BossService.PagedResult result = bossService.listBossJobs(
                safeRequest.getStatuses(),
                safeRequest.getLocation(),
                safeRequest.getExperience(),
                safeRequest.getDegree(),
                safeRequest.getMinK(),
                safeRequest.getMaxK(),
                safeRequest.getKeyword(),
                normalizePositive(safeRequest.getPage(), DEFAULT_PAGE),
                normalizePositive(safeRequest.getSize(), DEFAULT_SIZE),
                Boolean.TRUE.equals(safeRequest.getFilterHeadhunter()),
                safeRequest.getScanRunId()
        );
        return result.items.stream().map(this::toPlatformJobItem).toList();
    }

    @Override
    public PlatformDeliveryResult deliver(PlatformDeliveryRequest request) {
        if (request == null || request.getJobId() == null) {
            return PlatformDeliveryResult.failed(platform(), null, "缺少岗位 ID，无法生成投递任务。");
        }
        BossJobDataEntity job = bossService.getBossJobById(request.getJobId());
        if (job == null) {
            return PlatformDeliveryResult.failed(platform(), request.getJobId(), "未找到 Boss 岗位。");
        }
        Map<String, Object> task = new LinkedHashMap<>();
        task.put("id", job.getId());
        task.put("platform", platform());
        task.put("url", valueOrEmpty(job.getJobUrl()));
        task.put("companyName", valueOrEmpty(job.getCompanyName()));
        task.put("jobName", valueOrEmpty(job.getJobName()));
        task.put("salary", valueOrEmpty(job.getSalary()));
        return PlatformDeliveryResult.ok(platform(), job.getId(), "Boss 投递任务已生成，仍需由现有 Chrome Bridge 确认后执行。", task);
    }

    private PlatformJobItem toPlatformJobItem(BossJobDataEntity job) {
        PlatformJobItem item = new PlatformJobItem();
        item.setId(job.getId());
        item.setPlatform(platform());
        item.setCompanyName(job.getCompanyName());
        item.setJobName(job.getJobName());
        item.setSalary(job.getSalary());
        item.setLocation(job.getLocation());
        item.setExperience(job.getExperience());
        item.setDegree(job.getDegree());
        item.setJobUrl(job.getJobUrl());
        item.setDeliveryStatus(job.getDeliveryStatus());
        item.setScanRunId(job.getScanRunId());
        item.setAiScore(job.getAiScore());
        item.setAiDecision(job.getAiDecision());
        return item;
    }

    private int normalizePositive(Integer value, int fallback) {
        return value == null || value <= 0 ? fallback : value;
    }

    private String valueOrEmpty(String value) {
        return value == null ? "" : value;
    }
}
