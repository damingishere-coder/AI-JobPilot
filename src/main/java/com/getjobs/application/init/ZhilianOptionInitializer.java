package com.getjobs.application.init;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.entity.ZhilianOptionEntity;
import com.getjobs.application.mapper.ZhilianOptionMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.DependsOn;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 同步智联搜索页真实使用的城市与薪资筛选项。
 */
@Slf4j
@Component
@RequiredArgsConstructor
@DependsOn("databaseSchemaService")
public class ZhilianOptionInitializer implements CommandLineRunner {
    static final String OFFICIAL_BASE_DATA_URL = "https://fe-api.zhaopin.com/c/i/search/base/data";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Duration HTTP_TIMEOUT = Duration.ofSeconds(12);

    private final DataSource dataSource;
    private final ZhilianOptionMapper zhilianOptionMapper;

    @Override
    public void run(String... args) {
        ensureTableExists();

        List<OptionSeed> options;
        try {
            options = loadOfficialOptions();
            log.info("智联官方筛选项同步成功：{} 条", options.size());
        } catch (Exception e) {
            options = fallbackOptions();
            log.warn("智联官方筛选项同步失败，使用内置兜底选项：{}", e.getMessage());
        }

        replaceCityAndSalaryOptions(options);
    }

    private void ensureTableExists() {
        String ddl = "CREATE TABLE IF NOT EXISTS zhilian_option (" +
                " id INTEGER PRIMARY KEY AUTOINCREMENT," +
                " type VARCHAR(50)," +
                " name VARCHAR(100)," +
                " code VARCHAR(100)," +
                " sort_order INTEGER," +
                " created_at DATETIME," +
                " updated_at DATETIME" +
                ")";
        try (Connection conn = dataSource.getConnection(); Statement stmt = conn.createStatement()) {
            stmt.execute(ddl);
            log.info("确保 zhilian_option 表已存在");
        } catch (Exception e) {
            log.warn("创建 zhilian_option 表失败: {}", e.getMessage());
        }
    }

    private List<OptionSeed> loadOfficialOptions() throws Exception {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(HTTP_TIMEOUT)
                .build();
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(OFFICIAL_BASE_DATA_URL))
                .timeout(HTTP_TIMEOUT)
                .header("User-Agent", "Mozilla/5.0")
                .header("Referer", "https://www.zhaopin.com/sou/")
                .GET()
                .build();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IllegalStateException("HTTP " + response.statusCode());
        }
        JsonNode root = MAPPER.readTree(response.body());
        JsonNode data = root.path("data");
        if (!data.isObject()) {
            throw new IllegalStateException("官方接口缺少 data 节点");
        }
        List<OptionSeed> options = buildOptionsFromOfficialBaseData(data);
        if (options.stream().noneMatch(option -> "city".equals(option.type()))
                || options.stream().noneMatch(option -> "salary".equals(option.type()))) {
            throw new IllegalStateException("官方接口未返回完整城市或薪资选项");
        }
        return options;
    }

    private void replaceCityAndSalaryOptions(List<OptionSeed> options) {
        LocalDateTime now = LocalDateTime.now();
        try {
            zhilianOptionMapper.delete(
                    new QueryWrapper<ZhilianOptionEntity>()
                            .in("type", List.of("city", "salary"))
            );
            for (OptionSeed option : options) {
                ZhilianOptionEntity entity = new ZhilianOptionEntity();
                entity.setType(option.type());
                entity.setName(option.name());
                entity.setCode(option.code());
                entity.setSortOrder(option.sortOrder());
                entity.setCreatedAt(now);
                entity.setUpdatedAt(now);
                zhilianOptionMapper.insert(entity);
            }
            log.info("智联城市/薪资筛选项刷新完成：{} 条", options.size());
        } catch (Exception e) {
            log.warn("刷新智联城市/薪资筛选项失败: {}", e.getMessage());
        }
    }

    static List<OptionSeed> buildOptionsFromOfficialBaseData(JsonNode data) {
        List<OptionSeed> options = new ArrayList<>();

        Map<String, OptionSeed> cityByCode = new LinkedHashMap<>();
        putCity(cityByCode, "全国", "489");
        addTopLevelCities(cityByCode, data.path("hotCity"));
        addAllCitySecondLevel(cityByCode, data.path("allCity"));

        int sortOrder = 0;
        for (OptionSeed city : cityByCode.values()) {
            options.add(new OptionSeed("city", city.name(), city.code(), sortOrder++));
        }

        int salarySortOrder = 0;
        for (JsonNode salary : data.path("salaryType")) {
            if (!isUsableOption(salary)) continue;
            String name = text(salary, "name");
            String code = text(salary, "code");
            if (name.isBlank() || code.isBlank()) continue;
            options.add(new OptionSeed("salary", name, code, salarySortOrder++));
        }

        if (options.stream().noneMatch(option -> "salary".equals(option.type()))) {
            fallbackSalaryOptions().forEach(options::add);
        }

        return options;
    }

    static List<OptionSeed> fallbackOptions() {
        List<OptionSeed> options = new ArrayList<>();
        int sortOrder = 0;
        for (String[] city : FALLBACK_CITIES) {
            options.add(new OptionSeed("city", city[0], city[1], sortOrder++));
        }
        options.addAll(fallbackSalaryOptions());
        return options;
    }

    private static List<OptionSeed> fallbackSalaryOptions() {
        List<OptionSeed> options = new ArrayList<>();
        int sortOrder = 0;
        for (String[] salary : FALLBACK_SALARIES) {
            options.add(new OptionSeed("salary", salary[0], salary[1], sortOrder++));
        }
        return options;
    }

    private static void addTopLevelCities(Map<String, OptionSeed> cityByCode, JsonNode cities) {
        if (!cities.isArray()) return;
        for (JsonNode city : cities) {
            addCityNode(cityByCode, city);
        }
    }

    private static void addAllCitySecondLevel(Map<String, OptionSeed> cityByCode, JsonNode regions) {
        if (!regions.isArray()) return;
        for (JsonNode region : regions) {
            JsonNode sublist = region.path("sublist");
            if (sublist.isArray() && !sublist.isEmpty()) {
                for (JsonNode city : sublist) {
                    addCityNode(cityByCode, city);
                }
            } else {
                addCityNode(cityByCode, region);
            }
        }
    }

    private static void addCityNode(Map<String, OptionSeed> cityByCode, JsonNode node) {
        if (!isUsableOption(node)) return;
        String name = text(node, "name");
        String code = text(node, "code");
        putCity(cityByCode, name, code);
    }

    private static void putCity(Map<String, OptionSeed> cityByCode, String name, String code) {
        if (name == null || name.isBlank() || code == null || code.isBlank()) return;
        cityByCode.putIfAbsent(code, new OptionSeed("city", name.trim(), code.trim(), cityByCode.size()));
    }

    private static boolean isUsableOption(JsonNode node) {
        if (node == null || !node.isObject()) return false;
        return !node.path("deleted").asBoolean(false) && !node.path("delete").asBoolean(false);
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isTextual() || value.isNumber() ? value.asText().trim() : "";
    }

    record OptionSeed(String type, String name, String code, Integer sortOrder) {
    }

    private static final String[][] FALLBACK_CITIES = {
            {"全国", "489"},
            {"北京", "530"},
            {"上海", "538"},
            {"广州", "763"},
            {"深圳", "765"},
            {"天津", "531"},
            {"武汉", "736"},
            {"西安", "854"},
            {"成都", "801"},
            {"大连", "600"},
            {"长春", "613"},
            {"沈阳", "599"},
            {"南京", "635"},
            {"杭州", "653"},
            {"济南", "702"},
            {"青岛", "703"},
            {"苏州", "639"},
            {"无锡", "636"},
            {"宁波", "654"},
            {"重庆", "551"},
            {"郑州", "719"},
            {"长沙", "749"},
            {"厦门", "682"},
            {"福州", "681"},
            {"合肥", "664"}
    };

    private static final String[][] FALLBACK_SALARIES = {
            {"不限", "0000,9999999"},
            {"4K以下", "0000,4000"},
            {"4K-6K", "4001,6000"},
            {"6K-8K", "6001,8000"},
            {"8K-10K", "8001,10000"},
            {"10K-15K", "10001,15000"},
            {"15K-25K", "15001,25000"},
            {"25K-35K", "25001,35000"},
            {"35K-50K", "35001,50000"},
            {"50K以上", "50001,9999999"}
    };
}
