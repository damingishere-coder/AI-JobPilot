package com.getjobs.application.config;

import com.getjobs.application.service.ExternalToolSupport;
import com.getjobs.worker.utils.BrowserLaunchSettings;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class CrossPlatformCompatibilityTest {
    @TempDir
    Path tempDir;

    @Test
    void resolvesWindowsStylePathWithoutDroppingSegments() {
        Path path = CrossPlatformPathSupport.resolveConfiguredPath("C:\\Users\\YourName\\Documents\\AI-JobPilot");

        assertThat(path.toString()).contains("Users");
        assertThat(path.toString()).contains("AI-JobPilot");
    }

    @Test
    void resolvesMacAndLinuxStylePathWithoutDroppingSegments() {
        Path path = CrossPlatformPathSupport.resolveConfiguredPath("/Users/YourName/Documents/AI-JobPilot/data");

        assertThat(path.toString()).contains("Users");
        assertThat(path.toString()).contains("AI-JobPilot");
        assertThat(path.toString()).contains("data");
    }

    @Test
    void readsSqliteParentDirectoryFromConfiguration() {
        Path parent = CrossPlatformPathSupport
                .sqliteDatabaseParent("jdbc:sqlite:C:\\Users\\YourName\\Documents\\AI-JobPilot\\db\\getjobs.db")
                .orElseThrow();

        assertThat(parent.toString()).contains("AI-JobPilot");
        assertThat(parent.toString()).contains("db");
    }

    @Test
    void createsOutputAndLogDirectories() throws Exception {
        Path outputDir = tempDir.resolve("中文输出").resolve("output");
        Path logDir = tempDir.resolve("中文日志").resolve("logs");

        CrossPlatformPathSupport.ensureDirectory(outputDir);
        CrossPlatformPathSupport.ensureDirectory(logDir);

        assertThat(outputDir).isDirectory();
        assertThat(logDir).isDirectory();
    }

    @Test
    void readsAndWritesUtf8TextInChinesePath() throws Exception {
        Path file = tempDir.resolve("中文目录").resolve("配置.json");
        Files.createDirectories(file.getParent());
        Files.writeString(file, "{\"message\":\"中文路径正常\"}", StandardCharsets.UTF_8);

        assertThat(Files.readString(file, StandardCharsets.UTF_8)).contains("中文路径正常");
    }

    @Test
    void buildsBrowserSettingsFromWindowsConfiguration() {
        BrowserLaunchSettings settings = BrowserLaunchSettings.from(
                "C:\\Users\\YourName\\AppData\\Local\\AI-JobPilot\\chrome-profile",
                "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
                "chrome",
                false,
                50
        );

        assertThat(settings.usesPersistentContext()).isTrue();
        assertThat(settings.userDataDir()).isPresent();
        assertThat(settings.executablePath()).isPresent();
        assertThat(settings.channel()).contains("chrome");
    }

    @Test
    void explainsMissingExternalToolInChinese() {
        String message = ExternalToolSupport.buildOpenClawFailureMessage(
                "",
                "Cannot run program \"openclaw\": error=2, No such file or directory",
                -1
        );

        assertThat(message).contains("未找到 openclaw 命令");
        assertThat(message).contains("Windows");
    }

    @Test
    void wrapsExternalToolCommandOnWindowsOnly() {
        List<String> command = ExternalToolSupport.buildProcessCommand("openclaw", List.of("browser", "tabs"));

        if (System.getProperty("os.name", "").toLowerCase().contains("win")) {
            assertThat(command).startsWith("cmd", "/c", "openclaw");
        } else {
            assertThat(command).startsWith("openclaw");
        }
        assertThat(command).contains("browser", "tabs");
    }
}
