package com.getjobs.application.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ChromeJobDtoStructureTest {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void parsesChromeBridgeJobPayloadCoreFields() throws Exception {
        ChromeJobDto job = objectMapper.readValue("""
                {
                  "id": "job-1",
                  "userId": "user-1",
                  "title": "Java工程师",
                  "company": "测试公司",
                  "salary": "20-30K",
                  "location": "深圳",
                  "experience": "3-5年",
                  "degree": "本科",
                  "description": "负责后端系统开发",
                  "deliveryStatus": "待确认",
                  "url": "https://www.zhipin.com/web/geek/job_detail/job-1",
                  "keyword": "Java"
                }
                """, ChromeJobDto.class);

        assertThat(job.getId()).isEqualTo("job-1");
        assertThat(job.getTitle()).isEqualTo("Java工程师");
        assertThat(job.getCompany()).isEqualTo("测试公司");
        assertThat(job.getDeliveryStatus()).isEqualTo("待确认");
        assertThat(job.getUrl()).contains("job_detail");
    }

    @Test
    void parsesBossListOnlyCollectionMode() throws Exception {
        ChromeJobBatchRequest request = objectMapper.readValue("""
                {
                  "runId": "boss-list-1",
                  "keyword": "Java",
                  "collectionMode": "LIST_ONLY",
                  "autoDeliver": false,
                  "jobs": [
                    {
                      "title": "Java工程师",
                      "company": "测试公司",
                      "salary": "20-30K",
                      "location": "深圳",
                      "url": "https://www.zhipin.com/job_detail/job-1.html",
                      "keyword": "Java",
                      "deliveryStatus": "LIST_COLLECTED"
                    }
                  ]
                }
                """, ChromeJobBatchRequest.class);

        assertThat(request.getCollectionMode()).isEqualTo("LIST_ONLY");
        assertThat(request.getJobs()).hasSize(1);
        assertThat(request.getJobs().getFirst().getDeliveryStatus()).isEqualTo("LIST_COLLECTED");
        assertThat(request.getAutoDeliver()).isFalse();
    }
}
