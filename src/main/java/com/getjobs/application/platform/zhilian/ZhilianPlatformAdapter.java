package com.getjobs.application.platform.zhilian;

import com.getjobs.application.entity.ZhilianJobDataEntity;
import com.getjobs.application.platform.PlatformAdapter;
import com.getjobs.application.platform.PlatformCapability;
import com.getjobs.application.platform.PlatformAnalysisInput;
import com.getjobs.application.platform.PlatformType;
import com.getjobs.application.platform.dto.PlatformDeliveryRequest;
import com.getjobs.application.platform.dto.PlatformDeliveryResult;
import com.getjobs.application.platform.dto.PlatformJobItem;
import com.getjobs.application.platform.dto.PlatformScanRequest;
import com.getjobs.application.service.ZhilianService;
import com.getjobs.application.service.JobAiAnalysisService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
@RequiredArgsConstructor
public class ZhilianPlatformAdapter implements PlatformAdapter {
    private final ZhilianService zhilianService;

    @Override
    public String platform() {
        return PlatformType.ZHILIAN.code();
    }

    @Override
    public PlatformCapability capability() {
        return new PlatformCapability(platform(), "TIER_1", "CHROME_BRIDGE", true, true, "CHROME_BRIDGE",
                false, false, "UNSUPPORTED");
    }

    @Override
    public PlatformAnalysisInput toAnalysisInput(Long jobId, Long profileId) {
        ZhilianJobDataEntity job = zhilianService.getZhilianJobById(jobId);
        if (job == null || !java.util.Objects.equals(profileId, job.getProfileId())) {
            throw new IllegalArgumentException("当前档案下未找到智联岗位");
        }
        JobAiAnalysisService.JobAnalysisRequest request = new JobAiAnalysisService.JobAnalysisRequest();
        request.setProfileId(profileId);
        request.setPlatform(platform());
        request.setJobKey(normalizeJobKey(job.getJobId() == null ? job.getId() : job.getJobId()));
        request.setJobRowId(job.getId());
        request.setCompanyName(job.getCompanyName());
        request.setJobName(job.getJobTitle());
        request.setSalary(job.getSalary());
        request.setLocation(job.getLocation());
        request.setExperience(job.getExperience());
        request.setDegree(job.getDegree());
        request.setCompanyInfo("");
        request.setJobDescription(job.getJobDescription());
        request.setScanRunId(job.getScanRunId());
        return new PlatformAnalysisInput(request, job.getDeliveryStatus());
    }

    @Override
    public List<PlatformJobItem> scan(PlatformScanRequest request) {
        PlatformScanRequest safe = request == null ? new PlatformScanRequest() : request;
        ZhilianService.PagedResult result = zhilianService.listZhilianJobs(
                safe.getStatuses(), safe.getLocation(), safe.getExperience(), safe.getDegree(),
                safe.getMinK(), safe.getMaxK(), safe.getKeyword(), positive(safe.getPage(), 1),
                positive(safe.getSize(), 20), safe.getScanRunId());
        return result.items.stream().map(this::toItem).toList();
    }

    @Override
    public PlatformDeliveryResult deliver(PlatformDeliveryRequest request) {
        if (request == null || request.getJobId() == null) {
            return PlatformDeliveryResult.failed(platform(), null, "缺少岗位 ID，无法生成投递任务。");
        }
        ZhilianJobDataEntity job = zhilianService.getZhilianJobById(request.getJobId());
        if (job == null) {
            return PlatformDeliveryResult.failed(platform(), request.getJobId(), "未找到智联岗位。");
        }
        Map<String, Object> task = new LinkedHashMap<>();
        task.put("id", job.getId());
        task.put("platform", platform());
        task.put("url", valueOrEmpty(job.getJobLink()));
        task.put("companyName", valueOrEmpty(job.getCompanyName()));
        task.put("jobName", valueOrEmpty(job.getJobTitle()));
        task.put("salary", valueOrEmpty(job.getSalary()));
        return PlatformDeliveryResult.ok(platform(), job.getId(), "智联投递任务已生成，仍需由现有 Chrome Bridge 确认后执行。", task);
    }

    private PlatformJobItem toItem(ZhilianJobDataEntity job) {
        PlatformJobItem item = new PlatformJobItem();
        item.setId(job.getId());
        item.setPlatform(platform());
        item.setCompanyName(job.getCompanyName());
        item.setJobName(job.getJobTitle());
        item.setSalary(job.getSalary());
        item.setLocation(job.getLocation());
        item.setExperience(job.getExperience());
        item.setDegree(job.getDegree());
        item.setJobUrl(job.getJobLink());
        item.setDeliveryStatus(job.getDeliveryStatus());
        item.setScanRunId(job.getScanRunId());
        item.setAiScore(job.getAiScore());
        item.setAiDecision(job.getAiDecision());
        return item;
    }

    private int positive(Integer value, int fallback) {
        return value == null || value <= 0 ? fallback : value;
    }

    private String valueOrEmpty(String value) {
        return value == null ? "" : value;
    }
}
