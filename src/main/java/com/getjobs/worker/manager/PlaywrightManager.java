package com.getjobs.worker.manager;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.entity.CookieEntity;
import com.getjobs.application.service.CookieService;
import com.getjobs.worker.utils.BrowserLaunchSettings;
import com.microsoft.playwright.*;
import com.microsoft.playwright.options.Cookie;
import com.microsoft.playwright.options.WaitUntilState;
import com.microsoft.playwright.options.LoadState;
import jakarta.annotation.PreDestroy;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executor;
import java.util.function.Consumer;

/**
 * Playwright管理器
 * Spring管理的单例Bean，在应用启动时自动初始化Playwright实例
 * 支持4个求职平台的共享BrowserContext和登录状态监控
 * 所有平台在同一个浏览器窗口的不同标签页中运行
 */
@Slf4j
@Getter
@Component
@Lazy
public class PlaywrightManager {

    // Playwright实例
    private Playwright playwright;

    // 浏览器实例（所有平台共享）
    private Browser browser;

    // 浏览器上下文（所有平台共享，在同一个窗口中打开多个标签页）
    private BrowserContext context;

    // Boss直聘页面
    private Page bossPage;

    // 猎聘页面
    private Page liepinPage;

    // 51job页面（预留）
    private Page job51Page;

    // 智联招聘页面（预留）
    private Page zhilianPage;

    // 登录状态追踪（平台 -> 是否已登录）
    private final Map<String, Boolean> loginStatus = new ConcurrentHashMap<>();

    // 登录状态监听器
    private final List<Consumer<LoginStatusChange>> loginStatusListeners = new CopyOnWriteArrayList<>();

    // 控制是否暂停对bossPage的后台监控，避免与任务执行并发访问同一页面
    private volatile boolean bossMonitoringPaused = false;

    // 控制是否暂停对liepinPage的后台监控
    private volatile boolean liepinMonitoringPaused = false;

    // 控制是否暂停对51jobPage的后台监控
  private volatile boolean job51MonitoringPaused = false;

    // 控制是否暂停对zhilianPage的后台监控
    private volatile boolean zhilianMonitoringPaused = false;

    // 记录智联招聘是否已处理过未登录引导（仅初始化时执行一次）
    private volatile boolean zhilianLoginGuided = false;
    private final Object playwrightLifecycleLock = new Object();
    private final Object bossPageOperationLock = new Object();
    private volatile boolean playwrightInitializing = false;
    private volatile String lastInitializationError = "";

    // 默认超时时间（毫秒）
  private static final int DEFAULT_TIMEOUT = 30000;

    // Playwright调试端口
    private static final int CDP_PORT = 7866;
    private static final String DESKTOP_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

    // 平台URL常量
    private static final String BOSS_URL = "https://www.zhipin.com";
    private static final String BOSS_LOGIN_URL = BOSS_URL + "/web/user/?ka=header-login";
    private static final String LIEPIN_URL = "https://www.liepin.com";
  private static final String JOB51_URL = "https://www.51job.com";
    private static final String ZHILIAN_URL = "https://www.zhaopin.com";
    private static final String ZHILIAN_LOGIN_URL = "https://passport.zhaopin.com/login";
    // 降噪：51job Cookie保存日志节流状态
    private volatile long last51CookieLogMs = 0L;
    private volatile int last51CookieLogCount = -1;
    private volatile String last51CookieRemark = "";

    public record BossSearchSessionStatus(
            boolean homeLoggedIn,
            boolean searchReady,
            String currentUrl,
            String failureReason
    ) {}

    @Autowired
    private CookieService cookieService;

    @Value("${app.browser.user-data-dir:}")
    private String browserUserDataDir;

    @Value("${app.browser.executable-path:}")
    private String browserExecutablePath;

    @Value("${app.browser.channel:}")
    private String browserChannel;

    @Value("${app.browser.headless:false}")
    private boolean browserHeadless;

    @Value("${app.browser.slow-mo-ms:50}")
    private double browserSlowMoMs;

    @Autowired
    @Qualifier("jobTaskExecutor")
    private Executor jobTaskExecutor;

    /**
     * 初始化Playwright实例（延迟初始化）
     */
    public void init() {
        if (isInitialized()) {
            return;
        }
        synchronized (playwrightLifecycleLock) {
            if (isInitialized()) {
                return;
            }
            if (playwrightInitializing) {
                return;
            }
            playwrightInitializing = true;
        }
        log.info("========================================");
        log.info("  初始化浏览器自动化引擎");
        log.info("========================================");

        try {
            // 启动Playwright
            playwright = Playwright.create();
            log.info("✓ Playwright引擎已启动");

            BrowserLaunchSettings launchSettings = BrowserLaunchSettings.from(
                    browserUserDataDir,
                    browserExecutablePath,
                    browserChannel,
                    browserHeadless,
                    browserSlowMoMs
            );
            List<String> launchArgs = List.of(
                    "--remote-debugging-port=" + CDP_PORT,
                    "--start-maximized"
            );

            if (launchSettings.usesPersistentContext()) {
                Path userDataDir = launchSettings.userDataDir().orElseThrow();
                Files.createDirectories(userDataDir);
                removeStaleChromiumProfileLocks(userDataDir);
                BrowserType.LaunchPersistentContextOptions options = new BrowserType.LaunchPersistentContextOptions()
                        .setHeadless(launchSettings.headless())
                        .setSlowMo(launchSettings.slowMoMs())
                        .setArgs(launchArgs)
                        .setViewportSize(null)
                        .setUserAgent(DESKTOP_USER_AGENT);
                launchSettings.executablePath().ifPresent(options::setExecutablePath);
                launchSettings.channel().ifPresent(options::setChannel);
                context = playwright.chromium().launchPersistentContext(userDataDir, options);
                browser = context.browser();
                log.info("✓ Chrome浏览器已启动 (调试端口: {}, userDataDir: {})", CDP_PORT, userDataDir);
            } else {
                // 创建浏览器实例，使用固定CDP端口7866，最大化启动
                BrowserType.LaunchOptions options = new BrowserType.LaunchOptions()
                        .setHeadless(launchSettings.headless())
                        .setSlowMo(launchSettings.slowMoMs())
                        .setArgs(launchArgs);
                launchSettings.executablePath().ifPresent(options::setExecutablePath);
                launchSettings.channel().ifPresent(options::setChannel);
                browser = playwright.chromium().launch(options);
                log.info("✓ Chrome浏览器已启动 (调试端口: {})", CDP_PORT);

                // 创建共享的BrowserContext（所有平台在同一个窗口的不同标签页中）
                context = browser.newContext(new Browser.NewContextOptions()
                        .setViewportSize(null) // 不设置固定视口，使用浏览器窗口实际大小
                        .setUserAgent(DESKTOP_USER_AGENT));
            }
            log.info("✓ BrowserContext已创建（所有平台共享）");

            // 顺序创建所有Page（避免并发创建Page导致的竞态条件）
            log.info("开始创建所有平台的Page...");
            bossPage = context.newPage();
            bossPage.setDefaultTimeout(DEFAULT_TIMEOUT);
            log.info("✓ Boss Page已创建");

            liepinPage = context.newPage();
            liepinPage.setDefaultTimeout(DEFAULT_TIMEOUT);
            log.info("✓ 猎聘 Page已创建");

            job51Page = context.newPage();
            job51Page.setDefaultTimeout(DEFAULT_TIMEOUT);
            log.info("✓ 51job Page已创建");

            zhilianPage = context.newPage();
            zhilianPage.setDefaultTimeout(DEFAULT_TIMEOUT);
            log.info("✓ 智联招聘 Page已创建");

            // 并发执行各平台的初始化逻辑（导航、Cookie加载等）
            log.info("开始并发初始化所有平台...");
            CompletableFuture<Void> bossFuture = CompletableFuture.runAsync(() -> setupPlatformSafely("Boss", this::setupBossPlatform), jobTaskExecutor);
            CompletableFuture<Void> liepinFuture = CompletableFuture.runAsync(() -> setupPlatformSafely("猎聘", this::setupLiepinPlatform), jobTaskExecutor);
            CompletableFuture<Void> job51Future = CompletableFuture.runAsync(() -> setupPlatformSafely("51job", this::setup51jobPlatform), jobTaskExecutor);
            CompletableFuture<Void> zhilianFuture = CompletableFuture.runAsync(() -> setupPlatformSafely("智联", this::setupZhilianPlatform), jobTaskExecutor);

            // 等待所有平台初始化完成
            CompletableFuture.allOf(bossFuture, liepinFuture, job51Future, zhilianFuture).join();

            lastInitializationError = "";
            log.info("✓ 浏览器自动化引擎初始化完成（所有平台已并发启动）");
            log.info("========================================");
        } catch (Exception e) {
            lastInitializationError = buildPlaywrightStartupError(e);
            log.error("✗ 浏览器自动化引擎初始化失败", e);
            cleanupPlaywrightResources("初始化失败清理");
            throw new RuntimeException(lastInitializationError, e);
        } finally {
            playwrightInitializing = false;
        }
    }

    /**
     * Remove Chromium singleton files only when the owning process is no longer
     * running. Docker keeps the persistent profile on the host, so an abrupt
     * container replacement can otherwise leave these symlinks behind forever.
     */
    static void removeStaleChromiumProfileLocks(Path userDataDir) {
        Path singletonLock = userDataDir.resolve("SingletonLock");
        boolean lockExists = Files.exists(singletonLock, java.nio.file.LinkOption.NOFOLLOW_LINKS);

        if (lockExists && !Files.isSymbolicLink(singletonLock)) {
            log.warn("Chromium profile lock is not a symlink; leaving it untouched: {}", singletonLock);
            return;
        }

        if (lockExists) {
            try {
                String lockOwner = Files.readSymbolicLink(singletonLock).toString();
                if (isChromiumProfileLockActive(lockOwner)) {
                    log.info("Chromium profile is already owned by a running process; keeping its lock");
                    return;
                }
            } catch (Exception e) {
                log.warn("Unable to validate Chromium profile lock; leaving it untouched: {}", singletonLock, e);
                return;
            }
        }

        boolean removed = false;
        for (String filename : List.of("SingletonCookie", "SingletonLock", "SingletonSocket")) {
            Path lockFile = userDataDir.resolve(filename);
            try {
                removed = Files.deleteIfExists(lockFile) || removed;
            } catch (Exception e) {
                throw new IllegalStateException("Failed to remove stale Chromium profile lock: " + lockFile, e);
            }
        }
        if (removed) {
            log.warn("Removed stale Chromium profile locks left by a stopped process");
        }
    }

    static boolean isChromiumProfileLockActive(String lockOwner) {
        int separator = lockOwner.lastIndexOf('-');
        if (separator <= 0 || separator == lockOwner.length() - 1) {
            return false;
        }

        String currentHost = System.getenv("HOSTNAME");
        if (currentHost == null || currentHost.isBlank()) {
            return true;
        }

        String ownerHost = lockOwner.substring(0, separator);
        if (!currentHost.equals(ownerHost)) {
            return false;
        }

        try {
            long ownerPid = Long.parseLong(lockOwner.substring(separator + 1));
            return ProcessHandle.of(ownerPid).map(ProcessHandle::isAlive).orElse(false);
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private String buildPlaywrightStartupError(Exception e) {
        String detail = e.getMessage() == null ? "" : e.getMessage();
        return "Playwright初始化失败。请确认已安装浏览器依赖：可在项目根目录执行 gradlew.bat playwright install chromium；"
                + "如需使用本机 Chrome，请在 application.yaml 或环境变量中配置 app.browser.executable-path / APP_BROWSER_EXECUTABLE_PATH。"
                + (detail.isBlank() ? "" : " 原始错误：" + detail);
    }

    private void setupPlatformSafely(String platform, Runnable task) {
        try {
            task.run();
        } catch (Exception e) {
            log.error("{}平台初始化失败", platform, e);
            if (e instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            throw new IllegalStateException(platform + "平台初始化失败", e);
        }
    }

    /**
     * 设置Boss直聘平台（加载Cookie、导航、监控）
     */
    private void setupBossPlatform() {
        log.info("开始初始化Boss直聘平台...");

        // 尝试从数据库加载Boss平台Cookie到上下文
        try {
            CookieEntity cookieEntity = cookieService.getCookieByPlatform("boss");
            if (cookieEntity != null && cookieEntity.getCookieValue() != null && !cookieEntity.getCookieValue().isBlank()) {
                String cookieStr = cookieEntity.getCookieValue();
                List<Cookie> cookies = parseCookiesFromString(cookieStr);

                if (!cookies.isEmpty()) {
                    context.addCookies(cookies);
                    log.info("已从数据库加载Boss Cookie并注入浏览器上下文，共 {} 条", cookies.size());
                } else {
                    log.warn("解析Cookie失败，未能加载任何Cookie");
                }
            } else {
                log.info("数据库未找到Boss Cookie或值为空，跳过Cookie注入");
            }
        } catch (Exception e) {
            log.warn("从数据库加载Boss Cookie失败: {}", e.getMessage());
        }

        // 导航到Boss直聘首页（带重试机制）
        int maxRetries = 3;
        boolean navigateSuccess = false;
        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                bossPage.navigate(BOSS_URL, new Page.NavigateOptions()
                        .setTimeout(60000)
                        .setWaitUntil(WaitUntilState.DOMCONTENTLOADED));
                navigateSuccess = true;
                break;
            } catch (Exception e) {
                // Playwright在并发导航时可能抛出 "Object doesn't exist" 异常，但页面实际已加载
                boolean pageAccessible = false;
                try {
                    String url = bossPage.url();
                    pageAccessible = url != null && url.contains("zhipin.com");
                } catch (Exception ignored) {
                }

                if (pageAccessible) {
                    navigateSuccess = true;
                    break;
                }

                if (attempt < maxRetries) {
                    try {
                        Thread.sleep(2000);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                    }
                }
            }
        }

        if (!navigateSuccess) {
            log.warn("Boss直聘页面导航失败");
        }

        try {
            // 等待页面网络空闲，确保头部导航渲染完成
            try {
                bossPage.waitForLoadState(LoadState.NETWORKIDLE);
            } catch (Exception e) {
                log.debug("等待Boss页面网络空闲失败: {}", e.getMessage());
            }

            // 初始化阶段不主动跳转登录页，仅在导航后设置状态
            // 参考猎聘实现：加载Cookie并导航后，由业务侧决定是否触发后续登录流程
        } catch (Exception e) {
            log.warn("Boss直聘页面导航失败: {}", e.getMessage());
        }
        // 初始化登录状态并通知（如果有SSE连接会立即推送）
        setLoginStatus("boss", checkIfLoggedIn());
        // 设置登录状态监控
        setupLoginMonitoring(bossPage);
    }

    /**
     * 检查Boss是否已登录
     */
    private boolean checkIfLoggedIn() {
        if (bossPage == null || bossPage.isClosed()) {
            return false;
        }

        try {
            String url = bossPage.url();
            if (url != null && (url.contains("/web/geek/") || url.contains("/web/user/resume"))) {
                return true;
            }
        } catch (Exception ignored) {}

        // 更稳健的登录判断：优先检测用户头像/昵称/个人入口是否可见。
        try {
            Locator userLabel = bossPage.locator("li.nav-figure span.label-text").first();
            if (userLabel.isVisible()) {
                return true;
            }
        } catch (Exception ignored) {}

        try {
            // 有些版本仅展示头像入口，无 label-text
            Locator navFigure = bossPage.locator("li.nav-figure, .nav-figure, a[href*='/web/geek/'], a[href*='/web/user/resume']").first();
            if (navFigure.isVisible()) {
                return true;
            }
        } catch (Exception ignored) {}

        try {
            Locator header = bossPage.locator("#header, .site-nav, .nav, .user-nav").first();
            if (header.isVisible()) {
                String text = header.textContent();
                if (text != null && text.contains("消息") && text.contains("简历") && !text.contains("登录")) {
                    return true;
                }
            }
        } catch (Exception ignored) {}

        try {
            Locator loginEntry = bossPage.locator(
                    "a[href*='header-login'], " +
                    "a[href*='/web/user/?ka=header-login'], " +
                    "li.nav-sign a, " +
                    ".btns"
            ).first();
            if (loginEntry.isVisible()) {
                String text = loginEntry.textContent();
                if (text != null && text.contains("登录")) {
                    return false;
                }
            }
        } catch (Exception ignored) {}

        // 无法明确检测到登录特征时，保守返回未登录
        return false;
    }

    private Page ensureBossPage() {
        ensureBrowserContextAvailable();
        try {
            if (bossPage != null && !bossPage.isClosed()) {
                return bossPage;
            }
        } catch (Exception ignored) {}
        bossPage = context.newPage();
        bossPage.setDefaultTimeout(DEFAULT_TIMEOUT);
        setupLoginMonitoring(bossPage);
        setLoginStatus("boss", false);
        log.info("Boss Page 已重新创建");
        return bossPage;
    }

    private Page ensureZhilianPage() {
        ensureBrowserContextAvailable();
        try {
            if (zhilianPage != null && !zhilianPage.isClosed()) {
                return zhilianPage;
            }
        } catch (Exception ignored) {}
        zhilianPage = context.newPage();
        zhilianPage.setDefaultTimeout(DEFAULT_TIMEOUT);
        zhilianLoginGuided = false;
        setupZhilianLoginMonitoring(zhilianPage);
        setLoginStatus("zhilian", false);
        log.info("智联招聘 Page 已重新创建");
        return zhilianPage;
    }

    private void ensureBrowserContextAvailable() {
        waitForPlaywrightReady();
        if (context == null) {
            try {
                init();
            } catch (Exception e) {
                String message = lastInitializationError == null || lastInitializationError.isBlank()
                        ? "浏览器自动化暂不可用，请稍后重试"
                        : lastInitializationError;
                throw new IllegalStateException(message, e);
            }
        }
        waitForPlaywrightReady();
        if (context == null) {
            String message = lastInitializationError == null || lastInitializationError.isBlank()
                    ? "浏览器自动化暂不可用，请稍后重试"
                    : lastInitializationError;
            throw new IllegalStateException(message);
        }
    }

    private void waitForPlaywrightReady() {
        long deadline = System.currentTimeMillis() + 60000;
        while (playwrightInitializing && System.currentTimeMillis() < deadline) {
            try {
                Thread.sleep(200);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("等待浏览器初始化被中断", e);
            }
        }
        if (playwrightInitializing) {
            throw new IllegalStateException("浏览器自动化引擎仍在初始化，请稍后再试");
        }
    }

    private boolean navigateZhilianPage(Page page, String url, String expectedUrlPart) {
        try {
            page.navigate(url, new Page.NavigateOptions()
                    .setTimeout(60000)
                    .setWaitUntil(WaitUntilState.DOMCONTENTLOADED));
            return true;
        } catch (Exception e) {
            try {
                String currentUrl = page.url();
                if (currentUrl != null && currentUrl.contains(expectedUrlPart)) {
                    log.debug("智联招聘页面导航异常但页面已可用: {}", e.getMessage());
                    return true;
                }
            } catch (Exception ignored) {
            }
            log.warn("智联招聘页面导航失败 url={}: {}", url, e.getMessage());
            return false;
        }
    }

    private boolean navigateBossPage(Page page, String url, String expectedUrlPart) {
        try {
            page.navigate(url, new Page.NavigateOptions()
                    .setTimeout(15000)
                    .setWaitUntil(WaitUntilState.DOMCONTENTLOADED));
            return true;
        } catch (Exception e) {
            try {
                String currentUrl = page.url();
                if (currentUrl != null && currentUrl.contains(expectedUrlPart)) {
                    log.debug("Boss页面导航异常但页面已可用: {}", e.getMessage());
                    return true;
                }
            } catch (Exception ignored) {
            }
            log.warn("Boss页面导航失败 url={}: {}", url, e.getMessage());
            return false;
        }
    }

    private void openBossQrLoginPanel(Page page) {
        try {
            page.waitForLoadState(LoadState.DOMCONTENTLOADED);
        } catch (Exception ignored) {
        }

        try {
            Locator qrSwitch = page.locator(".btn-sign-switch.ewm-switch").first();
            if (qrSwitch.isVisible()) {
                qrSwitch.click(new Locator.ClickOptions().setTimeout(3000));
                return;
            }

            Locator tip = page.getByText("APP扫码登录").first();
            if (tip.isVisible()) {
                tip.click(new Locator.ClickOptions().setTimeout(3000));
                return;
            }

            Locator legacy = page.locator("li.sign-switch-tip").first();
            if (legacy.isVisible()) {
                legacy.click(new Locator.ClickOptions().setTimeout(3000));
            }
        } catch (Exception e) {
            log.debug("打开 Boss 登录页后切换二维码失败: {}", e.getMessage());
        }
    }

    public BossSearchSessionStatus verifyBossSearchSession(String searchUrl) {
        synchronized (bossPageOperationLock) {
            Page page = ensureBossPage();
            boolean homeLoggedIn = checkIfLoggedIn();
            String targetUrl = normalizeBossSearchUrl(searchUrl);
            try {
                navigateBossPage(page, targetUrl, "zhipin.com");
                try {
                    page.waitForLoadState(LoadState.DOMCONTENTLOADED);
                } catch (Exception ignored) {}
                String currentUrl = safePageUrl(page);
                String lowerUrl = currentUrl == null ? "" : currentUrl.toLowerCase();
                if (isBossSecurityOrLoginUrl(lowerUrl)) {
                    setLoginStatus("boss", false);
                    return new BossSearchSessionStatus(homeLoggedIn, false, currentUrl,
                            "Boss搜索页触发安全校验，需要在后端自动化浏览器里完成登录/安全验证");
                }

                waitForBossSearchPagePaint(page);

                boolean hasSearchPage = hasBossJobCards(page);
                try {
                    log.info("Boss搜索页预检结果: hasCards={}, url={}, title={}", hasSearchPage, currentUrl, page.title());
                } catch (Exception ignored) {}

                if (!hasSearchPage) {
                    String bodyText = "";
                    try {
                        bodyText = page.locator("body").innerText(new Locator.InnerTextOptions().setTimeout(3000));
                    } catch (Exception ignored) {}
                    if (bodyText.contains("安全验证") || bodyText.contains("异常访问") || bodyText.contains("登录") || bodyText.contains("扫码")) {
                        setLoginStatus("boss", false);
                        return new BossSearchSessionStatus(homeLoggedIn, false, currentUrl,
                                "Boss搜索页需要登录或安全验证，请在后端自动化浏览器页面完成后再扫描");
                    }
                    return new BossSearchSessionStatus(homeLoggedIn, false, currentUrl,
                            "Boss搜索页未加载岗位列表，请完成安全校验或稍后重试");
                }

                setLoginStatus("boss", true);
                return new BossSearchSessionStatus(true, true, currentUrl, "");
            } catch (Exception e) {
                String currentUrl = safePageUrl(page);
                String lowerUrl = currentUrl == null ? "" : currentUrl.toLowerCase();
                if (isBossSecurityOrLoginUrl(lowerUrl)) {
                    setLoginStatus("boss", false);
                    return new BossSearchSessionStatus(homeLoggedIn, false, currentUrl,
                            "Boss搜索页触发安全校验，需要在后端自动化浏览器里完成登录/安全验证");
                }
                return new BossSearchSessionStatus(homeLoggedIn, false, currentUrl,
                        "Boss搜索页验证失败: " + e.getMessage());
            }
        }
    }

    public BossSearchSessionStatus verifyBossSearchSession() {
        return verifyBossSearchSession(null);
    }

    public Map<String, Object> getBossLoginDetails() {
        BossSearchSessionStatus status = verifyBossSearchSession();
        Map<String, Object> details = new HashMap<>();
        details.put("homeLoggedIn", status.homeLoggedIn());
        details.put("searchReady", status.searchReady());
        details.put("currentUrl", status.currentUrl() == null ? "" : status.currentUrl());
        details.put("failureReason", status.failureReason() == null ? "" : status.failureReason());
        return details;
    }

    public Map<String, Object> getBossPageSnapshot() {
        synchronized (bossPageOperationLock) {
            Page page = ensureBossPage();
            Map<String, Object> snapshot = new HashMap<>();
            snapshot.put("success", true);
            snapshot.put("url", safePageUrl(page));
            try {
                snapshot.put("title", page.title());
            } catch (Exception e) {
                snapshot.put("title", "");
            }
            Exception lastError = null;
            for (int attempt = 0; attempt < 2; attempt++) {
                try {
                    try {
                        page.waitForLoadState(LoadState.DOMCONTENTLOADED);
                    } catch (Exception ignored) {}
                    byte[] bytes = page.screenshot(new Page.ScreenshotOptions()
                            .setFullPage(false)
                            .setTimeout(10000));
                    snapshot.put("success", true);
                    snapshot.put("url", safePageUrl(page));
                    try {
                        snapshot.put("title", page.title());
                    } catch (Exception ignored) {}
                    snapshot.put("image", "data:image/png;base64," + java.util.Base64.getEncoder().encodeToString(bytes));
                    snapshot.remove("message");
                    return snapshot;
                } catch (Exception e) {
                    lastError = e;
                    try {
                        Thread.sleep(800);
                    } catch (InterruptedException interruptedException) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
            snapshot.put("success", false);
            snapshot.put("message", "获取Boss后端浏览器截图失败: " + (lastError == null ? "未知错误" : lastError.getMessage()));
            return snapshot;
        }
    }

    public Map<String, Object> clickBossPage(double x, double y) {
        synchronized (bossPageOperationLock) {
            Page page = ensureBossPage();
            Map<String, Object> result = new HashMap<>();
            try {
                page.mouse().click(x, y);
                try {
                    page.waitForLoadState(LoadState.DOMCONTENTLOADED);
                } catch (Exception ignored) {}
                result.put("success", true);
                result.put("url", safePageUrl(page));
                result.put("message", "已点击后端Boss浏览器页面");
            } catch (Exception e) {
                result.put("success", false);
                result.put("message", "点击后端Boss浏览器页面失败: " + e.getMessage());
            }
            return result;
        }
    }

    public Map<String, Object> dragBossPage(double fromX, double fromY, double toX, double toY) {
        synchronized (bossPageOperationLock) {
            Map<String, Object> result = new HashMap<>();
            Exception lastError = null;
            for (int attempt = 0; attempt < 2; attempt++) {
                Page page = ensureBossPage();
                try {
                    page.mouse().move(fromX, fromY);
                    page.mouse().down();
                    page.mouse().move(toX, toY, new Mouse.MoveOptions().setSteps(24));
                    page.mouse().up();
                    try {
                        page.waitForLoadState(LoadState.DOMCONTENTLOADED);
                    } catch (Exception ignored) {}
                    result.put("success", true);
                    result.put("url", safePageUrl(page));
                    result.put("message", "已拖动后端Boss浏览器页面");
                    return result;
                } catch (Exception e) {
                    lastError = e;
                    try {
                        Thread.sleep(500);
                    } catch (InterruptedException interruptedException) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
            result.put("success", false);
            result.put("message", "拖动后端Boss浏览器页面失败: " + (lastError == null ? "未知错误" : lastError.getMessage()));
            return result;
        }
    }

    private String normalizeBossSearchUrl(String searchUrl) {
        if (searchUrl != null && !searchUrl.isBlank()) {
            return searchUrl;
        }
        return BOSS_URL + "/web/geek/job?city=101280600&query=AI%E4%BA%A7%E5%93%81%E8%BF%90%E8%90%A5";
    }

    private boolean isBossSecurityOrLoginUrl(String lowerUrl) {
        return lowerUrl.contains("/web/user")
                || lowerUrl.contains("passport")
                || lowerUrl.contains("login")
                || lowerUrl.contains("_security_check");
    }

    private void waitForBossSearchPagePaint(Page page) {
        String selector = String.join(", ",
                "ul.rec-job-list li.job-card-box",
                "li.job-card-box",
                ".job-card-wrapper",
                "[class*='job-card']",
                "[ka^='search_list_']",
                "input[placeholder*='搜索']");
        try {
            page.waitForSelector(selector, new Page.WaitForSelectorOptions().setTimeout(12000));
        } catch (Exception ignored) {}
    }

    private boolean hasBossJobCards(Page page) {
        String[] selectors = {
                "ul.rec-job-list li.job-card-box",
                "li.job-card-box",
                ".job-card-wrapper",
                "[ka^='search_list_']",
                "a[href*='/job_detail/']"
        };
        for (String selector : selectors) {
            try {
                if (page.locator(selector).count() > 0) {
                    return true;
                }
            } catch (Exception ignored) {}
        }
        return false;
    }

    private String safePageUrl(Page page) {
        try {
            return page.url();
        } catch (Exception ignored) {
            return "";
        }
    }

    private void openZhilianQrLoginPanel(Page page) {
        try {
            page.waitForLoadState(LoadState.DOMCONTENTLOADED);
        } catch (Exception ignored) {
        }

        try {
            page.waitForSelector(
                    "div.zppp-panel-normal-bar__img, " +
                    ".zppp-panel-normal-bar__img, " +
                    "[class*='normal-bar__img'], " +
                    "[class*='qrcode'], img[src*='qrcode']",
                    new Page.WaitForSelectorOptions().setTimeout(10000)
            );
        } catch (Exception e) {
            log.debug("智联招聘登录页二维码相关元素等待失败: {}", e.getMessage());
        }

        String[] qrToggleSelectors = {
                "div.zppp-panel-normal-bar__img",
                ".zppp-panel-normal-bar__img",
                "[class*='normal-bar__img']"
        };

        for (String selector : qrToggleSelectors) {
            try {
                Locator qrToggle = page.locator(selector).first();
                if (qrToggle.count() > 0 && qrToggle.isVisible()) {
                    qrToggle.click(new Locator.ClickOptions().setTimeout(DEFAULT_TIMEOUT));
                    log.info("已切换到智联二维码登录页面，等待用户扫码...");
                    return;
                }
            } catch (Exception e) {
                log.debug("尝试点击智联二维码入口失败 selector={}: {}", selector, e.getMessage());
            }
        }

        log.info("智联招聘登录页已打开，等待用户自行选择扫码或登录方式");
    }

    /**
     * 主动打开 Boss 平台或登录页。用于用户关闭平台页面后的恢复入口。
     */
    public boolean openBossPlatformPage() {
        try {
            Page page = ensureBossPage();
            boolean loggedIn = checkIfLoggedIn();
            if (!loggedIn) {
                loggedIn = reloadBossCookiesFromDb();
                page = ensureBossPage();
            }
            if (loggedIn) {
                navigateBossPage(page, BOSS_URL, "zhipin.com");
                setLoginStatus("boss", true);
                return true;
            }

            navigateBossPage(page, BOSS_LOGIN_URL, "/web/user/");
            openBossQrLoginPanel(page);
            setLoginStatus("boss", false);
            return false;
        } catch (Exception e) {
            log.error("打开 Boss 平台页面失败: {}", e.getMessage(), e);
            throw new RuntimeException("打开 Boss 平台页面失败", e);
        }
    }

    /**
     * 设置登录状态监控
     *
     * @param page 页面实例
     */
    private void setupLoginMonitoring(Page page) {
        // 监听页面导航事件，检测URL变化
        page.onFrameNavigated(frame -> {
            if (frame == page.mainFrame()) {
                // 事件触发的检查在Playwright内部线程执行，仍需遵守暂停标志
                if (!bossMonitoringPaused) {
                    checkLoginStatus(page, "boss");
                }
            }
        });

        log.info("{}平台登录状态监控已启用", "boss");
    }

    /**
     * 设置猎聘平台（加载Cookie、导航、监控）
     */
    private void setupLiepinPlatform() {
        log.info("开始初始化猎聘平台...");

        // 尝试从数据库加载猎聘平台Cookie到上下文
        try {
            CookieEntity cookieEntity = cookieService.getCookieByPlatform("liepin");
            if (cookieEntity != null && cookieEntity.getCookieValue() != null && !cookieEntity.getCookieValue().isBlank()) {
                String cookieStr = cookieEntity.getCookieValue();
                List<Cookie> cookies = parseCookiesFromString(cookieStr);

                if (!cookies.isEmpty()) {
                    context.addCookies(cookies);
                    log.info("已从数据库加载猎聘 Cookie并注入浏览器上下文，共 {} 条", cookies.size());
                } else {
                    log.warn("解析猎聘Cookie失败，未能加载任何Cookie");
                }
            } else {
                log.info("数据库未找到猎聘Cookie或值为空，跳过Cookie注入");
            }
        } catch (Exception e) {
            log.warn("从数据库加载猎聘Cookie失败: {}", e.getMessage());
        }

        // 导航到猎聘首页（带重试机制）
        int maxRetries = 3;
        boolean navigateSuccess = false;
        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                liepinPage.navigate(LIEPIN_URL, new Page.NavigateOptions()
                        .setTimeout(60000)
                        .setWaitUntil(WaitUntilState.DOMCONTENTLOADED));
                navigateSuccess = true;
                break;
            } catch (Exception e) {
                // Playwright在并发导航时可能抛出 "Object doesn't exist" 异常，但页面实际已加载
                boolean pageAccessible = false;
                try {
                    String url = liepinPage.url();
                    pageAccessible = url != null && url.contains("liepin.com");
                } catch (Exception ignored) {
                }

                if (pageAccessible) {
                    navigateSuccess = true;
                    break;
                }

                if (attempt < maxRetries) {
                    try {
                        Thread.sleep(2000);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                    }
                }
            }
        }

        if (!navigateSuccess) {
            log.warn("猎聘页面导航失败");
        }

        // 等待页面网络空闲，确保头部导航渲染完成
        try {
            liepinPage.waitForLoadState(LoadState.NETWORKIDLE);
        } catch (Exception e) {
            log.debug("等待猎聘页面网络空闲失败: {}", e.getMessage());
        }

        // 初始化登录状态并通知（如果有SSE连接会立即推送）
        setLoginStatus("liepin", checkIfLiepinLoggedIn());
        // 设置登录状态监控
        setupLiepinLoginMonitoring(liepinPage);
    }

    /**
     * 检查猎聘是否已登录
     * 已登录：能找到用户头像 <img class="header-quick-menu-user-photo" ...>
     * 未登录：能找到 <span id="header-quick-menu-login">登录/注册</span>
     */
    private boolean checkIfLiepinLoggedIn() {
        try {
            // 先检查“登录/注册”入口是否可见，若可见则明确未登录
            try {
                Locator loginEntry = liepinPage.locator(
                    "#header-quick-menu-login, a[href*='login'], a[data-key='login'], button[data-key='login'], text=/登录|注册/").first();
                if (loginEntry.isVisible()) {
                    log.info("检测到未登录猎聘，保持在登录页或首页等待扫码登录");
                    // 若不在登录页，则导航到登录页并尝试切换二维码
                    String currentUrl = null;
                    try { currentUrl = liepinPage.url(); } catch (Exception ignored) {}
                    try {
                        if (currentUrl == null || !currentUrl.contains("/login")) {
                            liepinPage.navigate("https://www.liepin.com/login");
                            try { Thread.sleep(800); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                        }
                        // 优先点击官方切换二维码的容器
                        Locator qrSwitch = liepinPage.locator(".switch-type-mask-img-box").first();
                        if (qrSwitch.isVisible()) {
                            qrSwitch.click();
                            log.info("已切换到猎聘二维码登录页面，等待用户扫码...");
                        } else {
                            // 兼容新版页面：图片资源名包含 qrcode-btn，需要点击其父级按钮
                            Locator qrImg = liepinPage.locator("img[src*='qrcode-btn']").first();
                            if (qrImg.count() > 0 && qrImg.isVisible()) {
                                try {
                                    // 尝试点击父节点或最近的可点击容器
                                    qrImg.click();
                                } catch (Exception ignored) {
                                    try {
                                        Locator parentBtn = qrImg.locator("xpath=ancestor::button[1] | xpath=ancestor::*[contains(@class,'btn')][1]").first();
                                        if (parentBtn.count() > 0 && parentBtn.isVisible()) {
                                            parentBtn.click();
                                        }
                                    } catch (Exception ignored2) {}
                                }
                                log.info("已通过二维码按钮切换到扫码登录状态");
                            }
                        }
                    } catch (Exception e) {
                        log.debug("猎聘登录页引导/二维码切换失败: {}", e.getMessage());
                    }
                    return false;
                }
            } catch (Exception ignored) {}

            // 再检查已登录特征：用户信息容器或用户头像是否存在（无需强制可见）
            try {
                if (liepinPage.locator("#header-quick-menu-user-info").count() > 0) {
                    log.debug("猎聘登录检测：存在用户信息容器，判定已登录");
                    return true;
                }
            } catch (Exception ignored) {}

            try {
                if (liepinPage.locator("img.header-quick-menu-user-photo, .header-quick-menu-user-photo").count() > 0) {
                    log.debug("猎聘登录检测：存在用户头像元素，判定已登录");
                    return true;
                }
            } catch (Exception ignored) {}

            // 兜底：若不存在登录入口且也未找到明确已登录特征，按已登录处理（避免误判）
            try {
                boolean loginEntryExists = liepinPage.locator("#header-quick-menu-login, a[href*='login']").count() > 0;
                if (!loginEntryExists) {
                    log.info("猎聘登录检测：未发现登录入口，兜底判定为已登录");
                    return true;
                }
            } catch (Exception ignored) {}

            // 默认未登录
            log.debug("猎聘登录检测：未匹配到明确特征，判定未登录");
            return false;
        } catch (Exception e) {
            log.debug("猎聘登录检测异常: {}", e.getMessage());
            return false;
        }
    }

    /**
     * 设置猎聘登录状态监控
     *
     * @param page 页面实例
     */
    private void setupLiepinLoginMonitoring(Page page) {
        // 监听页面导航事件，检测URL变化
        page.onFrameNavigated(frame -> {
            if (frame == page.mainFrame()) {
                if (!liepinMonitoringPaused) {
                    checkLiepinLoginStatus(page);
                }
            }
        });

        log.info("猎聘平台登录状态监控已启用");
    }

    /**
     * 设置51job平台（加载Cookie、导航、监控）
     */
    private void setup51jobPlatform() {
        log.info("开始初始化51job平台...");

        // 尝试从数据库加载51job平台Cookie到上下文
        try {
            CookieEntity cookieEntity = cookieService.getCookieByPlatform("51job");
            if (cookieEntity != null && cookieEntity.getCookieValue() != null && !cookieEntity.getCookieValue().isBlank()) {
                String cookieStr = cookieEntity.getCookieValue();
                List<Cookie> cookies = parseCookiesFromString(cookieStr);

                if (!cookies.isEmpty()) {
                    context.addCookies(cookies);
                    log.info("已从数据库加载51job Cookie并注入浏览器上下文，共 {} 条", cookies.size());
                } else {
                    log.warn("解析51job Cookie失败，未能加载任何Cookie");
                }
            } else {
                log.info("数据库未找到51job Cookie或值为空，跳过Cookie注入");
            }
        } catch (Exception e) {
            log.warn("从数据库加载51job Cookie失败: {}", e.getMessage());
        }

        // 导航到51job首页（带重试机制）
        int maxRetries = 3;
        boolean navigateSuccess = false;
        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                job51Page.navigate(JOB51_URL, new Page.NavigateOptions()
                        .setTimeout(60000)
                        .setWaitUntil(WaitUntilState.DOMCONTENTLOADED));
                navigateSuccess = true;
                break;
            } catch (Exception e) {
                // Playwright在并发导航时可能抛出 "Object doesn't exist" 异常，但页面实际已加载
                boolean pageAccessible = false;
                try {
                    String url = job51Page.url();
                    pageAccessible = url != null && url.contains("51job.com");
                } catch (Exception ignored) {
                }

                if (pageAccessible) {
                    navigateSuccess = true;
                    break;
                }

                if (attempt < maxRetries) {
                    try {
                        Thread.sleep(2000);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                    }
                }
            }
        }

        if (!navigateSuccess) {
            log.warn("51job页面导航失败");
        }

        try {
            // 检查是否需要登录
            if (!checkIf51jobLoggedIn()) {
                log.info("检测到未登录51job，尝试自动点击登录入口并等待用户登录");

                try {
                    // 优先使用用户提供的选择器：span.login.loginBtnClick
                    Locator loginEntry = job51Page.locator("span.login.loginBtnClick").first();
                    if (loginEntry != null && loginEntry.isVisible()) {
                        loginEntry.click(new Locator.ClickOptions().setTimeout(30000));
                        log.info("已点击 51job 首页的 ‘登录/注册’ 入口，等待用户登录...");
                        asyncWaitFor51jobLogin();
                    } else {
                        // 备用选择器：文本匹配
                        Locator altLoginEntry = job51Page.locator("text=/登录\\/注册|登录|注册/").first();
                        if (altLoginEntry != null && altLoginEntry.isVisible()) {
                            altLoginEntry.click(new Locator.ClickOptions().setTimeout(30000));
                            log.info("已点击 51job 首页的登录入口（文本匹配），等待用户登录...");
                            asyncWaitFor51jobLogin();
                        } else {
                            log.info("未找到 51job 登录入口元素，保持在首页等待用户自行登录");
                            // 启动后台轮询，确保无导航也能检测到登录成功
                            asyncWaitFor51jobLogin();
                        }
                    }
                } catch (Exception clickEx) {
                    log.warn("尝试点击 51job 登录入口时发生异常: {}，保持在首页等待用户登录", clickEx.getMessage());
                    // 启动后台轮询，避免异常导致无法检测登录成功
                    asyncWaitFor51jobLogin();
                }
            } else {
                log.info("51job已登录");
            }
        } catch (Exception e) {
            log.warn("51job页面初始化检查失败: {}", e.getMessage());
        }

        // 初始化登录状态并通知（如果有SSE连接会立即推送）
        setLoginStatus("51job", checkIf51jobLoggedIn());
        // 设置登录状态监控
        setup51jobLoginMonitoring(job51Page);
    }

    /**
     * 检查51job是否已登录
     */
  private boolean checkIf51jobLoggedIn() {
      try {
            // 未登录特征：存在“登录/注册”入口
            Locator loginBtn = job51Page.locator("span.login.loginBtnClick").first();
            if (loginBtn.isVisible()) {
                String txt = (loginBtn.textContent() == null ? "" : loginBtn.textContent()).trim();
                if (txt.contains("登录")) {
                    return false;
                }
            }
            // 已登录特征（增强）：顶部显示用户名入口或个人中心链接
            // 1) 明确的用户名锚点（类名：uname e_icon at）
            Locator userAnchor = job51Page.locator("a.uname.e_icon.at");
            if (userAnchor.count() > 0 && userAnchor.first().isVisible()) {
                return true;
            }
            // 2) 个人中心链接（href=/pc/my/myjob）
            Locator myJobLink = job51Page.locator("a[href*='/pc/my/myjob']");
            if (myJobLink.count() > 0 && myJobLink.first().isVisible()) {
                return true;
            }
            // 3) 其他可能的用户信息容器（旧的兜底选择器）
            return job51Page.locator(".login-info, .user-info, .username").count() > 0;
      } catch (Exception e) {
          return false;
      }
  }

    /**
     * 设置51job登录状态监控
     *
     * @param page 页面实例
     */
    private void setup51jobLoginMonitoring(Page page) {
        // 监听页面导航事件，检测URL变化
        page.onFrameNavigated(frame -> {
            if (frame == page.mainFrame()) {
                if (!job51MonitoringPaused) {
                    check51jobLoginStatus(page);
                }
            }
        });

        log.info("51job平台登录状态监控已启用");
    }

    /**
     * 检查51job登录状态
     *
     * @param page 页面实例
     */
    private void check51jobLoginStatus(Page page) {
        try {
            boolean isLoggedIn = checkIf51jobLoggedIn();
            // 如果登录状态发生变化（从未登录变为已登录）
            Boolean previousStatus = loginStatus.get("51job");
            if (isLoggedIn && (previousStatus == null || !previousStatus)) {
                on51jobLoginSuccess();
            }
        } catch (Exception e) {
            // 忽略检查过程中的异常，避免影响正常流程
            log.debug("检查51job平台登录状态时发生异常: {}", e.getMessage());
        }
    }

    /**
     * 51job登录成功回调
     */
    private void on51jobLoginSuccess() {
        log.info("51job平台登录成功");

        // 更新登录状态并通知
        setLoginStatus("51job", true);

        // 登录成功时保存 Cookie 到数据库
        save51jobCookiesToDatabase("login success");
    }

    /**
     * 在后台异步等待 51job 登录成功。
     * 说明：不阻塞初始化主流程，独立线程每秒轮询一次登录状态，最长等待5分钟。
     */
    private void asyncWaitFor51jobLogin() {
        Thread waitThread = new Thread(() -> {
            try {
                int maxSeconds = 300; // 最长等待 5 分钟
                for (int i = 0; i < maxSeconds; i++) {
                    boolean loggedIn = false;
                    try {
                        loggedIn = checkIf51jobLoggedIn();
                    } catch (Exception ignored) {
                    }

                    if (loggedIn) {
                        // 交由统一回调处理登录成功逻辑（包含状态更新与保存 Cookie）
                        on51jobLoginSuccess();
                        log.info("后台等待检测到 51job 登录成功，用时约 {} 秒", i);
                        return;
                    }

                    try {
                        Thread.sleep(1000);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        log.debug("等待 51job 登录线程被中断");
                        return;
                    }
                }
                log.warn("后台等待 51job 登录超时（约5分钟），仍未检测到登录成功");
            } catch (Exception e) {
                log.warn("后台等待 51job 登录过程中发生异常: {}", e.getMessage());
            }
        }, "wait-51job-login-thread");

        waitThread.setDaemon(true);
        waitThread.start();
    }

    /**
     * 保存51job Cookie到数据库
     *
     * @param remark 备注信息
     */
  private void save51jobCookiesToDatabase(String remark) {
      try {
          List<com.microsoft.playwright.options.Cookie> cookies = context.cookies();
          // 使用ObjectMapper序列化为JSON字符串
          String cookieJson = new ObjectMapper().writeValueAsString(cookies);
          boolean result = cookieService.saveOrUpdateCookie("51job", cookieJson, remark);
          if (result) {
                long now = System.currentTimeMillis();
                boolean shouldInfoLog = (now - last51CookieLogMs) > 15000 // 至少间隔15秒
                        || cookies.size() != last51CookieLogCount
                        || (remark != null && !remark.equals(last51CookieRemark));
                if (shouldInfoLog) {
                    log.info("保存51job Cookie成功，共 {} 条，remark={}", cookies.size(), remark);
                    last51CookieLogMs = now;
                    last51CookieLogCount = cookies.size();
                    last51CookieRemark = remark == null ? "" : remark;
                } else {
                    // 近似重复的频繁调用，改为debug降低噪音
                    log.debug("保存51job Cookie成功(节流)，条数={}，remark={}", cookies.size(), remark);
                }
          }
      } catch (Exception e) {
          log.warn("保存51job Cookie失败: {}", e.getMessage());
      }
  }

    /**
     * 主动保存51job Cookie到数据库（用于调试/验证）
     */
    public void save51jobCookiesToDb(String remark) {
        save51jobCookiesToDatabase(remark);
    }

    /**
     * 清理51job上下文中的Cookie
     */
    public void clear51jobCookies() {
        try {
            if (context != null) {
                context.clearCookies();
                log.info("已清理共享上下文中的所有Cookie");
            } else {
                log.warn("共享上下文不存在，无法清理Cookie");
            }
        } catch (Exception e) {
            log.error("清理共享上下文Cookie失败: {}", e.getMessage(), e);
            throw new RuntimeException("清理共享上下文Cookie失败", e);
        }
    }

    /**
     * 暂停51job页面的后台登录监控（避免与业务流程并发操作页面）
     */
    public void pause51jobMonitoring() {
        job51MonitoringPaused = true;
        log.debug("51job登录监控已暂停");
    }

    /**
     * 恢复51job页面的后台登录监控
     */
    public void resume51jobMonitoring() {
        job51MonitoringPaused = false;
        log.debug("51job登录监控已恢复");
    }

    /**
     * 触发 51job 登录流程：打开登录页并点击“微信扫码登录”按钮
     */
    public void trigger51jobLogin() {
        try {
            if (job51Page == null) {
                if (context == null) {
                    throw new IllegalStateException("浏览器上下文尚未初始化");
                }
                job51Page = context.newPage();
            }

            // 如果已登录则直接返回
            if (checkIf51jobLoggedIn()) {
                log.info("检测到已登录51job，跳过登录触发");
                return;
            }

            // 先尝试在首页点击“登录/注册”入口
            try {
                job51Page.navigate(JOB51_URL, new Page.NavigateOptions()
                    .setTimeout(60000)
                    .setWaitUntil(WaitUntilState.DOMCONTENTLOADED));
                Locator loginEntry = job51Page.locator("span.login.loginBtnClick, text=/登录\\/注册|登录|注册/").first();
                if (loginEntry.isVisible()) {
                    loginEntry.click(new Locator.ClickOptions().setTimeout(DEFAULT_TIMEOUT));
                }
            } catch (Exception e) {
                log.debug("在首页尝试点击登录入口失败: {}", e.getMessage());
            }

            // 跳转到官方登录页
            String loginUrl = "https://login.51job.com/login.php";
            job51Page.navigate(loginUrl, new Page.NavigateOptions()
                .setTimeout(60000)
                .setWaitUntil(WaitUntilState.DOMCONTENTLOADED));

            // 尝试点击“微信扫码登录”按钮
            Locator wechatScanBtn = job51Page.locator(
                "i.passIcon.custom-cursor-on-hover[data-sensor-id='sensor_login_wechatScan'], " +
                "i.passIcon[data-sensor-id='sensor_login_wechatScan'], " +
                "[data-sensor-id='sensor_login_wechatScan']"
            ).first();

            if (wechatScanBtn.isVisible()) {
                wechatScanBtn.click(new Locator.ClickOptions().setTimeout(DEFAULT_TIMEOUT));
                log.info("已点击51job登录页的微信扫码按钮，等待用户扫码登录...");
            } else {
                log.warn("未找到微信扫码登录按钮，用户可在登录页自行选择扫码方式");
            }

            // 不阻塞等待：监控会自动检测到登录成功并保存Cookie
        } catch (Exception e) {
            log.error("触发51job登录流程失败: {}", e.getMessage(), e);
            throw new RuntimeException("触发51job登录流程失败", e);
        }
    }

    /**
     * 设置智联招聘平台（加载Cookie、导航、监控）
     */
    private void setupZhilianPlatform() {
        log.info("开始初始化智联招聘平台...");

        // 尝试从数据库加载智联招聘平台Cookie到上下文
        try {
            CookieEntity cookieEntity = cookieService.getCookieByPlatform("zhilian");
            if (cookieEntity != null && cookieEntity.getCookieValue() != null && !cookieEntity.getCookieValue().isBlank()) {
                String cookieStr = cookieEntity.getCookieValue();
                List<Cookie> cookies = parseCookiesFromString(cookieStr);

                if (!cookies.isEmpty()) {
                    context.addCookies(cookies);
                    log.info("已从数据库加载智联招聘 Cookie并注入浏览器上下文，共 {} 条", cookies.size());
                } else {
                    log.warn("解析智联招聘Cookie失败，未能加载任何Cookie");
                }
            } else {
                log.info("数据库未找到智联招聘Cookie或值为空，跳过Cookie注入");
            }
        } catch (Exception e) {
            log.warn("从数据库加载智联招聘Cookie失败: {}", e.getMessage());
        }

        // 导航到智联招聘首页（带重试机制）
        int maxRetries = 3;
        boolean navigateSuccess = false;
        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                zhilianPage.navigate(ZHILIAN_URL, new Page.NavigateOptions()
                        .setTimeout(60000)
                        .setWaitUntil(WaitUntilState.DOMCONTENTLOADED));
                navigateSuccess = true;
                break;
            } catch (Exception e) {
                // Playwright在并发导航时可能抛出 "Object doesn't exist" 异常，但页面实际已加载
                boolean pageAccessible = false;
                try {
                    String url = zhilianPage.url();
                    pageAccessible = url != null && url.contains("zhaopin.com");
                } catch (Exception ignored) {
                }

                if (pageAccessible) {
                    navigateSuccess = true;
                    break;
                }

                if (attempt < maxRetries) {
                    try {
                        Thread.sleep(2000);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                    }
                }
            }
        }

        if (!navigateSuccess) {
            log.warn("智联招聘页面导航失败");
        }

        // 等待页面加载完成
        try {
            zhilianPage.waitForLoadState(LoadState.NETWORKIDLE);
        } catch (Exception e) {
            log.debug("等待智联页面网络空闲失败: {}", e.getMessage());
        }

        // 初始化登录状态并通知（如果有SSE连接会立即推送）
        setLoginStatus("zhilian", checkIfZhilianLoggedIn());
        // 设置登录状态监控
        setupZhilianLoginMonitoring(zhilianPage);
    }

    /**
     * 检查智联招聘是否已登录
     * 未登录时只在首次检测时引导用户到登录页
     */
    private boolean checkIfZhilianLoggedIn() {
        try {
            if (zhilianPage == null) {
                return false;
            }

            boolean isLoggedIn = false;
            boolean loginButtonExists = false;

            // 检查是否存在"登录/注册"按钮
            try {
                Locator loginButton = zhilianPage.locator("a.home-header__c-no-login").first();
                int count = loginButton.count();
                if (count > 0) {
                    loginButtonExists = true;
                    // 尝试获取文本进一步确认
                    try {
                        String buttonText = loginButton.textContent();
                        if (buttonText != null && buttonText.contains("登录")) {
                            loginButtonExists = true;
                        }
                    } catch (Exception e) {
                        log.debug("智联招聘：获取登录按钮文本失败: {}", e.getMessage());
                    }
                }
            } catch (Exception e) {
                log.debug("智联招聘：检查登录按钮时异常: {}", e.getMessage());
            }

            // 如果存在登录按钮，说明未登录
            if (loginButtonExists) {
                // 只在首次检测到未登录时执行引导操作
                if (!zhilianLoginGuided) {
                    log.info("检测到未登录智联招聘，重定向到登录页面");
                    zhilianLoginGuided = true;

                    // 重定向到登录页面
                    String currentUrl = null;
                    try {
                        currentUrl = zhilianPage.url();
                    } catch (Exception ignored) {
                    }

                    try {
                        if (currentUrl == null || !currentUrl.contains("passport.zhaopin.com/login")) {
                            boolean loginNavOk = false;
                            try {
                                zhilianPage.navigate(
                                        ZHILIAN_LOGIN_URL,
                                        new Page.NavigateOptions()
                                                .setTimeout(60000)
                                                .setWaitUntil(WaitUntilState.DOMCONTENTLOADED)
                                );
                                loginNavOk = true;
                            } catch (Exception navEx) {
                                String urlAfter = null;
                                try {
                                    urlAfter = zhilianPage.url();
                                } catch (Exception ignored2) {}

                                if (urlAfter != null && urlAfter.contains("passport.zhaopin.com")) {
                                    loginNavOk = true;
                                    log.debug("智联招聘：登录页导航异常但已在登录域: {}", navEx.getMessage());
                                } else {
                                    log.warn("智联招聘：导航至登录页失败: {}", navEx.getMessage());
                                }
                            }

                            if (loginNavOk) {
                                try {
                                    zhilianPage.waitForLoadState(LoadState.DOMCONTENTLOADED);
                                } catch (Exception ignored) {}
                                try {
                                    zhilianPage.waitForSelector(
                                            "div.zppp-panel-normal-bar__img, " +
                                            "div.passport-login, #J_loginWrap, " +
                                            "div[class*='qrcode'], img[src*='qrcode']",
                                            new Page.WaitForSelectorOptions().setTimeout(30000)
                                    );
                                } catch (Exception e) {
                                    log.debug("智联招聘：登录页关键元素等待失败: {}", e.getMessage());
                                }
                            }
                        }

                        openZhilianQrLoginPanel(zhilianPage);
                    } catch (Exception e) {
//                        log.warn("智联招聘：打开二维码登录面板失败: {}", e.getMessage());
                    }
                }
                return false;
            }

            // 检查是否有已登录的特征
            try {
                String url = zhilianPage.url();
                if (url != null && url.contains("i.zhaopin.com")) {
                    log.debug("智联招聘：URL包含i.zhaopin.com，判定为已登录");
                    isLoggedIn = true;
                }
            } catch (Exception ignore) {
            }

            // 如果没有登录按钮，也认为已登录
            if (!loginButtonExists) {
                log.debug("智联招聘：未检测到登录按钮，判定为已登录");
                isLoggedIn = true;
            }

            return isLoggedIn;
        } catch (Exception e) {
            log.warn("智联招聘：检查登录状态异常: {}", e.getMessage());
            return false;
        }
    }

    /**
     * 设置智联招聘登录状态监控
     *
     * @param page 页面实例
     */
    private void setupZhilianLoginMonitoring(Page page) {
        // 监听页面导航事件，检测URL变化
        page.onFrameNavigated(frame -> {
            if (frame == page.mainFrame()) {
                if (!zhilianMonitoringPaused) {
                    checkZhilianLoginStatus(page);
                }
            }
        });

        log.info("智联招聘平台登录状态监控已启用");
    }

    /**
     * 检查智联招聘登录状态
     *
     * @param page 页面实例
     */
    private void checkZhilianLoginStatus(Page page) {
        try {
            boolean isLoggedIn = checkIfZhilianLoggedIn();
            // 如果登录状态发生变化（从未登录变为已登录）
            Boolean previousStatus = loginStatus.get("zhilian");
            if (isLoggedIn && (previousStatus == null || !previousStatus)) {
                onZhilianLoginSuccess();
            }
        } catch (Exception e) {
            // 忽略检查过程中的异常，避免影响正常流程
            log.debug("检查智联招聘平台登录状态时发生异常: {}", e.getMessage());
        }
    }

    /**
     * 主动触发智联招聘登录：点击二维码入口并等待登录成功跳转
     */
    public void triggerZhilianLogin() {
        try {
            Page page = ensureZhilianPage();
            zhilianLoginGuided = false;

            if (!navigateZhilianPage(page, ZHILIAN_URL, "zhaopin.com")) {
                throw new IllegalStateException("智联招聘首页打开失败");
            }

            if (checkIfZhilianLoggedIn()) {
                onZhilianLoginSuccess();
                return;
            }

            if (navigateZhilianPage(page, ZHILIAN_LOGIN_URL, "passport.zhaopin.com")) {
                openZhilianQrLoginPanel(page);
            }

            setLoginStatus("zhilian", false);
            // 不阻塞等待扫码，页面导航监听会在登录成功后自动保存 Cookie。
        } catch (Exception e) {
            log.error("触发智联登录流程失败: {}", e.getMessage(), e);
            throw new RuntimeException("触发智联登录流程失败", e);
        }
    }

    /**
     * 主动打开智联招聘平台或登录页。用于配置页按钮快速恢复平台页面。
     */
    public boolean openZhilianPlatformPage() {
        try {
            Page page = ensureZhilianPage();
            zhilianLoginGuided = false;
            if (!navigateZhilianPage(page, ZHILIAN_URL, "zhaopin.com")) {
                throw new IllegalStateException("智联招聘首页打开失败");
            }

            boolean loggedIn = checkIfZhilianLoggedIn();
            if (loggedIn) {
                setLoginStatus("zhilian", true);
                return true;
            }

            if (navigateZhilianPage(page, ZHILIAN_LOGIN_URL, "passport.zhaopin.com")) {
                openZhilianQrLoginPanel(page);
            }
            setLoginStatus("zhilian", false);
            return false;
        } catch (Exception e) {
            log.error("打开智联招聘平台页面失败: {}", e.getMessage(), e);
            throw new RuntimeException("打开智联招聘平台页面失败", e);
        }
    }

    /**
     * 智联招聘登录成功回调
     */
    private void onZhilianLoginSuccess() {
        log.info("智联招聘平台登录成功");

        // 更新登录状态并通知
        setLoginStatus("zhilian", true);

        // 登录成功时保存 Cookie 到数据库
        saveZhilianCookiesToDatabase("login success");
    }

    /**
     * 保存智联招聘Cookie到数据库
     *
     * @param remark 备注信息
     */
    private void saveZhilianCookiesToDatabase(String remark) {
        try {
            List<com.microsoft.playwright.options.Cookie> cookies = context.cookies();
            // 使用ObjectMapper序列化为JSON字符串
            String cookieJson = new ObjectMapper().writeValueAsString(cookies);
            boolean result = cookieService.saveOrUpdateCookie("zhilian", cookieJson, remark);
            if (result) {
                log.info("保存智联招聘Cookie成功，共 {} 条，remark={}", cookies.size(), remark);
            }
        } catch (Exception e) {
            log.warn("保存智联招聘Cookie失败: {}", e.getMessage());
        }
    }

    /**
     * 主动保存智联招聘Cookie到数据库（用于调试/验证）
     */
    public void saveZhilianCookiesToDb(String remark) {
        saveZhilianCookiesToDatabase(remark);
    }

    /**
     * 统一按平台保存 Cookie 到数据库
     *
     * @param platform 平台标识（boss/liepin/51job/zhilian）
     * @param remark   备注
     */
    public void saveCookiesToDb(String platform, String remark) {
        switch (platform) {
            case "boss" -> saveBossCookiesToDatabase(remark);
            case "liepin" -> saveLiepinCookiesToDatabase(remark);
            case "51job" -> save51jobCookiesToDatabase(remark);
            case "zhilian" -> saveZhilianCookiesToDatabase(remark);
            default -> throw new IllegalArgumentException("Unsupported platform: " + platform);
        }
    }

    /**
     * 清理智联招聘上下文中的Cookie
     */
    public void clearZhilianCookies() {
        try {
            if (context != null) {
                context.clearCookies();
                log.info("已清理共享上下文中的所有Cookie");
            } else {
                log.warn("共享上下文不存在，无法清理Cookie");
            }
        } catch (Exception e) {
            log.error("清理共享上下文Cookie失败: {}", e.getMessage(), e);
            throw new RuntimeException("清理共享上下文Cookie失败", e);
        }
    }

    /**
     * 暂停智联招聘页面的后台登录监控（避免与业务流程并发操作页面）
     */
    public void pauseZhilianMonitoring() {
        zhilianMonitoringPaused = true;
        log.debug("智联招聘登录监控已暂停");
    }

    /**
     * 恢复智联招聘页面的后台登录监控
     */
    public void resumeZhilianMonitoring() {
        zhilianMonitoringPaused = false;
        log.debug("智联招聘登录监控已恢复");
    }

    /**
     * 检查猎聘登录状态
     *
     * @param page 页面实例
     */
    private void checkLiepinLoginStatus(Page page) {
        try {
            boolean isLoggedIn = checkIfLiepinLoggedIn();
            // 如果登录状态发生变化（从未登录变为已登录）
            Boolean previousStatus = loginStatus.get("liepin");
            if (isLoggedIn && (previousStatus == null || !previousStatus)) {
                onLiepinLoginSuccess();
            }
        } catch (Exception e) {
            // 忽略检查过程中的异常，避免影响正常流程
            log.debug("检查猎聘平台登录状态时发生异常: {}", e.getMessage());
        }
    }

    /**
     * 猎聘登录成功回调
     */
    private void onLiepinLoginSuccess() {
        log.info("猎聘平台登录成功");

        // 更新登录状态并通知
        setLoginStatus("liepin", true);

        // 登录成功时保存 Cookie 到数据库
        saveLiepinCookiesToDatabase("login success");
    }

    /**
     * 保存猎聘Cookie到数据库
     *
     * @param remark 备注信息
     */
    private void saveLiepinCookiesToDatabase(String remark) {
        try {
            List<com.microsoft.playwright.options.Cookie> cookies = context.cookies();
            // 使用ObjectMapper序列化为JSON字符串
            String cookieJson = new ObjectMapper().writeValueAsString(cookies);
            boolean result = cookieService.saveOrUpdateCookie("liepin", cookieJson, remark);
            if (result) {
                log.info("保存猎聘Cookie成功，共 {} 条，remark={}", cookies.size(), remark);
            }
        } catch (Exception e) {
            log.warn("保存猎聘Cookie失败: {}", e.getMessage());
        }
    }

    /**
     * 主动保存猎聘Cookie到数据库（用于调试/验证）
     */
    public void saveLiepinCookiesToDb(String remark) {
        saveLiepinCookiesToDatabase(remark);
    }

    /**
     * 清理猎聘上下文中的Cookie
     */
    public void clearLiepinCookies() {
        try {
            if (context != null) {
                context.clearCookies();
                log.info("已清理共享上下文中的所有Cookie");
            } else {
                log.warn("共享上下文不存在，无法清理Cookie");
            }
        } catch (Exception e) {
            log.error("清理共享上下文Cookie失败: {}", e.getMessage(), e);
            throw new RuntimeException("清理共享上下文Cookie失败", e);
        }
    }

    /**
     * 暂停猎聘页面的后台登录监控（避免与业务流程并发操作页面）
     */
    public void pauseLiepinMonitoring() {
        liepinMonitoringPaused = true;
        log.debug("猎聘登录监控已暂停");
    }

    /**
     * 恢复猎聘页面的后台登录监控
     */
    public void resumeLiepinMonitoring() {
        liepinMonitoringPaused = false;
        log.debug("猎聘登录监控已恢复");
    }

    /**
     * 检查登录状态
     *
     * @param page     页面实例
     * @param platform 平台名称
     */
    private void checkLoginStatus(Page page, String platform) {
        try {
            boolean isLoggedIn = false;
            if (platform.equals("boss")) {
                // 统一复用更稳健的Boss登录判断逻辑
                isLoggedIn = checkIfLoggedIn();
            }
            // 如果登录状态发生变化（从未登录变为已登录）
            Boolean previousStatus = loginStatus.get(platform);
            if (isLoggedIn && (previousStatus == null || !previousStatus)) {
                onLoginSuccess(platform);
            }
        } catch (Exception e) {
            // 忽略检查过程中的异常，避免影响正常流程
            log.debug("检查{}平台登录状态时发生异常: {}", platform, e.getMessage());
        }
    }

    /**
     * 登录成功回调
     *
     * @param platform 平台名称
     */
    private void onLoginSuccess(String platform) {
        log.info("{}平台登录成功", platform);

        // 更新登录状态并通知（统一使用setLoginStatus方法）
        setLoginStatus(platform, true);

        // 登录成功时保存 Cookie 到数据库（仅 boss 平台）
        if ("boss".equals(platform)) {
            saveBossCookiesToDatabase("login success");
        }
    }

    /**
     * 统一的Boss Cookie保存方法（使用JSON序列化）
     *
     * @param remark 备注信息
     */
    private void saveBossCookiesToDatabase(String remark) {
        try {
            List<com.microsoft.playwright.options.Cookie> cookies = filterBossCookies(context.cookies());
            // 使用ObjectMapper序列化为JSON字符串
            String cookieJson = new ObjectMapper().writeValueAsString(cookies);
            boolean result = cookieService.saveOrUpdateCookie("boss", cookieJson, remark);
            if (result) {
                log.info("保存Boss Cookie成功，共 {} 条，remark={}", cookies.size(), remark);
            }
        } catch (Exception e) {
            log.warn("保存Boss Cookie失败: {}", e.getMessage());
        }
    }

    public boolean reloadBossCookiesFromDb() {
        try {
            if (context == null) {
                log.warn("共享上下文不存在，无法重新加载Boss Cookie");
                return false;
            }

            CookieEntity cookieEntity = cookieService.getCookieByPlatform("boss");
            if (cookieEntity == null || cookieEntity.getCookieValue() == null || cookieEntity.getCookieValue().isBlank()) {
                log.warn("数据库未找到Boss Cookie或值为空，无法重新加载");
                setLoginStatus("boss", false);
                return false;
            }

            List<Cookie> cookies = parseCookiesFromString(cookieEntity.getCookieValue());
            if (cookies.isEmpty()) {
                log.warn("解析Boss Cookie为空，无法重新加载");
                setLoginStatus("boss", false);
                return false;
            }

            context.addCookies(cookies);
            Page page = ensureBossPage();
            navigateBossPage(page, BOSS_URL, "zhipin.com");
            boolean loggedIn = checkIfLoggedIn();
            setLoginStatus("boss", loggedIn);
            log.info("已重新加载Boss Cookie并刷新登录状态: loggedIn={}, cookieCount={}", loggedIn, cookies.size());
            return loggedIn;
        } catch (Exception e) {
            log.warn("重新加载Boss Cookie失败: {}", e.getMessage());
            setLoginStatus("boss", false);
            return false;
        }
    }

    /**
     * 主动刷新 Boss 登录状态。用于配置页打开或用户扫码后手动查询最新状态。
     */
    public boolean refreshBossLoginStatus() {
        try {
            Page page = ensureBossPage();
            if (isLoggedIn("boss") && checkIfLoggedIn()) {
                saveBossCookiesToDatabase("login status refresh");
                return true;
            }

            String currentUrl = null;
            try {
                currentUrl = page.url();
            } catch (Exception ignored) {}

            if (currentUrl == null || currentUrl.isBlank() || !currentUrl.contains("zhipin.com")) {
                navigateBossPage(page, BOSS_URL, "zhipin.com");
            }

            boolean loggedIn = checkIfLoggedIn();
            if (!loggedIn) {
                loggedIn = reloadBossCookiesFromDb();
            } else {
                setLoginStatus("boss", true);
                saveBossCookiesToDatabase("login status refresh");
            }
            return loggedIn;
        } catch (Exception e) {
            log.warn("刷新Boss登录状态失败: {}", e.getMessage());
            setLoginStatus("boss", false);
            return false;
        }
    }

    /**
     * 主动保存 Boss Cookie 到数据库（用于调试/验证）
     */
    public void saveBossCookiesToDb(String remark) {
        saveBossCookiesToDatabase(remark);
        reloadBossCookiesFromDb();
    }

    private List<com.microsoft.playwright.options.Cookie> filterBossCookies(List<com.microsoft.playwright.options.Cookie> cookies) {
        if (cookies == null || cookies.isEmpty()) {
            return List.of();
        }
        List<com.microsoft.playwright.options.Cookie> filtered = new ArrayList<>();
        for (com.microsoft.playwright.options.Cookie cookie : cookies) {
            String domain = cookie.domain == null ? "" : cookie.domain.toLowerCase();
            if (domain.equals("zhipin.com") || domain.equals("www.zhipin.com") || domain.endsWith(".zhipin.com")) {
                filtered.add(cookie);
            }
        }
        return filtered;
    }

    /**
     * 清理Boss上下文中的Cookie
     * 用于退出登录时清除浏览器上下文中的所有Cookie
     */
    public void clearBossCookies() {
        try {
            if (context != null) {
                context.clearCookies();
                log.info("已清理共享上下文中的所有Cookie");
            } else {
                log.warn("共享上下文不存在，无法清理Cookie");
            }
        } catch (Exception e) {
            log.error("清理共享上下文Cookie失败: {}", e.getMessage(), e);
            throw new RuntimeException("清理共享上下文Cookie失败", e);
        }
    }

    /**
     * 定时检查登录状态（每3秒）
     * 用于捕获通过DOM元素判断登录状态的场景（无导航也可触发）
     */
    @Scheduled(fixedDelay = 3000)
    public void scheduledLoginCheck() {
        try {
            if (liepinPage != null && !liepinMonitoringPaused) {
                checkLiepinLoginStatus(liepinPage);
            }
            // 其他平台如需也可启用（保留，但不强制）
            if (bossPage != null && !bossMonitoringPaused) {
                checkLoginStatus(bossPage, "boss");
            }
            if (job51Page != null && !job51MonitoringPaused) {
                check51jobLoginStatus(job51Page);
            }
            if (zhilianPage != null && !zhilianMonitoringPaused) {
                checkZhilianLoginStatus(zhilianPage);
            }
        } catch (Exception e) {
            log.debug("定时登录检测异常: {}", e.getMessage());
        }
    }

    /**
     * 暂停Boss页面的后台登录监控（避免与业务流程并发操作页面）
     */
    public void pauseBossMonitoring() {
        bossMonitoringPaused = true;
        log.debug("Boss登录监控已暂停");
    }

    /**
     * 恢复Boss页面的后台登录监控
     */
    public void resumeBossMonitoring() {
        bossMonitoringPaused = false;
        log.debug("Boss登录监控已恢复");
    }

    /**
     * 关闭Playwright实例
     * 在Spring容器销毁前自动执行
     */
    @PreDestroy
    public void destroy() {
        log.info("开始关闭Playwright管理器...");
        cleanupPlaywrightResources("关闭");
        log.info("Playwright管理器关闭完成！");
    }

    private void cleanupPlaywrightResources(String reason) {
        closePageSafely("Boss直聘", bossPage, reason);
        bossPage = null;
        closePageSafely("猎聘", liepinPage, reason);
        liepinPage = null;
        closePageSafely("51job", job51Page, reason);
        job51Page = null;
        closePageSafely("智联招聘", zhilianPage, reason);
        zhilianPage = null;

        if (context != null) {
            try {
                context.close();
                log.info("{}共享BrowserContext已关闭", reason);
            } catch (Exception e) {
                log.warn("{}共享BrowserContext失败: {}", reason, e.getMessage());
            } finally {
                context = null;
            }
        }
        if (browser != null) {
            try {
                browser.close();
                log.info("{}浏览器已关闭", reason);
            } catch (Exception e) {
                log.warn("{}浏览器失败: {}", reason, e.getMessage());
            } finally {
                browser = null;
            }
        }
        if (playwright != null) {
            try {
                playwright.close();
                log.info("{}Playwright实例已关闭", reason);
            } catch (Exception e) {
                log.warn("{}Playwright实例失败: {}", reason, e.getMessage());
            } finally {
                playwright = null;
            }
        }
        loginStatus.clear();
    }

    private void closePageSafely(String platform, Page page, String reason) {
        if (page == null) {
            return;
        }
        try {
            page.close();
            log.info("{}{}页面已关闭", reason, platform);
        } catch (Exception e) {
            log.warn("{}{}页面失败: {}", reason, platform, e.getMessage());
        }
    }

    /**
     * 检查Playwright是否已初始化
     */
    public boolean isInitialized() {
        return !playwrightInitializing
                && playwright != null
                && context != null
                && isPageAvailable(bossPage)
                && isPageAvailable(liepinPage)
                && isPageAvailable(job51Page)
                && isPageAvailable(zhilianPage);
    }

    private boolean isPageAvailable(Page page) {
        if (page == null) {
            return false;
        }
        try {
            return !page.isClosed();
        } catch (Exception e) {
            return false;
        }
    }

    public boolean isInitializing() {
        return playwrightInitializing;
    }

    public String getLastInitializationError() {
        return lastInitializationError == null ? "" : lastInitializationError;
    }

    /**
     * 获取CDP端口号
     */
    public int getCdpPort() {
        return CDP_PORT;
    }

    /**
     * 注册登录状态监听器
     *
     * @param listener 监听器
     */
    public void addLoginStatusListener(Consumer<LoginStatusChange> listener) {
        loginStatusListeners.add(listener);
    }

    /**
     * 移除登录状态监听器
     *
     * @param listener 监听器
     */
    public void removeLoginStatusListener(Consumer<LoginStatusChange> listener) {
        loginStatusListeners.remove(listener);
    }

    /**
     * 获取平台登录状态
     *
     * @param platform 平台名称
     * @return 是否已登录
     */
    public boolean isLoggedIn(String platform) {
        return loginStatus.getOrDefault(platform, false);
    }

    /**
     * 手动设置平台登录状态（会触发SSE通知）
     *
     * @param platform   平台名称
     * @param isLoggedIn 是否已登录
     */
    public void setLoginStatus(String platform, boolean isLoggedIn) {
        Boolean previousStatus = loginStatus.get(platform);

        // 只有状态真正发生变化时才更新和通知
        if (previousStatus == null || previousStatus != isLoggedIn) {
            loginStatus.put(platform, isLoggedIn);

            // Boss平台：在设置未登录状态时，顺带引导到登录页并切换二维码扫码
            if ("boss".equals(platform) && !isLoggedIn) {
                try {
                    if (bossPage != null) {
                        String currentUrl = null;
                        try { currentUrl = bossPage.url(); } catch (Exception ignored) {}

                        // 避免重复导航：若当前已在登录页则不再二次跳转
                        if (currentUrl == null || !currentUrl.contains("/web/user/")) {
                            navigateBossPage(bossPage, BOSS_LOGIN_URL, "/web/user/");
                        }

                        openBossQrLoginPanel(bossPage);
                    }
                } catch (Exception e) {
                    log.debug("设置Boss未登录状态时执行登录引导失败: {}", e.getMessage());
                }
            }

            // 通知所有监听器（触发SSE推送）
            LoginStatusChange change = new LoginStatusChange(platform, isLoggedIn, System.currentTimeMillis());
            loginStatusListeners.forEach(listener -> {
                try {
                    listener.accept(change);
                } catch (Exception e) {
                    log.error("通知登录状态监听器失败: platform={}, isLoggedIn={}", platform, isLoggedIn, e);
                }
            });

//            log.info("登录状态已更新: platform={}, isLoggedIn={}", platform, isLoggedIn);
        }
    }

    /**
     * 从JSON字符串解析Cookie列表
     *
     * @param cookieJson Cookie的JSON字符串
     * @return Cookie列表
     */
    private List<Cookie> parseCookiesFromString(String cookieJson) {
        List<Cookie> cookies = new ArrayList<>();

        try {
            ObjectMapper objectMapper = new ObjectMapper();
            com.fasterxml.jackson.databind.JsonNode jsonArray = objectMapper.readTree(cookieJson);

            for (com.fasterxml.jackson.databind.JsonNode node : jsonArray) {
                // 创建Cookie对象（name和value是必需的）
                Cookie cookie = new Cookie(
                        node.get("name").asText(),
                        node.get("value").asText()
                );

                // 设置可选字段
                if (node.has("domain") && !node.get("domain").isNull()) {
                    cookie.domain = node.get("domain").asText();
                }
                if (node.has("path") && !node.get("path").isNull()) {
                    cookie.path = node.get("path").asText();
                }
                if (node.has("expires") && !node.get("expires").isNull()) {
                    cookie.expires = node.get("expires").asDouble();
                }
                if (node.has("httpOnly") && !node.get("httpOnly").isNull()) {
                    cookie.httpOnly = node.get("httpOnly").asBoolean();
                }
                if (node.has("secure") && !node.get("secure").isNull()) {
                    cookie.secure = node.get("secure").asBoolean();
                }
                if (node.has("sameSite") && !node.get("sameSite").isNull()) {
                    String sameSite = node.get("sameSite").asText();
                    if (sameSite != null && !sameSite.isEmpty()) {
                        cookie.sameSite = com.microsoft.playwright.options.SameSiteAttribute.valueOf(
                                sameSite.toUpperCase()
                        );
                    }
                }

                cookies.add(cookie);
            }

            log.debug("成功解析Cookie，共 {} 条", cookies.size());
        } catch (Exception e) {
            log.error("解析Cookie JSON失败: {}", e.getMessage(), e);
        }

        return cookies;
    }

    /**
     * LoginStatusChange - 登录状态变化DTO
     */
    public record LoginStatusChange(String platform, boolean isLoggedIn, long timestamp) {
    }
}
