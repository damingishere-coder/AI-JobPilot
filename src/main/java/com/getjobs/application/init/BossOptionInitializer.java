package com.getjobs.application.init;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.getjobs.application.entity.BossOptionEntity;
import com.getjobs.application.mapper.BossOptionMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.DependsOn;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;

@Slf4j
@Component
@RequiredArgsConstructor
@DependsOn("databaseSchemaService")
public class BossOptionInitializer implements CommandLineRunner {
    private final BossOptionMapper bossOptionMapper;

    @Override
    public void run(String... args) {
        int created = 0;
        int updated = 0;
        boolean degreeSyncFailed = false;

        for (BossOptionSeedData.Option seed : BossOptionSeedData.options()) {
            try {
                UpsertResult result = upsert(seed);
                if (result == UpsertResult.CREATED) {
                    created++;
                } else if (result == UpsertResult.UPDATED) {
                    updated++;
                }
            } catch (Exception e) {
                if ("degree".equals(seed.type())) {
                    degreeSyncFailed = true;
                }
                log.warn("初始化 Boss 筛选项失败 type={}, code={}: {}",
                        seed.type(), seed.code(), e.getMessage());
            }
        }

        if (!degreeSyncFailed) {
            try {
                int removed = removeObsoleteDegreeOptions();
                if (removed > 0) {
                    log.info("已清理 {} 条过期 Boss 学历筛选项", removed);
                }
            } catch (Exception e) {
                log.warn("清理过期 Boss 学历筛选项失败: {}", e.getMessage());
            }
        }

        log.info("Boss 筛选项初始化完成：新增 {} 条，更新 {} 条", created, updated);
    }

    private int removeObsoleteDegreeOptions() {
        List<String> currentCodes = BossOptionSeedData.options().stream()
                .filter(seed -> "degree".equals(seed.type()))
                .map(BossOptionSeedData.Option::code)
                .toList();
        return bossOptionMapper.delete(
                new QueryWrapper<BossOptionEntity>()
                        .eq("type", "degree")
                        .notIn("code", currentCodes)
        );
    }

    private UpsertResult upsert(BossOptionSeedData.Option seed) {
        BossOptionEntity existing = bossOptionMapper.selectOne(
                new QueryWrapper<BossOptionEntity>()
                        .eq("type", seed.type())
                        .eq("code", seed.code())
                        .last("LIMIT 1")
        );

        LocalDateTime now = LocalDateTime.now();
        if (existing == null) {
            BossOptionEntity entity = new BossOptionEntity();
            entity.setType(seed.type());
            entity.setName(seed.name());
            entity.setCode(seed.code());
            entity.setSortOrder(seed.sortOrder());
            entity.setCreatedAt(now);
            entity.setUpdatedAt(now);
            bossOptionMapper.insert(entity);
            return UpsertResult.CREATED;
        }

        if (Objects.equals(existing.getName(), seed.name())
                && Objects.equals(existing.getSortOrder(), seed.sortOrder())) {
            return UpsertResult.UNCHANGED;
        }

        existing.setType(seed.type());
        existing.setName(seed.name());
        existing.setCode(seed.code());
        existing.setSortOrder(seed.sortOrder());
        existing.setUpdatedAt(now);
        bossOptionMapper.updateById(existing);
        return UpsertResult.UPDATED;
    }

    private enum UpsertResult {
        CREATED,
        UPDATED,
        UNCHANGED
    }
}
