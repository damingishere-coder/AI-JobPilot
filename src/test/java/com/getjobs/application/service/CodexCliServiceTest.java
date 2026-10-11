package com.getjobs.application.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CodexCliServiceTest {
    @TempDir
    Path temporaryDirectory;

    private CodexCliService desktopService(Path bin) {
        return new CodexCliService() {
            @Override Path desktopBinDirectory() { return bin; }
        };
    }

    @Test
    void removedDesktopRuntimeUsesNewestInstalledExecutable() throws Exception {
        Path bin = Files.createDirectories(temporaryDirectory.resolve("desktop-bin"));
        Path older = Files.createDirectories(bin.resolve("1111111111111111"));
        Path newer = Files.createDirectories(bin.resolve("2222222222222222"));
        Files.writeString(older.resolve("codex.exe"), "old fixture");
        Files.writeString(newer.resolve("codex.exe"), "new fixture");
        Files.setLastModifiedTime(older, FileTime.fromMillis(1000));
        Files.setLastModifiedTime(newer, FileTime.fromMillis(2000));
        Files.createDirectories(bin.resolve("3333333333333333"));
        Path unrelated = Files.createDirectories(bin.resolve("unrelated-runtime"));
        Files.writeString(unrelated.resolve("codex.exe"), "not a desktop runtime");
        Files.writeString(bin.resolve("codex.exe"), "old unversioned launcher");

        assertThat(desktopService(bin).resolveExecutable(bin.resolve("9999999999999999/codex.exe").toString()))
                .isEqualTo(newer.resolve("codex.exe").toString());
    }

    @Test
    void existingConfiguredExecutableKeepsItsExplicitSelection() throws Exception {
        Path bin = Files.createDirectories(temporaryDirectory.resolve("desktop-bin"));
        Path configured = Files.createDirectories(bin.resolve("1111111111111111")).resolve("codex.exe");
        Files.writeString(configured, "configured fixture");
        Path newer = Files.createDirectories(bin.resolve("2222222222222222")).resolve("codex.exe");
        Files.writeString(newer, "new fixture");

        assertThat(desktopService(bin).resolveExecutable(configured.toString())).isEqualTo(configured.toString());
    }

    @Test
    void missingCustomPathDoesNotSwitchToDesktopInstallation() throws Exception {
        Path bin = Files.createDirectories(temporaryDirectory.resolve("desktop-bin"));
        Path installed = Files.createDirectories(bin.resolve("1111111111111111")).resolve("codex.exe");
        Files.writeString(installed, "installed fixture");

        assertThatThrownBy(() -> desktopService(bin).resolveExecutable(temporaryDirectory.resolve("custom/codex.exe").toString()))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("未找到 Codex CLI");
    }

    @Test
    void incompleteDesktopInstallationDoesNotUseUnversionedLauncher() throws Exception {
        Path bin = Files.createDirectories(temporaryDirectory.resolve("desktop-bin"));
        Files.createDirectories(bin.resolve("1111111111111111"));
        Files.writeString(bin.resolve("codex.exe"), "old unversioned launcher");

        assertThatThrownBy(() -> desktopService(bin).resolveExecutable(bin.resolve("9999999999999999/codex.exe").toString()))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("未找到 Codex CLI");
    }

    @Test
    void jobAnalysisOverridesDesktopSettingsAndRetainsReadOnlyStructuredExecution() {
        CodexCliService service = new CodexCliService();
        Path cwd = Path.of("work");
        Path output = cwd.resolve("final.txt");
        Path schema = cwd.resolve("schema.json");
        List<String> command = service.buildCommandWithImages(
                "codex", "gpt-6.1-sol", cwd, output, List.of(), schema, true);
        assertThat(command).containsSubsequence("--model", "gpt-6.1-sol")
                .contains("--ignore-user-config")
                .containsSubsequence("-c", "model_reasoning_effort=\"high\"")
                .containsSubsequence("-c", "approval_policy=\"never\"")
                .containsSubsequence("--sandbox", "read-only")
                .containsSubsequence("--output-schema", schema.toString())
                .containsSubsequence("--output-last-message", output.toString(), "-");
        assertThat(service.buildCommand("codex", "gpt-6.1-sol", cwd, output, null))
                .doesNotContain("--ignore-user-config", "model_reasoning_effort=\"high\"");
    }
    @Test
    void commandUsesReadOnlyEphemeralSessionAndOptionalImage() {
        CodexCliService service = new CodexCliService();
        Path cwd = Path.of("work");
        Path output = cwd.resolve("final.txt");
        Path image = cwd.resolve("resume.png");

        List<String> command = service.buildCommand("codex", "gpt-6-astra", cwd, output, image);

        assertThat(command).containsSubsequence("exec", "-C", cwd.toString());
        assertThat(command).containsSubsequence("--sandbox", "read-only");
        assertThat(command).contains("--ephemeral", "--skip-git-repo-check");
        assertThat(command).containsSubsequence("--image", image.toString());
        assertThat(command).containsSubsequence("--output-last-message", output.toString(), "-");
    }

    @Test
    void commandAttachesAllResumePagesToOneCodexRequest() {
        CodexCliService service = new CodexCliService();
        Path cwd = Path.of("work");
        Path first = cwd.resolve("page-1.jpg");
        Path second = cwd.resolve("page-2.jpg");

        List<String> command = service.buildCommandWithImages(
                "codex", "gpt-5.6-sol", cwd, cwd.resolve("final.txt"), List.of(first, second));

        assertThat(command).containsSubsequence("--image", first.toString(), second.toString());
        assertThat(command.stream().filter("--image"::equals)).hasSize(1);
    }

    @Test
    void structuredCommandPassesOutputSchemaWithoutChangingOtherRequests() {
        CodexCliService service = new CodexCliService();
        Path cwd = Path.of("work");
        Path output = cwd.resolve("final.txt");
        Path schema = cwd.resolve("output-schema.json");

        List<String> command = service.buildCommandWithImages(
                "codex", "gpt-5.6-sol", cwd, output, List.of(), schema);

        assertThat(command).containsSubsequence("--output-schema", schema.toString());
        assertThat(command).containsSubsequence("--output-last-message", output.toString(), "-");
        assertThat(service.buildCommand("codex", "gpt-5.6-sol", cwd, output, null))
                .doesNotContain("--output-schema");
    }

    @Test
    void commandWrapsWindowsCmdLauncher() {
        CodexCliService service = new CodexCliService();
        Path cwd = Path.of("work");

        List<String> command = service.buildCommand(
                "C:\\Users\\demo\\AppData\\Roaming\\npm\\codex.cmd",
                "gpt-6-astra",
                cwd,
                cwd.resolve("final.txt"),
                null
        );

        assertThat(command).startsWith(
                System.getenv().getOrDefault("ComSpec", "cmd.exe"),
                "/d",
                "/s",
                "/c",
                "C:\\Users\\demo\\AppData\\Roaming\\npm\\codex.cmd"
        );
    }

    @Test
    void executableValidationAllowsPortableCodexName() {
        CodexCliService service = new CodexCliService();

        service.validateExecutableName("codex");
    }

    @Test
    @EnabledOnOs(OS.WINDOWS)
    void executableValidationAllowsWindowsCodexLaunchersOnWindows() {
        CodexCliService service = new CodexCliService();

        service.validateExecutableName("C:\\Users\\demo\\AppData\\Roaming\\npm\\codex.cmd");
        service.validateExecutableName("C:\\tools\\codex.exe");
    }

    @Test
    @EnabledOnOs({OS.LINUX, OS.MAC})
    void executableValidationAllowsUnixCodexLauncherOnUnix() {
        CodexCliService service = new CodexCliService();

        service.validateExecutableName("/usr/local/bin/codex");
    }

    @Test
    void executableValidationRejectsOtherProgramsAndInjectedArguments() {
        CodexCliService service = new CodexCliService();

        assertThatThrownBy(() -> service.validateExecutableName("powershell.exe"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("仅允许 Codex CLI");
        assertThatThrownBy(() -> service.validateExecutableName("codex.cmd --dangerous-argument"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不允许其他程序或命令参数");
    }

    @Test
    void remainingMillisUsesOneSharedDeadline() {
        CodexCliService service = new CodexCliService();

        assertThat(service.remainingMillis(System.nanoTime() - 1)).isZero();
        long futureDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        assertThat(service.remainingMillis(futureDeadline)).isBetween(1L, 2000L);
    }

    @Test
    void terminateProcessTreeStopsDescendantsBeforeParent() throws Exception {
        CodexCliService service = new CodexCliService();
        Process process = mock(Process.class);
        ProcessHandle parent = mock(ProcessHandle.class);
        ProcessHandle firstChild = mock(ProcessHandle.class);
        ProcessHandle secondChild = mock(ProcessHandle.class);
        when(process.toHandle()).thenReturn(parent);
        when(parent.descendants()).thenReturn(Stream.of(firstChild, secondChild));
        when(process.waitFor(2, TimeUnit.SECONDS)).thenReturn(true);

        service.terminateProcessTree(process);

        var order = inOrder(secondChild, firstChild, process);
        order.verify(secondChild).destroy();
        order.verify(firstChild).destroy();
        order.verify(process).destroy();
        verify(process).waitFor(2, TimeUnit.SECONDS);
    }
}
