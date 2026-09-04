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
    public static final String CHROME_EXTENSION_ID = "igmjpelbjhlglhegjbgmdbgfcdflmigp";
    public static final String CHROME_EXTENSION_ORIGIN = "chrome-extension://" + CHROME_EXTENSION_ID;
    private static final List<String> LOCAL_FRONTEND_ORIGINS = List.of(
            "http://localhost:6866",
            "http://127.0.0.1:6866"
    );
    private static final List<String> EXTENSION_API_PATHS = List.of(
            "/api/boss/chrome/**",
            "/api/boss/ai-keywords",
            "/api/boss/jobs/*/delivery-result",
            "/api/zhilian/chrome/**",
            "/api/zhilian/jobs/*/delivery-result"
    );

    @Bean
    public CorsFilter corsFilter() {
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();

        CorsConfiguration localFrontendConfig = baseConfiguration(true);
        localFrontendConfig.setAllowedOrigins(LOCAL_FRONTEND_ORIGINS);

        CorsConfiguration extensionConfig = baseConfiguration(false);
        extensionConfig.setAllowedOrigins(List.of(
                LOCAL_FRONTEND_ORIGINS.get(0),
                LOCAL_FRONTEND_ORIGINS.get(1),
                CHROME_EXTENSION_ORIGIN
        ));

        // 必须先注册更具体的扩展接口，再注册全局本地前端规则。
        for (String path : EXTENSION_API_PATHS) {
            source.registerCorsConfiguration(path, extensionConfig);
        }
        source.registerCorsConfiguration("/**", localFrontendConfig);

        return new CorsFilter(source);
    }

    private CorsConfiguration baseConfiguration(boolean allowCredentials) {
        CorsConfiguration config = new CorsConfiguration();
        config.addAllowedHeader("*");
        config.addAllowedMethod("*");
        config.setAllowCredentials(allowCredentials);
        config.setMaxAge(3600L);
        return config;
    }
}
