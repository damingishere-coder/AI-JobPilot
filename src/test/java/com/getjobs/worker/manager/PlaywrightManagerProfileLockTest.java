package com.getjobs.worker.manager;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

@EnabledOnOs(OS.LINUX)
class PlaywrightManagerProfileLockTest {
    @TempDir
    Path tempDir;

    @Test
    void removesSingletonFilesOwnedByStoppedContainer() throws Exception {
        String currentHost = System.getenv("HOSTNAME");
        String staleHost = currentHost + "-stopped";

        Files.createSymbolicLink(tempDir.resolve("SingletonLock"), Path.of(staleHost + "-999999"));
        Files.createSymbolicLink(tempDir.resolve("SingletonCookie"), Path.of("stale-cookie"));
        Files.createSymbolicLink(tempDir.resolve("SingletonSocket"), Path.of("stale-socket"));

        PlaywrightManager.removeStaleChromiumProfileLocks(tempDir);

        assertThat(existsWithoutFollowingLinks("SingletonLock")).isFalse();
        assertThat(existsWithoutFollowingLinks("SingletonCookie")).isFalse();
        assertThat(existsWithoutFollowingLinks("SingletonSocket")).isFalse();
    }

    @Test
    void keepsSingletonLockOwnedByCurrentProcess() throws Exception {
        String currentHost = System.getenv("HOSTNAME");
        String activeOwner = currentHost + "-" + ProcessHandle.current().pid();
        Files.createSymbolicLink(tempDir.resolve("SingletonLock"), Path.of(activeOwner));

        PlaywrightManager.removeStaleChromiumProfileLocks(tempDir);

        assertThat(existsWithoutFollowingLinks("SingletonLock")).isTrue();
    }

    private boolean existsWithoutFollowingLinks(String filename) {
        return Files.exists(tempDir.resolve(filename), LinkOption.NOFOLLOW_LINKS);
    }
}
