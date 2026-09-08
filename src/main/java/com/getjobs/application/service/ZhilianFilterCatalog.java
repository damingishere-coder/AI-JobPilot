package com.getjobs.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.dto.ZhilianFilters;
import java.util.*;

/** Versioned public official dictionary; no guessed or cross-platform codes. */
public final class ZhilianFilterCatalog {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNode SNAPSHOT;
    static {
        try (var input = ZhilianFilterCatalog.class.getResourceAsStream("/zhilian/official-filters.json")) {
            SNAPSHOT = JSON.readTree(Objects.requireNonNull(input));
        } catch (Exception e) { throw new ExceptionInInitializerError(e); }
    }
    private static final Map<String,String> TYPES = Map.of("education","educationType", "experience","workExpType",
            "companyType","companyType", "financing","financing", "companySize","companySize", "workNature","jobStatus",
            "jobCategory","jobType", "industry","industry", "salary","salaryType");

    public static Map<String,Object> options(String cityCode) {
        String city = cityCode == null ? "489" : cityCode;
        var result = new LinkedHashMap<String,Object>();
        result.put("success",true);
        result.put("source", SNAPSHOT.path("source").asText()); result.put("version",SNAPSHOT.path("version").asText());
        result.put("sha256",SNAPSHOT.path("sha256").asText()); result.put("cityCode",city);
        var values = new LinkedHashMap<String,JsonNode>();
        TYPES.forEach((field,type)->values.put(field,SNAPSHOT.path("options").path(type)));
        JsonNode cityNode = find(SNAPSHOT.path("options").path("allCity"),city,false);
        if(cityNode==null) cityNode=find(SNAPSHOT.path("options").path("overseas"),city,false);
        if(cityNode==null && !"489".equals(city)) throw new IllegalArgumentException("智联官方字典中没有该城市："+city);
        result.put("cityName",cityNode==null ? "全国" : cityNode.path("name").asText());
        values.put("district",cityNode==null ? JSON.createArrayNode() : cityNode.path("children"));
        JsonNode subway=find(SNAPSHOT.path("options").path("subway"),city,false);
        values.put("subway",subway==null ? JSON.createArrayNode() : subway.path("children"));
        result.put("options",values);
        return result;
    }

    public static ZhilianFilters validate(String city, ZhilianFilters input) {
        ZhilianFilters filters = input == null ? new ZhilianFilters() : input;
        var options = (Map<String,JsonNode>) options(city).get("options");
        filters.setDistrict(single(options.get("district"),filters.getDistrict(),"地区",true));
        String line = Objects.toString(filters.getSubwayLine(),"");
        String station = Objects.toString(filters.getSubwayStation(),"");
        if (!line.isEmpty() || !station.isEmpty()) {
            JsonNode lineNode=find(options.get("subway"),line,false);
            if(lineNode==null || station.isEmpty() || find(lineNode.path("children"),station,true)==null)
                throw new IllegalArgumentException("地铁线路、站点与城市不匹配，请重新选择");
        }
        filters.setSubwayLine(line); filters.setSubwayStation(station);
        filters.setEducation(multi(options.get("education"),filters.getEducation(),"学历",0));
        filters.setExperience(multi(options.get("experience"),filters.getExperience(),"经验",0));
        filters.setCompanyType(multi(options.get("companyType"),filters.getCompanyType(),"公司性质",0));
        filters.setFinancing(multi(options.get("financing"),filters.getFinancing(),"融资阶段",0));
        filters.setCompanySize(multi(options.get("companySize"),filters.getCompanySize(),"公司人数",0));
        filters.setWorkNature(multi(options.get("workNature"),filters.getWorkNature(),"工作性质",0));
        filters.setIndustry(multi(options.get("industry"),filters.getIndustry(),"公司行业",5));
        filters.setJobCategory(single(options.get("jobCategory"),filters.getJobCategory(),"职位类别",true));
        return filters;
    }

    private static String single(JsonNode rows,String code,String field,boolean leaf) {
        String value=Objects.toString(code,""); if(value.isEmpty()) return "";
        JsonNode found=find(rows,value,leaf);
        if(found==null) throw new IllegalArgumentException(field+"选项不属于当前官方字典："+value);
        return value;
    }
    private static List<String> multi(JsonNode rows,List<String> codes,String field,int max) {
        List<String> result=codes==null ? new ArrayList<>() : new ArrayList<>(new LinkedHashSet<>(codes));
        if(max>0 && result.size()>max) throw new IllegalArgumentException(field+"最多选择 "+max+" 项");
        for(String code:result) {
            if(code==null || code.isBlank()) throw new IllegalArgumentException(field+"包含空选项");
            single(rows,code,field,true);
            // Top-level clear options are represented by an empty selection in our API.
            for(JsonNode row:rows) if(row.path("code").asText().equals(code)
                    && List.of("不限","全部").contains(row.path("name").asText()))
                throw new IllegalArgumentException(field+"的不限条件必须清空其他选项");
        }
        return result;
    }
    private static JsonNode find(JsonNode rows,String code,boolean leaf) {
        for(JsonNode row:rows) {
            if(row.path("code").asText().equals(code) && (!leaf || row.path("children").isEmpty())) return row;
            JsonNode found=find(row.path("children"),code,leaf); if(found!=null) return found;
        }
        return null;
    }
}
