package com.getjobs.application.service;

import org.junit.jupiter.api.Test;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class ExternalToolSupportTest {
    @Test
    void nodeEntrypointKeepsShellMetacharactersAsOneLiteralArgument() {
        String keyword = "运营 & echo unexpected | test %PATH%";
        List<String> command = ExternalToolSupport.buildProcessCommand(
                "C:/tools/openclaw.mjs", List.of("browser", "wait", "--text", keyword));
        assertThat(command).containsExactly("node", "C:/tools/openclaw.mjs", "browser", "wait", "--text", keyword);
    }
}
