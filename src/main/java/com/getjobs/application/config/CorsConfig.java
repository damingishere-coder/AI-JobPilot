package com.getjobs.application.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.List;

/**
 * CORS跨域配置
 */
@Configuration
public class CorsConfig {
    private static final List<String> LOCAL_FRONTEND_ORIGINS = List.of(
            "http://localhost:6866",
            "http://127.0.0.1:6866"
    );
    private static final List<String> BOSS_EXTENSION_API_PATHS = List.of(
            "/api/boss/chrome/**",
            "/api/boss/ai-keywords",
            "/api/boss/jobs/*/delivery-result"
    );

    @Bean
    public CorsFilter corsFilter() {
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();

        CorsConfiguration localFrontendConfig = baseConfiguration();
        localFrontendConfig.setAllowedOrigins(LOCAL_FRONTEND_ORIGINS);

        CorsConfiguration bossExtensionConfig = baseConfiguration();
        bossExtensionConfig.setAllowedOrigins(LOCAL_FRONTEND_ORIGINS);
        bossExtensionConfig.addAllowedOriginPattern("chrome-extension://*");

        // 必须先注册更具体的扩展接口，再注册全局本地前端规则。
        for (String path : BOSS_EXTENSION_API_PATHS) {
            source.registerCorsConfiguration(path, bossExtensionConfig);
        }
        source.registerCorsConfiguration("/**", localFrontendConfig);

        return new CorsFilter(source);
    }

    private CorsConfiguration baseConfiguration() {
        CorsConfiguration config = new CorsConfiguration();
        config.addAllowedHeader("*");
        config.addAllowedMethod("*");
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);
        return config;
    }
}
