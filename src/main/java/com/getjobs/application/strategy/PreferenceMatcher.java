package com.getjobs.application.strategy;

import com.getjobs.application.service.SalaryParser;
import java.util.*;

public final class PreferenceMatcher {
    private PreferenceMatcher() {}
    public static final Set<String> FIELDS=Set.of("ROLE","CITY","SCALE","INDUSTRY","WORK_MODE","SALARY");
    public record Preferences(List<String> roles,List<String> cities,List<String> scales,List<String> industries,List<String> workModes,Integer minSalaryK,Integer maxSalaryK,Set<String> hard) {}
    public record Fact(String title,String location,String scale,String industry,String workMode,String salary) {}
    public record Field(String key,String status,boolean hard,String reason) {}
    public record Match(Integer score,int known,int configured,int hardTier,List<Field> fields) {}
    public static Preferences normalize(Preferences value) {
        if(value==null) value=new Preferences(null,null,null,null,null,null,null,null);
        if(value.hard()!=null&&value.hard().stream().anyMatch(Objects::isNull)) throw new IllegalArgumentException("硬约束无效");
        var hard=value.hard()==null?Set.<String>of():Set.copyOf(value.hard());
        if(!FIELDS.containsAll(hard)) throw new IllegalArgumentException("未知偏好约束");
        if(value.minSalaryK()!=null&&(value.minSalaryK()<0||value.minSalaryK()>200)||value.maxSalaryK()!=null&&(value.maxSalaryK()<0||value.maxSalaryK()>200)||value.minSalaryK()!=null&&value.maxSalaryK()!=null&&value.minSalaryK()>value.maxSalaryK()) throw new IllegalArgumentException("期望月薪范围须为 0–200K，且下限不能高于上限");
        var result=new Preferences(clean(value.roles()),clean(value.cities()),clean(value.scales()),clean(value.industries()),clean(value.workModes()),value.minSalaryK(),value.maxSalaryK(),hard);
        if(!Set.of("REMOTE","HYBRID","ONSITE").containsAll(result.workModes())) throw new IllegalArgumentException("工作方式无效");
        var configured=new HashSet<String>();
        if(!result.roles().isEmpty()) configured.add("ROLE");if(!result.cities().isEmpty()) configured.add("CITY");if(!result.scales().isEmpty()) configured.add("SCALE");
        if(!result.industries().isEmpty()) configured.add("INDUSTRY");if(!result.workModes().isEmpty()) configured.add("WORK_MODE");if(result.minSalaryK()!=null||result.maxSalaryK()!=null) configured.add("SALARY");
        if(!configured.containsAll(hard)) throw new IllegalArgumentException("硬约束须填写对应偏好，留空项目请取消硬约束");
        return result;
    }
    private static List<String> clean(List<String> values) {
        if(values==null) return List.of();
        if(values.size()>20) throw new IllegalArgumentException("每项偏好最多 20 个值");
        return values.stream().map(v->{if(v==null||v.length()>100) throw new IllegalArgumentException("偏好内容无效或过长");return v.trim();}).filter(v->!v.isBlank()).distinct().toList();
    }
    public static Match match(Preferences input,Fact fact) {
        var p=normalize(input);var fields=new ArrayList<Field>();
        field(fields,"ROLE",p.roles(),fact.title(),p.hard());field(fields,"CITY",p.cities(),fact.location(),p.hard());field(fields,"SCALE",p.scales(),fact.scale(),p.hard());
        field(fields,"INDUSTRY",p.industries(),fact.industry(),p.hard());field(fields,"WORK_MODE",p.workModes(),fact.workMode(),p.hard());
        if(p.minSalaryK()!=null||p.maxSalaryK()!=null) {
            // Do not silently turn daily wages into a promised monthly salary.
            var salary=fact.salary()!=null&&fact.salary().contains("元/天")?null:SalaryParser.parse(fact.salary());
            String status;
            if(salary==null) status="UNKNOWN";
            else if(p.minSalaryK()!=null&&salary.maxK()<p.minSalaryK()||p.maxSalaryK()!=null&&salary.minK()>p.maxSalaryK()) status="CONFLICT";
            else if((p.minSalaryK()==null||salary.minK()>=p.minSalaryK())&&(p.maxSalaryK()==null||salary.maxK()<=p.maxSalaryK())) status="MATCH";
            else status="UNKNOWN"; // Partial overlap needs negotiation, not assumed acceptance.
            fields.add(new Field("SALARY",status,p.hard().contains("SALARY"),status.equals("UNKNOWN")?"薪资缺失、表达不确定或区间仅部分重叠，需核实":"平台明确薪资区间与期望范围对照"));
        }
        int known=(int)fields.stream().filter(f->!f.status().equals("UNKNOWN")).count(),matched=(int)fields.stream().filter(f->f.status().equals("MATCH")).count();
        int tier=fields.stream().anyMatch(f->f.hard()&&f.status().equals("CONFLICT"))?2:fields.stream().anyMatch(f->f.hard()&&f.status().equals("UNKNOWN"))?1:0;
        return new Match(known==0?null:(int)Math.round(100.0*matched/known),known,fields.size(),tier,fields);
    }
    private static void field(List<Field> fields,String key,List<String> desired,String actual,Set<String> hard) {
        if(desired.isEmpty()) return;
        String status=actual==null||actual.isBlank()?"UNKNOWN":desired.stream().anyMatch(v->actual.toLowerCase(Locale.ROOT).contains(v.toLowerCase(Locale.ROOT)))?"MATCH":"CONFLICT";
        fields.add(new Field(key,status,hard.contains(key),status.equals("UNKNOWN")?"平台信息未采集或不明确，需核实":"按用户明确关键词与平台字段对照"));
    }
}
