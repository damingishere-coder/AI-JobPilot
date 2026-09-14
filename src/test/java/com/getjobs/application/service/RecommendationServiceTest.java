package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.strategy.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import java.nio.file.Path;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class RecommendationServiceTest {
    @TempDir Path directory;
    JdbcTemplate jdbc;RecommendationService service;ProfileService profiles;HrAssistantCryptoService crypto;
    @BeforeEach void setup() {
        var source=new DriverManagerDataSource("jdbc:sqlite:"+directory.resolve("ranking.db"));
        Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();jdbc=new JdbcTemplate(source);
        jdbc.update("INSERT INTO profile(id,name,is_active) VALUES(1,'fixture',1),(2,'other',0)");
        jdbc.update("INSERT INTO opportunity(id,profile_id,platform,job_key,job_name,job_snapshot) VALUES(1,1,'boss','first','AI运营','{\"location\":\"深圳\"}'),(2,1,'zhilian','second','销售','{}'),(3,2,'boss','foreign','其他','{}')");
        profiles=mock(ProfileService.class);when(profiles.getCurrentProfileId()).thenReturn(1L);crypto=new HrAssistantCryptoService(directory.resolve("fixture.key"));
        service=new RecommendationService(jdbc,profiles,new DataSourceTransactionManager(source),crypto,new ObjectMapper());
    }
    @Test void previewDoesNotPersistAndSaveIsVersionedIdempotentAndProfileScoped() {
        var preferences=new PreferenceMatcher.Preferences(List.of("运营"),List.of("深圳"),null,null,null,null,null,Set.of("CITY"));
        assertThat(service.settings().enabled()).isFalse();
        var preview=service.preview(new RecommendationService.Preview(1,preferences));
        assertThat(preview).containsEntry("strategyOrder",true).containsEntry("enabled",false);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ai",Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM delivery_attempt",Integer.class)).isZero();
        var request=new RecommendationService.Save(1,0,true,preferences);
        assertThat(service.save(request).version()).isEqualTo(1);
        assertThat(service.save(request).version()).isEqualTo(1);
        assertThatThrownBy(()->service.save(new RecommendationService.Save(1,0,false,preferences))).hasMessageContaining("已更新");
        jdbc.update("UPDATE ai SET introduce='新介绍',updated_at=CURRENT_TIMESTAMP WHERE profile_id=1");
        assertThat(service.settings().preferences().roles()).containsExactly("运营");
        assertThat(service.save(new RecommendationService.Save(1,1,false,preferences)).enabled()).isFalse();
        when(profiles.getCurrentProfileId()).thenReturn(2L);
        assertThatThrownBy(()->service.save(request)).hasMessageContaining("档案已改变");
        assertThat(service.settings().enabled()).isFalse();
    }
    @Test void validatedDimensionsDecryptAndUnresolvedOrPreviouslyAppliedJobsCannotEnterNewRecommendations() {
        String evaluated="{\"dimensions\":[{\"key\":\"CORE_SKILLS\",\"status\":\"MATCH\"},{\"key\":\"RELEVANT_EXPERIENCE\",\"status\":\"MATCH\"},{\"key\":\"ACHIEVEMENTS_COMPLEXITY\",\"status\":\"MATCH\"},{\"key\":\"INDUSTRY_TRANSFER\",\"status\":\"MATCH\"},{\"key\":\"EDUCATION_TENURE\",\"status\":\"MATCH\"}],\"hardConflicts\":[]}";
        jdbc.update("INSERT INTO job_ai_analysis(profile_id,platform,job_key,score,evaluated_result_cipher) VALUES(1,'boss','first',95,?)",crypto.encrypt(evaluated,AnalysisContextService.evaluatedResultAad(1,"boss","first")));
        var result=new ObjectMapper().valueToTree(service.recommendations());
        assertThat(result.path("items").get(0).path("fit").path("score").asInt()).isEqualTo(100);
        assertThat(result.toString()).doesNotContain("CORE_SKILLS","evaluated_result_cipher");
        jdbc.update("INSERT INTO delivery_attempt(request_key,platform,profile_id,job_key,job_row_id,state,requested_at,updated_at) VALUES('blocked','boss',1,'first',1,'UNKNOWN',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
        var filtered=new ObjectMapper().valueToTree(service.recommendations()).path("items");
        assertThat(filtered.size()).isEqualTo(1);assertThat(filtered.get(0).path("id").asLong()).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM job_ai_analysis",Integer.class)).isEqualTo(1);
    }
}
