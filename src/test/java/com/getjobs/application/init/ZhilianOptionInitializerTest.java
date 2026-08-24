package com.getjobs.application.init;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.entity.ZhilianOptionEntity;
import com.getjobs.application.mapper.ZhilianOptionMapper;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ZhilianOptionInitializerTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void buildsOfficialCityAndSalaryOptionsInZhilianOrder() throws Exception {
        JsonNode data = MAPPER.readTree("""
                {
                  "hotCity": [
                    { "name": "\u6df1\u5733", "code": "765" },
                    { "name": "\u5df2\u5220\u9664\u70ed\u95e8", "code": "888", "deleted": true }
                  ],
                  "allCity": [
                    {
                      "name": "\u5b89\u5fbd",
                      "code": "541",
                      "sublist": [
                        {
                          "name": "\u5408\u80a5",
                          "code": "664",
                          "sublist": [
                            { "name": "\u5e90\u9633\u533a", "code": "999" }
                          ]
                        }
                      ]
                    },
                    {
                      "name": "\u5e7f\u4e1c",
                      "code": "763",
                      "sublist": [
                        { "name": "\u6df1\u5733", "code": "765" }
                      ]
                    }
                  ],
                  "salaryType": [
                    { "name": "\u4e0d\u9650", "code": "0000,9999999" },
                    { "name": "10K-15K", "code": "10001,15000" }
                  ]
                }
                """);

        List<ZhilianOptionInitializer.OptionSeed> options =
                ZhilianOptionInitializer.buildOptionsFromOfficialBaseData(data);

        assertThat(options)
                .extracting("type", "name", "code")
                .contains(
                        tuple("city", "\u5168\u56fd", "489"),
                        tuple("city", "\u6df1\u5733", "765"),
                        tuple("city", "\u5408\u80a5", "664"),
                        tuple("salary", "\u4e0d\u9650", "0000,9999999"),
                        tuple("salary", "10K-15K", "10001,15000")
                );
        assertThat(options)
                .filteredOn(option -> "city".equals(option.type()))
                .extracting(ZhilianOptionInitializer.OptionSeed::code)
                .containsExactly("489", "765", "664")
                .doesNotContain("999", "888");
    }

    @Test
    void fallbackOptionsContainOfficialSalaryCodes() {
        assertThat(ZhilianOptionInitializer.fallbackOptions())
                .extracting("type", "name", "code")
                .contains(
                        tuple("city", "\u5168\u56fd", "489"),
                        tuple("salary", "\u4e0d\u9650", "0000,9999999"),
                        tuple("salary", "10K-15K", "10001,15000"),
                        tuple("salary", "50K\u4ee5\u4e0a", "50001,9999999")
                );
    }

    @Test
    void failedOptionReplacementRollsBackInsteadOfLeavingPartialRows() {
        ZhilianOptionMapper mapper = mock(ZhilianOptionMapper.class);
        PlatformTransactionManager transactionManager = mock(PlatformTransactionManager.class);
        TransactionStatus transactionStatus = mock(TransactionStatus.class);
        when(transactionManager.getTransaction(any())).thenReturn(transactionStatus);
        when(mapper.insert(any(ZhilianOptionEntity.class))).thenThrow(new IllegalStateException("insert failed"));
        ZhilianOptionInitializer initializer = new ZhilianOptionInitializer(mapper, transactionManager);

        assertThatThrownBy(() -> initializer.replaceCityAndSalaryOptionsAtomically(
                ZhilianOptionInitializer.fallbackOptions()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("刷新智联城市/薪资筛选项失败，已回滚")
                .hasRootCauseMessage("insert failed");

        verify(transactionManager).rollback(transactionStatus);
        verify(transactionManager, never()).commit(transactionStatus);
    }
}
