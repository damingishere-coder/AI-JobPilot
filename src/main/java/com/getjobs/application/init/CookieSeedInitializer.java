package com.getjobs.application.init;

import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

/** 旧初始化器兼容入口；历史 Cookie 表保留，启动时不读写或新增记录。 */
@Component
public class CookieSeedInitializer implements CommandLineRunner {
    @Override
    public void run(String... args) {
        // Deliberately no database access. Browser profiles own recruitment sessions.
    }
}
