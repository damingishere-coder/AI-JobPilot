package com.getjobs.worker.service;

import com.getjobs.application.service.ConfigService;
import com.getjobs.worker.boss.Boss;
import com.getjobs.worker.boss.BossConfig;
import com.getjobs.worker.dto.JobProgressMessage;
import com.getjobs.worker.manager.PlaywrightManager;
import com.microsoft.playwright.Page;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Boss直聘任务服务
 * 管理Boss平台的投递任务执行和状态
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BossJobService implements JobPlatformService {
    private static final String PLATFORM = "boss";

    private final PlaywrightManager playwrightManager;
    private final ConfigService configService;
    private final ObjectProvider<Boss> bossProvider;
    private final JobRunCoordinator jobRunCoordinator;

    // 任务运行状态
    private volatile boolean isRunning = false;
    // 停止标志
    private volatile boolean shouldStop = false;

    @Override
    public void executeDelivery(Consumer<JobProgressMessage> progressCallback) {
        if (isRunning) {
            progressCallback.accept(JobProgressMessage.warning(PLATFORM, "任务已在运行中"));
            return;
        }
        if (!jobRunCoordinator.tryStart(PLATFORM)) {
            progressCallback.accept(JobProgressMessage.warning(PLATFORM, "Boss任务已在运行中"));
            return;
        }

        try {
            // 获取Boss页面实例
            Page page = playwrightManager.getBossPage();
            if (page == null) {
                progressCallback.accept(JobProgressMessage.error(PLATFORM, "Boss页面未初始化"));
                return;
            }

            // 检查是否已登录
            if (!playwrightManager.isLoggedIn(PLATFORM)) {
                progressCallback.accept(JobProgressMessage.error(PLATFORM, "请先登录Boss直聘"));
                return;
            }

            // 通过校验后再标记运行
            isRunning = true;
            shouldStop = false;

            // 暂停后台登录监控，避免与投递流程并发访问同一Page
            playwrightManager.pauseBossMonitoring();

            // 加载配置（统一从 boss_config 专表读取）
            BossConfig config = configService.getBossConfig();
            progressCallback.accept(JobProgressMessage.info(PLATFORM, "配置加载成功"));

            progressCallback.accept(JobProgressMessage.info(PLATFORM, "开始扫描岗位，命中岗位会进入待确认列表..."));

            // 创建Boss实例并执行投递
            Boss.ProgressCallback bossCallback = (message, current, total) -> {
                if (current != null && total != null) {
                    progressCallback.accept(JobProgressMessage.progress(PLATFORM, message, current, total));
                } else {
                    progressCallback.accept(JobProgressMessage.info(PLATFORM, message));
                }
            };

            Boss boss = bossProvider.getObject();
            boss.setPage(page);
            boss.setConfig(config);
            boss.setProgressCallback(bossCallback);
            boss.setShouldStopCallback(this::shouldStop);
            boss.prepare();

            PlaywrightManager.BossSearchSessionStatus sessionStatus =
                    playwrightManager.verifyBossSearchSession(boss.buildProbeSearchUrl());
            if (!sessionStatus.searchReady()) {
                String reason = sessionStatus.failureReason() == null || sessionStatus.failureReason().isBlank()
                        ? "Boss搜索页未就绪"
                        : sessionStatus.failureReason();
                progressCallback.accept(JobProgressMessage.error(PLATFORM, reason));
                return;
            }

            int deliveredCount = boss.execute();

            progressCallback.accept(JobProgressMessage.success(PLATFORM,
                String.format("Boss扫描完成，共生成%d个待确认岗位", deliveredCount)));
        } catch (Exception e) {
            log.error("Boss投递任务执行失败", e);
            progressCallback.accept(JobProgressMessage.error(PLATFORM, "扫描失败: " + e.getMessage()));
        } finally {
            isRunning = false;
            shouldStop = false;
            jobRunCoordinator.finish(PLATFORM);
            // 恢复后台登录监控
            try {
                playwrightManager.resumeBossMonitoring();
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void stopDelivery() {
        if (isRunning) {
            log.info("收到停止Boss投递任务的请求");
            shouldStop = true;
        }
    }

    @Override
    public Map<String, Object> getStatus() {
        Map<String, Object> status = new HashMap<>();
        status.put("platform", PLATFORM);
        status.put("isRunning", isRunning);
        status.put("isLoggedIn", playwrightManager.isLoggedIn(PLATFORM));
        return status;
    }

    @Override
    public String getPlatformName() {
        return PLATFORM;
    }

    @Override
    public boolean isRunning() {
        return isRunning;
    }

    /**
     * 检查是否应该停止
     * 供Boss.java调用
     */
    public boolean shouldStop() {
        return shouldStop;
    }

    
}
