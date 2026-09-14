package com.getjobs.application.strategy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

class RecommendationRankingTest {
    @Test void missingAndOverlappingSalaryRemainUnknownRatherThanZeroOrSatisfied() {
        var preferences=new PreferenceMatcher.Preferences(List.of("运营"),List.of("深圳"),null,null,null,15,25,Set.of("CITY","SALARY"));
        var missing=PreferenceMatcher.match(preferences,new PreferenceMatcher.Fact("AI运营",null,null,null,null,"面议"));
        assertThat(missing.known()).isEqualTo(1);assertThat(missing.configured()).isEqualTo(3);assertThat(missing.score()).isEqualTo(100);assertThat(missing.hardTier()).isEqualTo(1);
        assertThat(missing.fields()).filteredOn(f->f.status().equals("UNKNOWN")).hasSize(2);
        var conflict=PreferenceMatcher.match(preferences,new PreferenceMatcher.Fact("AI运营","上海",null,null,null,"5-10K"));
        assertThat(conflict.hardTier()).isEqualTo(2);
        var overlap=PreferenceMatcher.match(preferences,new PreferenceMatcher.Fact("AI运营","深圳",null,null,null,"10-30K"));
        assertThat(overlap.fields()).filteredOn(f->f.key().equals("SALARY")).allMatch(f->f.status().equals("UNKNOWN"));
        assertThat(PreferenceMatcher.match(null,new PreferenceMatcher.Fact(null,null,null,null,null,null)).score()).isNull();
    }
    @Test void fitExcludesLocationPreferenceAndDoesNotInventLegacyDimensions() throws Exception {
        var json=new ObjectMapper();var root=json.createObjectNode();var dims=root.putArray("dimensions");
        for(String key:List.of("CORE_SKILLS","RELEVANT_EXPERIENCE","ACHIEVEMENTS_COMPLEXITY","INDUSTRY_TRANSFER","EDUCATION_TENURE")) dims.addObject().put("key",key).put("status","MATCH");
        dims.addObject().put("key","LOCATION_SALARY").put("status","CONFLICT");
        assertThat(RecommendationRanking.fit(root).score()).isEqualTo(100);
        assertThat(RecommendationRanking.fit(json.readTree("{}")).score()).isNull();
        assertThat(RecommendationRanking.fit(json.readTree("{}")).version()).isEqualTo("LEGACY_COMPOSITE");
    }
    @Test void feedbackOnlyBreaksTiesWithinFitBandsAndDisabledModeRestoresOriginalRanking() {
        var preference=new PreferenceMatcher.Match(null,0,0,0,List.of());
        var legacy=new RecommendationRanking.Fit(null,"LEGACY_COMPOSITE","INSUFFICIENT_DATA",5,false);
        var favorable=new RecommendationRanking.Signal("FAVORABLE",1,20,List.of("KEYWORD"));
        var insufficient=new RecommendationRanking.Signal("INSUFFICIENT_DATA",0,0,List.of());
        var rows=List.of(new RecommendationRanking.Candidate(1,91,legacy,preference,insufficient),new RecommendationRanking.Candidate(2,83,legacy,preference,favorable),new RecommendationRanking.Candidate(3,84,legacy,preference,insufficient));
        assertThat(RecommendationRanking.sort(rows,true)).containsExactly(1L,2L,3L);
        assertThat(RecommendationRanking.sort(rows,false)).containsExactly(1L,3L,2L);
        assertThat(RecommendationRanking.signal(new ObjectMapper().createObjectNode(),Map.of()).direction()).isZero();
    }
}
