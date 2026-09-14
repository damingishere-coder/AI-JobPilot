package com.getjobs.application.strategy;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;

/** Does not create tasks, mutate confirmations or predict an individual hiring probability. */
public final class RecommendationRanking {
    private RecommendationRanking() {}
    public record Fit(Integer score,String version,String confidence,int unknownDimensions,boolean hardConflict) {}
    public record Signal(String label,int direction,int samples,List<String> basis) {}
    public record Candidate(long id,Integer legacyScore,Fit fit,PreferenceMatcher.Match preference,Signal signal) {}
    private static final Map<String,Integer> WEIGHTS=Map.of("CORE_SKILLS",35,"RELEVANT_EXPERIENCE",25,"ACHIEVEMENTS_COMPLEXITY",15,"INDUSTRY_TRANSFER",10,"EDUCATION_TENURE",10);
    public static Fit fit(JsonNode evaluated) {
        var missing=new Fit(null,"LEGACY_COMPOSITE","INSUFFICIENT_DATA",5,false);
        if(evaluated==null||!evaluated.path("dimensions").isArray()) return missing;
        Set<String> seen=new HashSet<>();double sum=0;int unknown=0;
        for(var dimension:evaluated.path("dimensions")) {
            String key=dimension.path("key").asText();if(!WEIGHTS.containsKey(key)) continue;
            if(!seen.add(key)) return missing;
            String status=dimension.path("status").asText();
            double factor=switch(status){case "MATCH"->1;case "PARTIAL"->.75;case "UNKNOWN"->.6;case "CONFLICT"->0;default->-1;};
            if(factor<0) return missing;
            if(status.equals("UNKNOWN")) unknown++;
            sum+=WEIGHTS.get(key)*factor;
        }
        if(seen.size()!=5) return missing;
        return new Fit(unknown==5?null:(int)Math.round(sum/95*100),"FIT_CAPABILITY_V1",unknown==5?"INSUFFICIENT_DATA":unknown>0?"LOW_CONFIDENCE":"EVIDENCE_CHECKED",unknown,evaluated.path("hardConflicts").size()>0);
    }
    public static List<Long> sort(List<Candidate> candidates,boolean enabled) {
        Comparator<Candidate> legacy=Comparator.comparingInt((Candidate c)->c.legacyScore()==null?-1:c.legacyScore()).reversed().thenComparing(Comparator.comparingLong(Candidate::id).reversed());
        if(!enabled) return candidates.stream().sorted(legacy).map(Candidate::id).toList();
        Comparator<Candidate> strategy=Comparator.comparingInt((Candidate c)->Math.max(c.preference().hardTier(),c.fit().hardConflict()?2:0))
            .thenComparing(Comparator.comparingInt((Candidate c)->Math.floorDiv(base(c),5)).reversed())
            .thenComparing(Comparator.comparingInt((Candidate c)->c.preference().score()==null?-1:c.preference().score()).reversed())
            .thenComparing(Comparator.comparingInt((Candidate c)->c.signal().direction()).reversed())
            .thenComparing(Comparator.comparingInt(RecommendationRanking::base).reversed())
            .thenComparing(Comparator.comparingLong(Candidate::id).reversed());
        return candidates.stream().sorted(strategy).map(Candidate::id).toList();
    }
    private static int base(Candidate candidate) { return candidate.fit().score()!=null?candidate.fit().score():candidate.legacyScore()==null?-1:candidate.legacyScore(); }
    public static Signal signal(JsonNode result,Map<String,String> dimensions) {
        if(result==null) return new Signal("INSUFFICIENT_DATA",0,0,List.of());
        var overall=result.path("analysis").path("reply");
        if(overall.path("observed").asInt()<20||overall.path("ratePercent").isNull()) return new Signal("INSUFFICIENT_DATA",0,0,List.of());
        int baseline=overall.path("ratePercent").asInt(),positive=0,negative=0,min=Integer.MAX_VALUE;List<String> basis=new ArrayList<>();
        for(var group:result.path("analysis").path("groups")) {
            String dimension=group.path("dimension").asText(),value=group.path("value").asText();
            if(!Set.of("KEYWORD","ROLE","COMPANY_SCALE","SALARY").contains(dimension)||!value.equals(dimensions.get(dimension))||value.contains("未知")) continue;
            var metric=group.path("reply");int n=metric.path("observed").asInt();
            if(n<20||metric.path("coveragePercent").asInt()<50||metric.path("ratePercent").isNull()) continue;
            int delta=metric.path("ratePercent").asInt()-baseline;
            if(delta>=10) positive++;else if(delta<=-10) negative++;
            min=Math.min(min,n);basis.add(dimension+"："+value+"（"+n+" 个有效样本）");
        }
        if(basis.isEmpty()) return new Signal("INSUFFICIENT_DATA",0,0,List.of());
        int direction=positive>0&&negative==0?1:negative>0&&positive==0?-1:0;
        return new Signal(direction>0?"FAVORABLE":direction<0?"UNFAVORABLE":"MIXED",direction,min,basis);
    }
}
