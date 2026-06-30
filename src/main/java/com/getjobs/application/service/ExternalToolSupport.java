package com.getjobs.application.service;

import com.getjobs.application.config.CrossPlatformPathSupport;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public final class ExternalToolSupport {
    private ExternalToolSupport() {
    }

    public static String resolveOpenClawCommand(String configuredCommand) {
        if (!CrossPlatformPathSupport.isBlank(configuredCommand)) {
            return configuredCommand.trim();
        }
        Path bundledMacCommand = CrossPlatformPathSupport.resolveConfiguredPath("./bin/openclaw-node24");
        if (!isWindows() && Files.isRegularFile(bundledMacCommand)) {
            return bundledMacCommand.toString();
        }
        return "openclaw";
    }

    public static List<String> buildProcessCommand(String command, List<String> args) {
        List<String> processCommand = new ArrayList<>();
        if (isWindows()) {
            processCommand.add("cmd");
            processCommand.add("/c");
        }
        processCommand.add(command);
        processCommand.addAll(args);
        return processCommand;
    }

    public static String buildOpenClawFailureMessage(String stdout, String stderr, int exitCode) {
        String detail = !CrossPlatformPathSupport.isBlank(stderr) ? stderr : stdout;
        if (CrossPlatformPathSupport.isBlank(detail)) {
            detail = "退出码 " + exitCode;
        }
        if (isCommandNotFound(detail)) {
            return "未找到 openclaw 命令。Windows 请先安装 OpenClaw CLI，或设置 APP_OPENCLAW_COMMAND 指向 openclaw.cmd；macOS 可继续使用 bin/openclaw-node24 或 PATH 中的 openclaw。";
        }
        if (detail.contains("unknown command")) {
            return "OpenClaw browser 命令不可用，请确认 browser 插件已加入 plugins.allow。";
        }
        return truncate(detail, 500);
    }

    public static boolean isCommandNotFound(String detail) {
        if (detail == null) {
            return false;
        }
        String lower = detail.toLowerCase();
        return lower.contains("no such file")
                || lower.contains("cannot run program")
                || lower.contains("not recognized as an internal or external command")
                || lower.contains("不是内部或外部命令")
                || lower.contains("系统找不到指定的文件");
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    private static String truncate(String value, int max) {
        if (value == null) return "";
        return value.length() <= max ? value : value.substring(0, max) + "...";
    }
}
