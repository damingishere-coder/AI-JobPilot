package com.getjobs.application.platform.liepin;

import com.getjobs.application.entity.LiepinEntity;
import com.getjobs.application.platform.PlatformAdapter;
import com.getjobs.application.platform.PlatformCapability;
import com.getjobs.application.platform.PlatformAnalysisInput;
import com.getjobs.application.platform.PlatformType;
import com.getjobs.application.platform.dto.PlatformDeliveryRequest;
import com.getjobs.application.platform.dto.PlatformDeliveryResult;
import com.getjobs.application.platform.dto.PlatformJobItem;
import com.getjobs.application.platform.dto.PlatformScanRequest;
import com.getjobs.application.service.LiepinService;
import com.getjobs.application.service.JobAiAnalysisService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@RequiredArgsConstructor
public class LiepinPlatformAdapter implements PlatformAdapter {
    private final LiepinService liepinService;

    @Override
    public String platform() {
        return PlatformType.LIEPIN.code();
    }

    @Override
    public PlatformCapability capability() {
        return new PlatformCapability(platform(), "TIER_2", "PLAYWRIGHT_LEGACY", true, true, "PLAYWRIGHT_LEGACY",
                false, false, "UNSUPPORTED");
    }

    @Override
    public PlatformAnalysisInput toAnalysisInput(Long jobId, Long profileId) {
        LiepinEntity job = liepinService.getLiepinJobById(jobId);
        if (job == null || !java.util.Objects.equals(profileId, job.getProfileId())) {
            throw new IllegalArgumentException("当前档案下未找到猎聘岗位");
        }
        JobAiAnalysisService.JobAnalysisRequest request = new JobAiAnalysisService.JobAnalysisRequest();
        request.setProfileId(profileId);
        request.setPlatform(platform());
        request.setJobKey(normalizeJobKey(job.getJobId()));
        request.setJobRowId(job.getId());
        request.setCompanyName(job.getCompName());
        request.setJobName(job.getJobTitle());
        request.setSalary(job.getJobSalaryText());
        request.setLocation(job.getJobArea());
        request.setExperience(job.getJobExpReq());
        request.setDegree(job.getJobEduReq());
        request.setCompanyInfo((java.util.Objects.toString(job.getCompIndustry(), "") + " "
                + java.util.Objects.toString(job.getCompScale(), "")).trim());
        request.setJobDescription("");
        return new PlatformAnalysisInput(request, job.getDeliveryStatus());
    }

    @Override
    public List<PlatformJobItem> scan(PlatformScanRequest request) {
        PlatformScanRequest safe = request == null ? new PlatformScanRequest() : request;
        LiepinService.PagedResult result = liepinService.listLiepinJobs(
                safe.getStatuses(), safe.getLocation(), safe.getExperience(), safe.getDegree(),
                safe.getMinK(), safe.getMaxK(), safe.getKeyword(), positive(safe.getPage(), 1),
                positive(safe.getSize(), 20));
        return result.items.stream().map(this::toItem).toList();
    }

    @Override
    public PlatformDeliveryResult deliver(PlatformDeliveryRequest request) {
        Long jobId = request == null ? null : request.getJobId();
        return PlatformDeliveryResult.failed(platform(), jobId,
                "猎聘保留单一旧 Playwright 执行入口；统一适配器不会直接执行投递。");
    }

    private PlatformJobItem toItem(LiepinEntity job) {
        PlatformJobItem item = new PlatformJobItem();
        item.setId(job.getId());
        item.setPlatform(platform());
        item.setCompanyName(job.getCompName());
        item.setJobName(job.getJobTitle());
        item.setSalary(job.getJobSalaryText());
        item.setLocation(job.getJobArea());
        item.setExperience(job.getJobExpReq());
        item.setDegree(job.getJobEduReq());
        item.setJobUrl(job.getJobLink());
        item.setDeliveryStatus(job.getDeliveryStatus());
        item.setAiScore(job.getAiScore());
        item.setAiDecision(job.getAiDecision());
        return item;
    }

    private int positive(Integer value, int fallback) {
        return value == null || value <= 0 ? fallback : value;
    }
}
