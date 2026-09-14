package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import java.nio.file.Path;
import java.util.Map;
import static org.mockito.Mockito.*;

final class AnalysisContextTestSupport {
    static AnalysisContextService create(JdbcTemplate jdbc,Path directory) {
        ConfigService config = mock(ConfigService.class);
        when(config.getAiConfigs()).thenReturn(Map.of("AI_PROVIDER","codex","CODEX_MODEL","fixture-model"));
        return new AnalysisContextService(jdbc,new ObjectMapper(),new HrAssistantCryptoService(directory.resolve("fixture.key")),config,new GreetingPolicy("",0L));
    }
}
