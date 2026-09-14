package com.getjobs.application.strategy;

import java.time.*;
import java.util.*;

/** Descriptive cohorts only. AI scores are grouping dimensions, never success labels. */
public final class StrategyAnalytics {
    private StrategyAnalytics() {}
    public static final String RULE_VERSION="feedback-cohort-v1";
    public static final int MINIMUM_SAMPLE=20;
    public record Sample(long opportunityId,Instant appliedAt,Map<String,String> dimensions,
                         Instant replyAt,Instant replyObservedUntil,Instant interviewAt,Instant interviewObservedUntil) {}
    public record Metric(int mature,int observed,int positive,List<Long> positiveIds,List<Long> negativeIds,List<Long> unobservedIds) {
        @com.fasterxml.jackson.annotation.JsonProperty public String confidence(){return observed<MINIMUM_SAMPLE?"INSUFFICIENT_DATA":"LOW_CONFIDENCE";}
        @com.fasterxml.jackson.annotation.JsonProperty public Integer ratePercent(){return observed<MINIMUM_SAMPLE?null:(int)Math.round(100.0*positive/observed);}
        @com.fasterxml.jackson.annotation.JsonProperty public int coveragePercent(){return mature==0?0:(int)Math.round(100.0*observed/mature);}
    }
    public record Group(String dimension,String value,int applications,Metric reply,Metric interview,List<Long> opportunityIds) {}
    public record Insight(String id,String dimension,String value,String text,int samples,String confidence) {}
    public record Result(String ruleVersion,String cutoff,int windowDays,int applications,Metric reply,Metric interview,List<Group> groups,List<Insight> insights) {}

    public static Result calculate(List<Sample> input,Instant cutoff,int days) {
        if(days!=30&&days!=90) throw new IllegalArgumentException("统计窗口只支持 30 或 90 天");
        var start=cutoff.minus(Duration.ofDays(days));
        var unique=new TreeMap<Long,Sample>();
        input.stream().sorted(Comparator.comparing(Sample::appliedAt)).filter(s->!s.appliedAt().isAfter(cutoff))
            .forEach(s->unique.putIfAbsent(s.opportunityId(),s));
        var samples=unique.values().stream().filter(s->!s.appliedAt().isBefore(start)).toList();
        Map<String,Map<String,List<Sample>>> grouping=new TreeMap<>();
        for(var sample:samples) sample.dimensions().forEach((dimension,value)->grouping.computeIfAbsent(dimension,k->new TreeMap<>())
            .computeIfAbsent(value==null||value.isBlank()?"未知":value,k->new ArrayList<>()).add(sample));
        List<Group> groups=new ArrayList<>();
        grouping.forEach((dimension,values)->values.forEach((value,rows)->groups.add(new Group(dimension,value,rows.size(),metric(rows,cutoff,false),metric(rows,cutoff,true),rows.stream().map(Sample::opportunityId).toList()))));
        List<Insight> insights=new ArrayList<>();
        // Stable ordering and minimum denominators; no causal or individual probability claims.
        for(var group:groups) {
            if(insights.size()==5) break;
            if(group.reply().observed()<MINIMUM_SAMPLE || group.value().contains("未知")) continue;
            var peers=groups.stream().filter(g->g.dimension().equals(group.dimension())&&!g.value().equals(group.value())&&!g.value().contains("未知")&&g.reply().observed()>=MINIMUM_SAMPLE).toList();
            if(peers.isEmpty()) continue;
            var comparator=peers.stream().max(Comparator.comparingInt(g->Math.abs(g.reply().ratePercent()-group.reply().ratePercent()))).orElseThrow();
            int delta=group.reply().ratePercent()-comparator.reply().ratePercent();
            if(delta<=10) continue;
            String text="“"+group.value()+"”组已核对样本回复率 "+group.reply().ratePercent()+"%（"+group.reply().positive()+"/"+group.reply().observed()+"），高于“"+comparator.value()+"”组的 "+comparator.reply().ratePercent()+"%（"+comparator.reply().positive()+"/"+comparator.reply().observed()+"）。这是当前样本的描述性差异，可审阅是否增加该方向的探索；不代表因果或个人回复概率。";
            insights.add(new Insight(group.dimension()+":"+group.value(),group.dimension(),group.value(),text,group.reply().observed(),"LOW_CONFIDENCE"));
        }
        return new Result(RULE_VERSION,cutoff.toString(),days,samples.size(),metric(samples,cutoff,false),metric(samples,cutoff,true),groups,insights);
    }
    private static Metric metric(List<Sample> rows,Instant cutoff,boolean interview) {
        int mature=0;
        List<Long> positive=new ArrayList<>(),negative=new ArrayList<>(),unknown=new ArrayList<>();
        for(var sample:rows) {
            var deadline=sample.appliedAt().plus(Duration.ofDays(interview?30:14));
            if(deadline.isAfter(cutoff)) continue; // Include neither early positives nor unripe negatives.
            mature++;
            var event=interview?sample.interviewAt():sample.replyAt();
            var observed=interview?sample.interviewObservedUntil():sample.replyObservedUntil();
            if(event!=null&&!event.isBefore(sample.appliedAt())&&!event.isAfter(deadline)) positive.add(sample.opportunityId());
            else if(observed!=null&&!observed.isAfter(cutoff)&&!observed.isBefore(deadline)) negative.add(sample.opportunityId());
            else unknown.add(sample.opportunityId());
        }
        return new Metric(mature,positive.size()+negative.size(),positive.size(),positive,negative,unknown);
    }
}
