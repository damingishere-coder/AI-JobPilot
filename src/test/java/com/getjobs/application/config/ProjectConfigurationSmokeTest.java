package com.getjobs.application.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class ProjectConfigurationSmokeTest {
    private final ObjectMapper yamlMapper = new ObjectMapper(new YAMLFactory());

    @Test
    void readsApplicationYamlConfiguration() throws Exception {
        JsonNode root = yamlMapper.readTree(Path.of("src/main/resources/application.yaml").toFile());

        assertThat(root.path("server").path("port").asText()).contains("8888");
        assertThat(root.path("spring").path("datasource").path("url").asText()).contains("jdbc:sqlite");
        assertThat(root.path("app").path("paths").path("data-dir").asText()).contains("APP_DATA_DIR");
    }

    @Test
    void windowsAndFrontendStartupEntrypointsExist() {
        assertThat(Path.of("start_windows.bat")).isRegularFile();
        assertThat(Path.of("start_windows.ps1")).isRegularFile();
        assertThat(Path.of("gradlew.bat")).isRegularFile();
        assertThat(Path.of("front/start-dev.mjs")).isRegularFile();
        assertThat(Path.of("front/start-prod.mjs")).isRegularFile();
        assertThat(Path.of("chrome-extension/manifest.json")).isRegularFile();
    }

    @Test
    void productionFrontendScriptsUseNextOutDirectory() throws Exception {
        String copyScript = Files.readString(Path.of("front/scripts/copy-dist.mjs"), StandardCharsets.UTF_8);
        String startScript = Files.readString(Path.of("front/start-prod.mjs"), StandardCharsets.UTF_8);

        assertThat(copyScript).contains("..', 'out'");
        assertThat(startScript).contains("'out'");
        assertThat(startScript).contains("http.createServer");
    }
}
