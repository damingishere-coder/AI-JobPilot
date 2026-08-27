package com.getjobs.application.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.FileSystemResource;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class StaticResourceConfigurationTest {
    @TempDir
    Path tempDir;

    @Test
    void servesFilesInsideRootAndRejectsTraversal() throws Exception {
        Path root = Files.createDirectories(tempDir.resolve("static"));
        Files.writeString(root.resolve("index.html"), "safe");
        Files.writeString(tempDir.resolve("secret.txt"), "secret");
        StaticResourceConfiguration.BoundedStaticPathResourceResolver resolver =
                new StaticResourceConfiguration.BoundedStaticPathResourceResolver();
        FileSystemResource location = new FileSystemResource(root.toString() + java.io.File.separator);

        assertThat(resolver.resolveForTest("index.html", location)).isNotNull();
        assertThat(resolver.resolveForTest("../secret.txt", location)).isNull();
        assertThat(resolver.resolveForTest("..%2Fsecret.txt", location)).isNull();
        assertThat(resolver.resolveForTest("C:/Windows/win.ini", location)).isNull();
        assertThat(resolver.resolveForTest("//server/share/file.txt", location)).isNull();
    }
}
