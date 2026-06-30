package com.getjobs.application.init;

import com.getjobs.application.entity.BossOptionEntity;
import com.getjobs.application.mapper.BossOptionMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BossOptionInitializerTest {
    @Mock
    private BossOptionMapper bossOptionMapper;

    @Test
    void seedsBossOptionsWhenTableHasOnlyEmptyData() {
        when(bossOptionMapper.selectOne(any())).thenReturn(null);

        new BossOptionInitializer(bossOptionMapper).run();

        ArgumentCaptor<BossOptionEntity> captor = ArgumentCaptor.forClass(BossOptionEntity.class);
        verify(bossOptionMapper, atLeastOnce()).insert(captor.capture());
        List<BossOptionEntity> inserted = captor.getAllValues();
        Map<String, Long> countsByType = inserted.stream()
                .collect(Collectors.groupingBy(BossOptionEntity::getType, Collectors.counting()));

        assertThat(countsByType.keySet()).contains(
                "city", "industry", "experience", "jobType", "salary", "degree", "scale", "stage"
        );
        assertThat(countsByType.get("city")).isGreaterThan(1);
        assertThat(countsByType.get("industry")).isGreaterThan(1);
        assertThat(countsByType.get("salary")).isGreaterThan(1);
        assertThat(countsByType.get("experience")).isGreaterThan(1);
        assertThat(inserted).anySatisfy(option -> {
            assertThat(option.getType()).isEqualTo("city");
            assertThat(option.getName()).isEqualTo("深圳");
            assertThat(option.getCode()).isEqualTo("101280600");
        });
        assertThat(inserted).anySatisfy(option -> {
            assertThat(option.getType()).isEqualTo("salary");
            assertThat(option.getName()).isEqualTo("10-15K");
            assertThat(option.getCode()).isEqualTo("405");
        });
    }

    @Test
    void updatesExistingBossOptionsWithoutDuplicatingRows() {
        when(bossOptionMapper.selectOne(any())).thenAnswer(invocation -> existingOption());

        new BossOptionInitializer(bossOptionMapper).run();

        verify(bossOptionMapper, never()).insert(any(BossOptionEntity.class));
        verify(bossOptionMapper, atLeastOnce()).updateById(any(BossOptionEntity.class));
    }

    private BossOptionEntity existingOption() {
        BossOptionEntity entity = new BossOptionEntity();
        entity.setId(1L);
        entity.setType("city");
        entity.setName("旧选项");
        entity.setCode("0");
        entity.setSortOrder(999);
        return entity;
    }
}
