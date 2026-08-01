package com.getjobs.application.init;

import java.util.ArrayList;
import java.util.List;

final class BossOptionSeedData {
    private static final List<Option> OPTIONS = buildOptions();

    private BossOptionSeedData() {
    }

    static List<Option> options() {
        return OPTIONS;
    }

    private static List<Option> buildOptions() {
        List<Option> options = new ArrayList<>();

        add(options, "city", 0,
                item("不限", "0"),
                item("北京", "101010100"),
                item("上海", "101020100"),
                item("广州", "101280100"),
                item("深圳", "101280600"),
                item("杭州", "101210100"),
                item("成都", "101270100"),
                item("南京", "101190100"),
                item("武汉", "101200100"),
                item("苏州", "101190400"),
                item("重庆", "101040100"),
                item("天津", "101030100"),
                item("长沙", "101250100"),
                item("青岛", "101120200"),
                item("宁波", "101210400"),
                item("无锡", "101190200"),
                item("西安", "101110100"),
                item("郑州", "101180100"),
                item("合肥", "101220100"),
                item("厦门", "101230200"),
                item("东莞", "101281600"),
                item("济南", "101120100"),
                item("福州", "101230100"),
                item("佛山", "101280800"),
                item("昆明", "101290100"),
                item("大连", "101070200"),
                item("沈阳", "101070100"),
                item("常州", "101191100"),
                item("哈尔滨", "101050100"),
                item("南昌", "101240100"),
                item("泉州", "101230500"),
                item("南通", "101190500"),
                item("烟台", "101120500"),
                item("温州", "101210700"),
                item("贵阳", "101260100"),
                item("南宁", "101300100"),
                item("石家庄", "101090100"),
                item("长春", "101060100"),
                item("嘉兴", "101210300"),
                item("珠海", "101280700"),
                item("太原", "101100100"),
                item("绍兴", "101210500"),
                item("金华", "101210900"),
                item("潍坊", "101120600"),
                item("徐州", "101190800"),
                item("惠州", "101280300"),
                item("台州", "101210600"),
                item("扬州", "101190600"),
                item("中山", "101281700"),
                item("乌鲁木齐", "101130100"),
                item("兰州", "101160100"),
                item("海口", "101310100"),
                item("呼和浩特", "101080100"),
                item("银川", "101170100"));

        add(options, "jobType", 1000,
                item("不限", "0"),
                item("全职", "1901"),
                item("兼职", "1902"),
                item("实习", "1903"));

        add(options, "industry", 2000,
                item("不限", "0"),
                item("互联网", "100001"),
                item("电子商务", "100002"),
                item("企业服务", "100003"),
                item("软件服务", "100004"),
                item("计算机软件", "100005"),
                item("人工智能", "100006"),
                item("数据服务", "100007"),
                item("游戏", "100008"),
                item("金融", "100009"),
                item("医疗健康", "100010"),
                item("教育培训", "100011"),
                item("广告营销", "100012"),
                item("文化传媒", "100013"),
                item("物流/仓储", "100014"),
                item("新能源", "100015"),
                item("智能硬件", "100016"),
                item("信息安全", "100017"),
                item("通信/网络设备", "100018"),
                item("电子/半导体/集成电路", "100019"),
                item("生活服务", "100020"),
                item("房地产/建筑", "100021"),
                item("汽车", "100022"),
                item("咨询", "100023"),
                item("人力资源服务", "100024"),
                item("旅游", "100025"),
                item("批发/零售", "100026"),
                item("消费品", "100027"),
                item("制造业", "100028"),
                item("政府/公共事业", "100029"),
                item("其他行业", "100030"));

        add(options, "salary", 3000,
                item("不限", "0"),
                item("3K以下", "402"),
                item("3-5K", "403"),
                item("5-10K", "404"),
                item("10-15K", "405"),
                item("15-20K", "406"),
                item("20-30K", "407"),
                item("30-50K", "408"),
                item("50K以上", "409"));

        add(options, "experience", 4000,
                item("不限", "0"),
                item("经验不限", "102"),
                item("在校/应届", "108"),
                item("1年以内", "103"),
                item("1-3年", "104"),
                item("3-5年", "105"),
                item("5-10年", "106"),
                item("10年以上", "107"));

        add(options, "degree", 5000,
                item("不限", "0"),
                item("初中及以下", "209"),
                item("中专/中技", "208"),
                item("高中", "206"),
                item("大专", "202"),
                item("本科", "203"),
                item("硕士", "204"),
                item("博士", "205"));

        add(options, "scale", 6000,
                item("不限", "0"),
                item("0-20人", "301"),
                item("20-99人", "302"),
                item("100-499人", "303"),
                item("500-999人", "304"),
                item("1000-9999人", "305"),
                item("10000人以上", "306"));

        add(options, "stage", 7000,
                item("不限", "0"),
                item("未融资", "801"),
                item("天使轮", "802"),
                item("A轮", "803"),
                item("B轮", "804"),
                item("C轮", "805"),
                item("D轮及以上", "806"),
                item("已上市", "807"),
                item("不需要融资", "808"));

        return List.copyOf(options);
    }

    private static void add(List<Option> options, String type, int baseSortOrder, SeedItem... items) {
        for (int i = 0; i < items.length; i++) {
            SeedItem item = items[i];
            options.add(new Option(type, item.name(), item.code(), baseSortOrder + i));
        }
    }

    private static SeedItem item(String name, String code) {
        return new SeedItem(name, code);
    }

    record Option(String type, String name, String code, int sortOrder) {
    }

    private record SeedItem(String name, String code) {
    }
}
