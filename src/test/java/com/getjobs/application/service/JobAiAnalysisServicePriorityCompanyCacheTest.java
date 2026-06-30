package com.getjobs.application.service;

import com.getjobs.application.entity.PriorityCompanyEntity;
import com.getjobs.application.mapper.PriorityCompanyMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class JobAiAnalysisServicePriorityCompanyCacheTest {
    @Mock
    private ProfileService profileService;
    @Mock
    private PriorityCompanyMapper priorityCompanyMapper;

    private JobAiAnalysisService service;

    @BeforeEach
    void setUp() {
        service = new JobAiAnalysisService(
                null,
                profileService,
                null,
                priorityCompanyMapper,
                null,
                null,
                null
        );
    }

    @Test
    void priorityCompanyCacheHandlesHitMissAndDisabledCompany() {
        when(priorityCompanyMapper.selectList(any())).thenReturn(List.of(
                priorityCompany("腾讯", 1),
                priorityCompany("禁用公司", 0),
                priorityCompany("旧重点", null)
        ));

        assertThat(service.isPriorityCompany("腾讯云", 1L)).isTrue();
        assertThat(service.isPriorityCompany("普通公司", 1L)).isFalse();
        assertThat(service.isPriorityCompany("禁用公司", 1L)).isFalse();
        assertThat(service.isPriorityCompany("旧重点科技", 1L)).isTrue();
        verify(priorityCompanyMapper, times(1)).selectList(any());
    }

    @Test
    void savingPriorityCompaniesEvictsProfileCache() {
        when(profileService.getCurrentProfileId()).thenReturn(1L);
        when(priorityCompanyMapper.selectList(any()))
                .thenReturn(List.of(priorityCompany("旧公司", 1)))
                .thenReturn(List.of(priorityCompany("新公司", 1)))
                .thenReturn(List.of(priorityCompany("新公司", 1)));

        assertThat(service.isPriorityCompany("旧公司", 1L)).isTrue();

        JobAiAnalysisService.PriorityCompanyRequest request = new JobAiAnalysisService.PriorityCompanyRequest();
        request.setCompanyName("新公司");
        request.setEnabled(1);
        service.savePriorityCompanies(List.of(request));

        assertThat(service.isPriorityCompany("新公司", 1L)).isTrue();
        assertThat(service.isPriorityCompany("旧公司", 1L)).isFalse();
        verify(priorityCompanyMapper, times(3)).selectList(any());
    }

    private PriorityCompanyEntity priorityCompany(String name, Integer enabled) {
        PriorityCompanyEntity entity = new PriorityCompanyEntity();
        entity.setProfileId(1L);
        entity.setCompanyName(name);
        entity.setEnabled(enabled);
        return entity;
    }
}
