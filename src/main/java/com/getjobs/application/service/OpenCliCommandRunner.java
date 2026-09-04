package com.getjobs.application.service;

import java.time.Duration;
import java.util.List;

public interface OpenCliCommandRunner {
    CommandResult run(List<String> arguments, Duration timeout);

    record CommandResult(int exitCode, String stdout, String stderr, boolean timedOut) {
        public boolean success() {
            return !timedOut && exitCode == 0;
        }
    }
}
