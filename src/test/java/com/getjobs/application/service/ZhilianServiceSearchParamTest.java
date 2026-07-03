package com.getjobs.application.service;

import com.getjobs.application.entity.ZhilianOptionEntity;
import com.getjobs.application.mapper.ZhilianOptionMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ZhilianServiceSearchParamTest {
    @Test
    void normalizesLegacyCityValuesToOfficialCityCodes() {
        ZhilianService service = zhilianService(mock(ZhilianOptionMapper.class));

        assertThat(service.normalizeCityCode(null)).isEqualTo(ZhilianService.DEFAULT_CITY_CODE);
        assertThat(service.normalizeCityCode("")).isEqualTo(ZhilianService.DEFAULT_CITY_CODE);
        assertThat(service.normalizeCityCode("0")).isEqualTo(ZhilianService.DEFAULT_CITY_CODE);
        assertThat(service.normalizeCityCode("\u4e0d\u9650")).isEqualTo(ZhilianService.DEFAULT_CITY_CODE);
        assertThat(service.normalizeCityCode("765")).isEqualTo("765");
    }

    @Test
    void convertsCityNameToOfficialCodeWhenOptionExists() {
        ZhilianOptionMapper optionMapper = mock(ZhilianOptionMapper.class);
        when(optionMapper.selectOne(any())).thenReturn(option("city", "\u6df1\u5733", "765"));
        ZhilianService service = zhilianService(optionMapper);

        assertThat(service.normalizeCityCode("\u6df1\u5733")).isEqualTo("765");
    }

    @Test
    void normalizesSalaryToOfficialSalaryTypeCodesOnly() {
        ZhilianService service = zhilianService(mock(ZhilianOptionMapper.class));

        assertThat(service.normalizeSalaryCode(null)).isEqualTo(ZhilianService.DEFAULT_SALARY_CODE);
        assertThat(service.normalizeSalaryCode("")).isEqualTo(ZhilianService.DEFAULT_SALARY_CODE);
        assertThat(service.normalizeSalaryCode("0")).isEqualTo(ZhilianService.DEFAULT_SALARY_CODE);
        assertThat(service.normalizeSalaryCode("\u4e0d\u9650")).isEqualTo(ZhilianService.DEFAULT_SALARY_CODE);
        assertThat(service.normalizeSalaryCode("10001,15000")).isEqualTo("10001,15000");
        assertThat(service.normalizeSalaryCode("12000,30000")).isEqualTo(ZhilianService.DEFAULT_SALARY_CODE);
    }

    @Test
    void convertsSalaryNameToOfficialCodeWhenOptionExists() {
        ZhilianOptionMapper optionMapper = mock(ZhilianOptionMapper.class);
        when(optionMapper.selectOne(any()))
                .thenReturn(null)
                .thenReturn(option("salary", "10K-15K", "10001,15000"));
        ZhilianService service = zhilianService(optionMapper);

        assertThat(service.normalizeSalaryCode("10K-15K")).isEqualTo("10001,15000");
    }

    private ZhilianService zhilianService(ZhilianOptionMapper optionMapper) {
        return new ZhilianService(
                null,
                optionMapper,
                null,
                null,
                null
        );
    }

    private ZhilianOptionEntity option(String type, String name, String code) {
        ZhilianOptionEntity option = new ZhilianOptionEntity();
        option.setType(type);
        option.setName(name);
        option.setCode(code);
        return option;
    }
}
