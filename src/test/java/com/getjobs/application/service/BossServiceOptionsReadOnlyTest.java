package com.getjobs.application.service;

import com.getjobs.application.entity.BossOptionEntity;
import com.getjobs.application.mapper.BlacklistMapper;
import com.getjobs.application.mapper.BossConfigMapper;
import com.getjobs.application.mapper.BossIndustryMapper;
import com.getjobs.application.mapper.BossJobDataMapper;
import com.getjobs.application.mapper.BossOptionMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import javax.sql.DataSource;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BossServiceOptionsReadOnlyTest {
    @Mock private BossOptionMapper bossOptionMapper;
    @Mock private BossIndustryMapper bossIndustryMapper;
    @Mock private BossConfigMapper bossConfigMapper;
    @Mock private BlacklistMapper blacklistMapper;
    @Mock private BossJobDataMapper bossJobDataMapper;
    @Mock private DataSource dataSource;
    @Mock private ProfileService profileService;
    @InjectMocks private BossService bossService;

    @Test
    void repeatedReadsAddSyntheticUnlimitedWithoutDatabaseWrites() {
        when(bossOptionMapper.selectList(any())).thenReturn(List.of());

        List<BossOptionEntity> first = bossService.getOptionsByType("city");
        List<BossOptionEntity> second = bossService.getOptionsByType("city");

        assertThat(first).extracting(BossOptionEntity::getCode).containsExactly("0");
        assertThat(second).extracting(BossOptionEntity::getCode).containsExactly("0");
        verify(bossOptionMapper, never()).insert(any(BossOptionEntity.class));
    }

    @Test
    void unlimitedOptionMappingsDoNotDependOnDatabaseRows() {
        BossOptionEntity unlimited = bossService.getOptionByTypeAndCode("city", "0");

        assertThat(unlimited.getName()).isEqualTo("不限");
        assertThat(bossService.toNames("city", List.of("0"))).containsExactly("不限");
        assertThat(bossService.toCodes("city", List.of("不限"))).containsExactly("0");
        verify(bossOptionMapper, never()).selectOne(any());
        verify(bossOptionMapper, never()).insert(any(BossOptionEntity.class));
    }
}
