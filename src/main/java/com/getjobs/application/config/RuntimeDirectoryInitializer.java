package com.getjobs.application.config;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

@Slf4j
@Component
public class RuntimeDirectoryInitializer {
    @Value("${spring.datasource.url:jdbc:sqlite:./db/getjobs.db}")
    private String datasourceUrl;

    @Value("${logging.file.name:./target/logs/get-jobs.log}")
    private String loggingFileName;

    @Value("${app.paths.data-dir:./data}")
    private String dataDir;

    @Value("${app.paths.output-dir:./output}")
    private String outputDir;

    @Value("${app.paths.cache-dir:./target/cache}")
    private String cacheDir;

    @Value("${app.paths.log-dir:./target/logs}")
    private String logDir;

    @Value("${app.browser.user-data-dir:}")
    private String browserUserDataDir;

    @PostConstruct
    public void ensureRuntimeDirectories() {
        Map<String, Optional<Path>> directories = new LinkedHashMap<>();
        directories.put("data", CrossPlatformPathSupport.resolveOptionalPath(dataDir));
        directories.put("output", CrossPlatformPathSupport.resolveOptionalPath(outputDir));
        directories.put("cache", CrossPlatformPathSupport.resolveOptionalPath(cacheDir));
        directories.put("logs", CrossPlatformPathSupport.resolveOptionalPath(logDir));
        directories.put("logging.file.name", CrossPlatformPathSupport.parentDirectory(loggingFileName));
        directories.put("spring.datasource.url", CrossPlatformPathSupport.sqliteDatabaseParent(datasourceUrl));
        directories.put("browser.user-data-dir", CrossPlatformPathSupport.resolveOptionalPath(browserUserDataDir));

        directories.forEach((name, directory) -> directory.ifPresent(path -> {
            try {
                CrossPlatformPathSupport.ensureDirectory(path);
                log.debug("运行目录已就绪 [{}]: {}", name, path);
            } catch (Exception e) {
                throw new IllegalStateException("创建运行目录失败 [" + name + "]: " + path + "，请检查路径权限。", e);
            }
        }));
    }
}
