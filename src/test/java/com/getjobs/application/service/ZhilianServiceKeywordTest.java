package com.getjobs.application.service;

import com.getjobs.application.entity.ZhilianConfigEntity;
import com.getjobs.application.mapper.ZhilianConfigMapper;
import com.getjobs.application.mapper.ZhilianJobDataMapper;
import com.getjobs.application.mapper.ZhilianOptionMapper;
import org.junit.jupiter.api.Test;

import javax.sql.DataSource;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class ZhilianServiceKeywordTest {
    @Test
    void rejectsMoreThanEightKeywordsBeforeSaving() {
        ZhilianService service = new ZhilianService(
                mock(ZhilianConfigMapper.class),
                mock(ZhilianOptionMapper.class),
                mock(ZhilianJobDataMapper.class),
                mock(DataSource.class),
                mock(ProfileService.class)
        );
        ZhilianConfigEntity incoming = new ZhilianConfigEntity();
        incoming.setKeywords("1,2,3,4,5,6,7,8,9");

        assertThatThrownBy(() -> service.updateConfig(incoming))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("最多选择8个");
    }
}
