package com.getjobs.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** 岗位搜索关键词的兼容解析、去重和持久化编码。 */
public final class JobKeywordCodec {
    public static final int MAX_SELECTED = 8;
    public static final int RECOMMENDED_SELECTION_COUNT = 3;

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private JobKeywordCodec() {
    }

    /**
     * 读取历史 JSON 数组或逗号、中文逗号、分号、换行分隔文本。
     * 此方法不截断历史数据，数量限制只在保存和启动前校验。
     */
    public static List<String> parse(String raw) {
        if (raw == null || raw.isBlank()) return List.of();
        String value = raw.trim();
        if (value.startsWith("[") && value.endsWith("]")) {
            try {
                JsonNode root = OBJECT_MAPPER.readTree(value);
                if (root.isArray()) {
                    List<String> values = new ArrayList<>();
                    root.forEach(item -> values.add(item.isTextual() ? item.asText() : ""));
                    return normalize(values, Integer.MAX_VALUE);
                }
            } catch (Exception ignored) {
                value = value.substring(1, value.length() - 1);
            }
        }
        return normalize(List.of(value.split("[,，;；\\r\\n]+")), Integer.MAX_VALUE);
    }

    public static List<String> normalize(Collection<?> values, int max) {
        if (values == null || values.isEmpty() || max <= 0) return List.of();
        Map<String, String> unique = new LinkedHashMap<>();
        for (Object item : values) {
            if (item == null) continue;
            String keyword = stripWrapperQuotes(String.valueOf(item).trim());
            if (keyword.isBlank()) continue;
            unique.putIfAbsent(keyword.toLowerCase(Locale.ROOT), keyword);
            if (unique.size() >= max) break;
        }
        return List.copyOf(unique.values());
    }

    public static List<String> parseAndValidate(String raw) {
        List<String> keywords = parse(raw);
        if (keywords.size() > MAX_SELECTED) {
            throw new IllegalArgumentException("岗位关键词最多选择" + MAX_SELECTED + "个，请先删减后再保存");
        }
        return keywords;
    }

    public static String validateAndSerialize(String raw) {
        return serialize(parseAndValidate(raw));
    }

    public static String serialize(Collection<?> values) {
        try {
            return OBJECT_MAPPER.writeValueAsString(normalize(values, Integer.MAX_VALUE));
        } catch (Exception e) {
            throw new IllegalArgumentException("岗位关键词格式不正确", e);
        }
    }

    private static String stripWrapperQuotes(String value) {
        if (value.length() < 2) return value;
        char first = value.charAt(0);
        char last = value.charAt(value.length() - 1);
        if ((first == '"' && last == '"') || (first == '\'' && last == '\'')) {
            return value.substring(1, value.length() - 1).trim();
        }
        return value;
    }
}
