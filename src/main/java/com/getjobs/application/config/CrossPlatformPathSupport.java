package com.getjobs.application.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Optional;

public final class CrossPlatformPathSupport {
    private static final String SQLITE_PREFIX = "jdbc:sqlite:";

    private CrossPlatformPathSupport() {
    }

    public static Path resolveConfiguredPath(String value) {
        String normalized = expandHome(trimToDefault(value, "."));
        return Paths.get(normalized).toAbsolutePath().normalize();
    }

    public static Optional<Path> resolveOptionalPath(String value) {
        if (isBlank(value)) {
            return Optional.empty();
        }
        return Optional.of(resolveConfiguredPath(value));
    }

    public static Optional<Path> parentDirectory(String filePath) {
        String textParent = textualParent(filePath);
        if (!isBlank(textParent)) {
            return Optional.of(resolveConfiguredPath(textParent));
        }
        return resolveOptionalPath(filePath).map(path -> {
            Path parent = path.getParent();
            return parent == null ? path.toAbsolutePath().normalize() : parent;
        });
    }

    public static Optional<Path> sqliteDatabaseParent(String jdbcUrl) {
        if (isBlank(jdbcUrl) || !jdbcUrl.startsWith(SQLITE_PREFIX)) {
            return Optional.empty();
        }
        String rawPath = jdbcUrl.substring(SQLITE_PREFIX.length()).trim();
        if (rawPath.isBlank() || rawPath.equals(":memory:")) {
            return Optional.empty();
        }
        if (rawPath.startsWith("file:")) {
            rawPath = rawPath.substring("file:".length());
        }
        int queryIndex = rawPath.indexOf('?');
        if (queryIndex >= 0) {
            rawPath = rawPath.substring(0, queryIndex);
        }
        return parentDirectory(rawPath);
    }

    public static Path ensureDirectory(Path directory) throws IOException {
        return Files.createDirectories(directory);
    }

    public static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private static String trimToDefault(String value, String defaultValue) {
        return isBlank(value) ? defaultValue : value.trim();
    }

    private static String expandHome(String value) {
        if (value.equals("~")) {
            return System.getProperty("user.home");
        }
        if (value.startsWith("~/") || value.startsWith("~\\")) {
            return System.getProperty("user.home") + value.substring(1);
        }
        return value;
    }

    private static String textualParent(String value) {
        if (isBlank(value)) {
            return "";
        }
        String trimmed = value.trim();
        int slash = trimmed.lastIndexOf('/');
        int backslash = trimmed.lastIndexOf('\\');
        int index = Math.max(slash, backslash);
        if (index <= 0) {
            return "";
        }
        return trimmed.substring(0, index);
    }
}
