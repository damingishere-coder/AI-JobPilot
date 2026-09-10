package com.getjobs.application.service;

import com.getjobs.application.config.CrossPlatformPathSupport;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

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
        String lower = command.toLowerCase(Locale.ROOT);
        if (isWindows() && (lower.equals("openclaw") || lower.endsWith(".cmd") || lower.endsWith(".bat"))) {
            Path entry = findOpenClawNodeEntry(command);
            if (entry != null) {
                processCommand.add("node");
                processCommand.add(entry.toString());
            } else if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
                throw new IllegalArgumentException("不允许通过 cmd 执行浏览器参数；请将 APP_OPENCLAW_COMMAND 设置为 openclaw.mjs 或可执行文件");
            } else {
                processCommand.add(command);
            }
        } else if (lower.endsWith(".mjs") || lower.endsWith(".js")) {
            processCommand.add("node");
            processCommand.add(command);
        } else {
            processCommand.add(command);
        }
        processCommand.addAll(args);
        return processCommand;
    }

    private static Path findOpenClawNodeEntry(String command) {
        List<Path> directories = new ArrayList<>();
        Path configured = Path.of(command).toAbsolutePath().normalize();
        if (!command.equalsIgnoreCase("openclaw")) directories.add(configured.getParent());
        String searchPath = System.getenv("PATH");
        if (searchPath != null && command.equalsIgnoreCase("openclaw")) {
            for (String directory : searchPath.split(java.io.File.pathSeparator)) {
                if (!directory.isBlank()) directories.add(Path.of(directory));
            }
        }
        for (Path directory : directories) {
            Path entry = directory.resolve("node_modules/openclaw/openclaw.mjs");
            if (Files.isRegularFile(entry)) return entry;
        }
        return null;
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
