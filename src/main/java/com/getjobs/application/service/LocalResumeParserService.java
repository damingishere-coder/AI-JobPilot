package com.getjobs.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

@Service
@RequiredArgsConstructor
public class LocalResumeParserService {
    private static final int MAX_DIAGNOSTIC_CHARS = 4_000;

    private final ObjectMapper objectMapper;

    @Value("${app.resume-parser.python:}")
    private String configuredPython;

    @Value("${app.resume-parser.script:./resume-parser/parse_document.py}")
    private String configuredScript;

    @Value("${app.resume-parser.model-dir:./.resume-models}")
    private String configuredModelDir;

    @Value("${app.resume-parser.timeout-seconds:120}")
    private int timeoutSeconds;

    @Value("${app.resume-parser.max-pages:10}")
    private int maxPages;

    @Value("${app.resume-parser.max-output-chars:200000}")
    private int maxOutputChars;

    public LocalParseOutput parse(byte[] bytes, String extension) {
        if (bytes == null || bytes.length == 0) {
            throw new IllegalArgumentException("上传文件为空");
        }
        String normalizedExtension = extension == null ? "" : extension.toLowerCase(Locale.ROOT);
        Path workDirectory = null;
        Process process = null;
        try {
            Path python = resolvePython();
            Path script = resolveProjectPath(configuredScript);
            Path modelDirectory = resolveProjectPath(configuredModelDir);
            if (!Files.isRegularFile(python)) {
                throw new IllegalStateException("本地识别环境未准备，请先运行 resume-parser/setup.ps1");
            }
            if (!Files.isRegularFile(script)) {
                throw new IllegalStateException("本地识别脚本不存在：" + script);
            }
            Files.createDirectories(modelDirectory);
            workDirectory = Files.createTempDirectory("jobpilot-resume-parse-");
            Path input = workDirectory.resolve("input" + normalizedExtension);
            Path output = workDirectory.resolve("result.json");
            Path diagnostic = workDirectory.resolve("parser.log");
            Files.write(input, bytes);

            List<String> command = List.of(
                    python.toString(), script.toString(),
                    "--input", input.toString(),
                    "--output", output.toString(),
                    "--model-dir", modelDirectory.toString(),
                    "--max-pages", String.valueOf(maxPages),
                    "--max-chars", String.valueOf(maxOutputChars)
            );
            ProcessBuilder builder = new ProcessBuilder(command)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .redirectError(diagnostic.toFile());
            builder.environment().put("HF_HUB_OFFLINE", "1");
            builder.environment().put("TRANSFORMERS_OFFLINE", "1");
            builder.environment().put("DOCLING_ARTIFACTS_PATH", modelDirectory.toString());
            builder.environment().put("HF_HOME", modelDirectory.resolve("huggingface").toString());
            process = builder.start();
            if (!process.waitFor(Math.max(1, timeoutSeconds), TimeUnit.SECONDS)) {
                terminateProcessTree(process);
                throw new IllegalStateException("本地文档识别超时（>" + timeoutSeconds + "秒）");
            }
            if (process.exitValue() != 0 || !Files.isRegularFile(output)) {
                throw new IllegalStateException("本地文档识别失败：" + readDiagnostic(diagnostic));
            }
            if (Files.size(output) > Math.max(1, maxOutputChars) * 4L) {
                throw new IllegalStateException("本地识别输出超过安全限制");
            }
            JsonNode root = objectMapper.readTree(output.toFile());
            String text = root.path("text").asText("");
            if (text.length() > maxOutputChars) {
                text = text.substring(0, maxOutputChars);
            }
            List<String> warnings = new ArrayList<>();
            root.path("warnings").forEach(item -> {
                String warning = item.asText("").trim();
                if (!warning.isEmpty()) warnings.add(warning);
            });
            return new LocalParseOutput(
                    text,
                    root.path("method").asText("docling"),
                    root.path("pageCount").asInt(0),
                    warnings
            );
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("本地文档识别被中断", e);
        } catch (IOException e) {
            throw new IllegalStateException("无法启动本地文档识别器", e);
        } finally {
            if (process != null && process.isAlive()) terminateProcessTree(process);
            deleteRecursively(workDirectory);
        }
    }

    private Path resolvePython() {
        if (configuredPython != null && !configuredPython.isBlank()) {
            return resolveProjectPath(configuredPython);
        }
        Path root = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        boolean windows = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
        return root.resolve(windows ? ".venv/Scripts/python.exe" : ".venv/bin/python").normalize();
    }

    private Path resolveProjectPath(String configured) {
        Path path = Path.of(configured == null ? "" : configured.trim());
        if (!path.isAbsolute()) {
            path = Path.of(System.getProperty("user.dir")).resolve(path);
        }
        return path.toAbsolutePath().normalize();
    }

    private String readDiagnostic(Path diagnostic) {
        try {
            if (!Files.isRegularFile(diagnostic)) return "未返回错误信息";
            String message = Files.readString(diagnostic).trim();
            if (message.length() > MAX_DIAGNOSTIC_CHARS) {
                message = message.substring(message.length() - MAX_DIAGNOSTIC_CHARS);
            }
            return message.isBlank() ? "未返回错误信息" : message;
        } catch (IOException ignored) {
            return "无法读取错误信息";
        }
    }

    private void terminateProcessTree(Process process) {
        process.descendants().forEach(handle -> {
            handle.destroy();
            if (handle.isAlive()) handle.destroyForcibly();
        });
        process.destroy();
        if (process.isAlive()) process.destroyForcibly();
    }

    private void deleteRecursively(Path root) {
        if (root == null || !Files.exists(root)) return;
        try (var paths = Files.walk(root)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // 临时文件清理失败不覆盖主错误。
                }
            });
        } catch (IOException ignored) {
            // 同上。
        }
    }

    public record LocalParseOutput(String text, String method, int pageCount, List<String> warnings) {
        public LocalParseOutput {
            text = text == null ? "" : text;
            method = method == null ? "docling" : method;
            warnings = warnings == null ? List.of() : List.copyOf(warnings);
        }
    }
}
