package com.getjobs.application.service;

import org.junit.jupiter.api.Test;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class CodexCliOutcomeTest {
    @org.junit.jupiter.api.io.TempDir Path fixtureDirectory;

    private Map<String, String> testConfig() throws IOException {
        Path executable = fixtureDirectory.resolve("codex.exe");
        Files.write(executable, new byte[0]);
        return Map.of("CODEX_PATH", executable.toString());
    }

    @Test
    void invalidExecutableIsClassifiedBeforeStartingAnything() {
        var service = new SimulatedCli(null, null, false);
        assertThatThrownBy(() -> service.generateText("synthetic", Map.of("CODEX_PATH", "missing-test-directory/codex.exe")))
                .isInstanceOfSatisfying(AiProviderException.class, error -> assertThat(error.isOutcomeUnknown()).isFalse());
        assertThat(service.starts).isZero();
    }

    @Test
    void resultAppearingAtTimeoutDoesNotConvertAnUncertainCallIntoSuccess() throws Exception {
        Process process = fakeProcess();
        var service = new SimulatedCli(process, null, false);
        when(process.waitFor(anyLong(), eq(TimeUnit.MILLISECONDS))).thenAnswer(call -> {
            Files.writeString(service.directory.resolve("final.txt"), "late synthetic result");
            return false;
        });
        assertThatThrownBy(() -> service.generateText("synthetic", testConfig()))
                .isInstanceOfSatisfying(AiProviderException.class, error -> assertThat(error.isOutcomeUnknown()).isTrue());
        assertThat(service.starts).isEqualTo(1);
    }
    @Test
    void failureBeforeStartIsKnownAndNeverRetried() throws Exception {
        var service = new SimulatedCli(null, null, true);
        assertThatThrownBy(() -> service.generateText("synthetic prompt", testConfig()))
                .isInstanceOfSatisfying(AiProviderException.class, error -> {
                    assertThat(error.isOutcomeUnknown()).isFalse();
                    assertThat(error.getClientRequestId()).isNotBlank();
                });
        assertThat(service.starts).isEqualTo(1);
    }

    @Test
    void startedTimeoutNonzeroAndMissingOrEmptyResultAreUnknownWithoutRetry() throws Exception {
        for (String failure : List.of("timeout", "exit", "missing", "empty", "write", "interrupt")) {
            Process process = fakeProcess();
            if (failure.equals("timeout")) when(process.waitFor(anyLong(), eq(TimeUnit.MILLISECONDS))).thenReturn(false);
            if (failure.equals("exit")) when(process.exitValue()).thenReturn(1);
            if (failure.equals("write")) when(process.outputWriter(any())).thenThrow(new IllegalStateException("synthetic pipe failure"));
            if (failure.equals("interrupt")) when(process.waitFor(anyLong(), eq(TimeUnit.MILLISECONDS))).thenThrow(new InterruptedException());
            var service = new SimulatedCli(process, failure.equals("empty") ? "" : null, false);
            try {
                assertThatThrownBy(() -> service.generateStructuredText("synthetic", "{}", testConfig()))
                        .as(failure).isInstanceOfSatisfying(AiProviderException.class, error -> {
                            assertThat(error.isOutcomeUnknown()).isTrue();
                            assertThat(error.getClientRequestId()).isNotBlank();
                            assertThat(error.getMessage()).contains("结果未知");
                        });
                assertThat(service.starts).isEqualTo(1);
                assertThat(Files.exists(service.directory)).isFalse();
                if (failure.equals("interrupt")) assertThat(Thread.currentThread().isInterrupted()).isTrue();
            } finally { Thread.interrupted(); }
        }
    }

    @Test
    void successfulResultIsReadOnceAndTemporaryFilesAreRemoved() throws Exception {
        var service = new SimulatedCli(fakeProcess(), " synthetic result ", false);
        assertThat(service.generateText("synthetic prompt", testConfig())).isEqualTo("synthetic result");
        assertThat(service.starts).isEqualTo(1);
        assertThat(Files.exists(service.directory)).isFalse();
    }

    private Process fakeProcess() throws Exception {
        Process process = mock(Process.class);
        when(process.outputWriter(any())).thenReturn(new java.io.BufferedWriter(new java.io.OutputStreamWriter(new ByteArrayOutputStream())));
        when(process.waitFor(anyLong(), any())).thenReturn(true);
        return process;
    }

    private static final class SimulatedCli extends CodexCliService {
        private final Process process;
        private final String result;
        private final boolean failStart;
        private int starts;
        private Path directory;
        SimulatedCli(Process process, String result, boolean failStart) {
            this.process = process; this.result = result; this.failStart = failStart;
        }
        @Override Process startProcess(ProcessBuilder builder) throws IOException {
            starts++;
            directory = builder.directory().toPath();
            if (failStart) throw new IOException("synthetic startup error");
            if (result != null) Files.writeString(directory.resolve("final.txt"), result);
            return process;
        }
    }
}
