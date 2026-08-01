package com.getjobs.application.service;

import com.getjobs.application.entity.BossOptionEntity;
import com.getjobs.application.mapper.BossOptionMapper;
import com.getjobs.worker.utils.JobUtils;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BossOptionMappingTest {
    @Test
    void convertsBossOptionNameToCode() {
        BossOptionMapper bossOptionMapper = mock(BossOptionMapper.class);
        when(bossOptionMapper.selectOne(any()))
                .thenReturn(null)
                .thenReturn(option("salary", "10-15K", "405"));
        BossService bossService = bossService(bossOptionMapper);

        List<String> codes = bossService.toCodes("salary", List.of("10-15K"));

        assertThat(codes).containsExactly("405");
    }

    @Test
    void convertsBossOptionCodeToName() {
        BossOptionMapper bossOptionMapper = mock(BossOptionMapper.class);
        when(bossOptionMapper.selectOne(any()))
                .thenReturn(option("experience", "1-3年", "104"));
        BossService bossService = bossService(bossOptionMapper);

        List<String> names = bossService.toNames("experience", List.of("104"));

        assertThat(names).containsExactly("1-3年");
    }

    @Test
    void convertsBachelorDegreeNameToCurrentBossCode() {
        BossOptionMapper bossOptionMapper = mock(BossOptionMapper.class);
        when(bossOptionMapper.selectOne(any()))
                .thenReturn(null)
                .thenReturn(option("degree", "本科", "203"));
        BossService bossService = bossService(bossOptionMapper);

        List<String> codes = bossService.toCodes("degree", List.of("本科"));

        assertThat(codes).containsExactly("203");
    }

    @Test
    void selectedBossFilterCodesAreAddedToSearchUrlParams() {
        assertThat(JobUtils.appendListParam("salary", List.of("405"))).isEqualTo("&salary=405");
        assertThat(JobUtils.appendListParam("experience", List.of("104"))).isEqualTo("&experience=104");
        assertThat(JobUtils.appendListParam("degree", List.of("203"))).isEqualTo("&degree=203");
        assertThat(JobUtils.appendListParam("industry", List.of("100006"))).isEqualTo("&industry=100006");
        assertThat(JobUtils.appendListParam("salary", List.of("0", "405"))).isEmpty();
    }

    private BossService bossService(BossOptionMapper bossOptionMapper) {
        return new BossService(
                bossOptionMapper,
                null,
                null,
                null,
                null,
                null,
                null
        );
    }

    private BossOptionEntity option(String type, String name, String code) {
        BossOptionEntity option = new BossOptionEntity();
        option.setType(type);
        option.setName(name);
        option.setCode(code);
        return option;
    }
}
