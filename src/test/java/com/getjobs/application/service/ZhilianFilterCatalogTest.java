package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.dto.ZhilianFilters;
import com.getjobs.application.entity.ZhilianConfigEntity;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import java.util.List;

class ZhilianFilterCatalogTest {
    @Test void roundTripsEveryOfficialFilterAndRetainsLegacyDefaults() throws Exception {
        var json = new ObjectMapper();
        var filters=json.readValue("""
          {"district":"2038","subwayLine":"201577","subwayStation":"201578",
           "education":["4","5"],"experience":["0103"],"companyType":["6;10"],"financing":["2;3;4;5;6"],
           "companySize":["3"],"workNature":["2"],"jobCategory":"3000100040000","industry":["100080000"]}
          """, ZhilianFilters.class);
        var validated=ZhilianFilterCatalog.validate("765",filters);
        var entity = new ZhilianConfigEntity(); entity.setFilters(validated);
        assertThat(entity.getFilters()).isEqualTo(filters);
        String payload=json.writeValueAsString(entity);
        assertThat(payload).contains("\"filters\"").doesNotContain("filtersJson");
        assertThat(json.readValue(payload,ZhilianConfigEntity.class).getFilters()).isEqualTo(filters);
        assertThat(new ZhilianConfigEntity().getFilters()).isEqualTo(new ZhilianFilters());
        assertThat(ZhilianFilterCatalog.options("765")).containsEntry("source","https://fe-api.zhaopin.com/c/i/search/base/data");
    }
    @Test void rejectsWrongCityCodesHierarchyBranchesAndExcessIndustrySelections() {
        var filters=new ZhilianFilters();filters.setDistrict("2038");
        assertThatThrownBy(()->ZhilianFilterCatalog.validate("530",filters)).isInstanceOf(IllegalArgumentException.class);
        filters.setDistrict("");filters.setSubwayLine("201577");filters.setSubwayStation("BAD");
        assertThatThrownBy(()->ZhilianFilterCatalog.validate("765",filters)).hasMessageContaining("地铁");
        filters.setSubwayLine("");filters.setSubwayStation("");filters.setJobCategory("19000000000000");
        assertThatThrownBy(()->ZhilianFilterCatalog.validate("765",filters)).hasMessageContaining("职位类别");
        filters.setJobCategory(""); filters.setIndustry(List.of("1","2","3","4","5","6"));
        assertThatThrownBy(()->ZhilianFilterCatalog.validate("765",filters)).hasMessageContaining("最多");
    }
}
