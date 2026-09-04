package com.getjobs.application.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@Component
public class ProcessOpenCliCommandRunner implements OpenCliCommandRunner {
    private static final int MAX_OUTPUT_BYTES = 1_048_576;
    private final String configuredExecutable;

    public ProcessOpenCliCommandRunner(@Value("${app.hr-assistant.opencli-executable:}") String configuredExecutable) {
        this.configuredExecutable = configuredExecutable == null ? "" : configuredExecutable.trim();
    }

    @Override
    public CommandResult run(List<String> arguments, Duration timeout) {
        Process process = null;
        try {
            List<String> command = buildCommand(arguments);
            Process started = new ProcessBuilder(command)
                    .redirectInput(ProcessBuilder.Redirect.PIPE)
                    .start();
            process = started;
            started.getOutputStream().close();
            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                var stdoutFuture = executor.submit(() -> readLimited(started.getInputStream()));
                var stderrFuture = executor.submit(() -> readLimited(started.getErrorStream()));
                boolean completed = started.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS);
                if (!completed) {
                    started.destroy();
                    if (!started.waitFor(2, TimeUnit.SECONDS)) started.destroyForcibly();
                }
                String stdout = stdoutFuture.get(3, TimeUnit.SECONDS);
                String stderr = stderrFuture.get(3, TimeUnit.SECONDS);
                return new CommandResult(completed ? started.exitValue() : -1, stdout, stderr, !completed);
            }
        } catch (Exception e) {
            if (process != null && process.isAlive()) process.destroyForcibly();
            return new CommandResult(-1, "", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage(), false);
        }
    }

    List<String> buildCommand(List<String> arguments) {
        List<String> command = new ArrayList<>();
        String executable = resolveExecutable();
        if (executable.toLowerCase(Locale.ROOT).endsWith(".ps1")) {
            command.add("powershell.exe");
            command.add("-NoProfile");
            command.add("-NonInteractive");
            command.add("-ExecutionPolicy");
            command.add("Bypass");
            command.add("-File");
            command.add(executable);
        } else {
            command.add(executable);
        }
        command.addAll(arguments);
        return List.copyOf(command);
    }

    private String resolveExecutable() {
        if (!configuredExecutable.isBlank()) return configuredExecutable;
        if (System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win")) {
            String appData = System.getenv("APPDATA");
            if (appData != null && !appData.isBlank()) {
                Path ps1 = Path.of(appData, "npm", "opencli.ps1");
                if (Files.isRegularFile(ps1)) return ps1.toString();
            }
        }
        return "opencli";
    }

    private String readLimited(InputStream stream) throws IOException {
        byte[] bytes = stream.readNBytes(MAX_OUTPUT_BYTES + 1);
        if (bytes.length > MAX_OUTPUT_BYTES) throw new IOException("OpenCLI 输出超过 1 MiB 安全上限");
        return new String(bytes, StandardCharsets.UTF_8).trim();
    }
}
