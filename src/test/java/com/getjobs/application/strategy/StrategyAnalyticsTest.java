package com.getjobs.application.strategy;

import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

class StrategyAnalyticsTest {
    final Instant now=Instant.parse("2030-04-01T00:00:00Z");
    StrategyAnalytics.Sample sample(long id,int age,String keyword,boolean replied,boolean observed) {
        var applied=now.minus(Duration.ofDays(age));
        return new StrategyAnalytics.Sample(id,applied,Map.of("KEYWORD",keyword),replied?applied.plus(Duration.ofDays(2)):null,observed?now:null,null,null);
    }
    @Test void missingObservationIsNotFailureAndImmaturePositiveDoesNotInflateRate() {
        var result=StrategyAnalytics.calculate(List.of(sample(1,40,"A",true,false),sample(2,40,"A",false,false),sample(3,40,"A",false,true),sample(4,2,"A",true,true)),now,90);
        assertThat(result.applications()).isEqualTo(4);
        assertThat(result.reply().mature()).isEqualTo(3);
        assertThat(result.reply().observed()).isEqualTo(2);
        assertThat(result.reply().positive()).isEqualTo(1);
        assertThat(result.reply().ratePercent()).isNull();
        assertThat(result.reply().confidence()).isEqualTo("INSUFFICIENT_DATA");
        assertThat(result.interview().observed()).isZero();
        assertThat(result.insights()).isEmpty();
    }
    @Test void firstApplicationWinsAndSnapshotsHaveDeterministicTransparentComparison() {
        var samples=new ArrayList<StrategyAnalytics.Sample>();
        for(int i=1;i<=40;i++) samples.add(sample(i,40,i<=20?"AI应用运营":"AI产品运营",i<=15,true));
        samples.add(sample(1,3,"错误的新关键词",false,true));
        var result=StrategyAnalytics.calculate(samples,now,90);
        assertThat(result.applications()).isEqualTo(40);
        assertThat(result.insights()).hasSize(1);
        assertThat(result.insights().getFirst().text()).contains("15/20","0/20","不代表因果");
        Collections.reverse(samples);
        assertThat(StrategyAnalytics.calculate(samples,now,90)).isEqualTo(result);
        assertThat(StrategyAnalytics.calculate(samples,now,30).applications()).isZero();
    }
}
