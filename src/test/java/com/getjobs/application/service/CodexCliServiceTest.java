package com.getjobs.application.service;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class CodexCliServiceTest {
    @Test
    void commandUsesReadOnlyEphemeralSessionAndOptionalImage() {
        CodexCliService service = new CodexCliService();
        Path cwd = Path.of("work");
        Path output = cwd.resolve("final.txt");
        Path image = cwd.resolve("resume.png");

        List<String> command = service.buildCommand("codex", "gpt-5.6-sol", cwd, output, image);

        assertThat(command).containsSubsequence("exec", "-C", cwd.toString());
        assertThat(command).containsSubsequence("--sandbox", "read-only");
        assertThat(command).contains("--ephemeral", "--skip-git-repo-check");
        assertThat(command).containsSubsequence("--image", image.toString());
        assertThat(command).containsSubsequence("--output-last-message", output.toString(), "-");
    }

    @Test
    void commandWrapsWindowsCmdLauncher() {
        CodexCliService service = new CodexCliService();
        Path cwd = Path.of("work");

        List<String> command = service.buildCommand(
                "C:\\Users\\demo\\AppData\\Roaming\\npm\\codex.cmd",
                "gpt-5.6-sol",
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
}
