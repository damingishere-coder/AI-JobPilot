# 架构说明

投递牛马采用本地单机架构：前端负责配置和结果展示，后端负责 API、SQLite 持久化和任务编排，执行层负责 Playwright 自动化，Chrome Bridge 负责复用用户已登录的 Chrome 标签页完成扫描和用户确认后的投递。

更完整的历史说明见 `doc/架构说明.md`。根目录文档用于记录当前演进方向和跨模块约定。

## 平台适配层

本轮新增轻量平台适配层，位置：

```text
src/main/java/com/getjobs/application/platform/
```

核心接口：

```java
public interface PlatformAdapter {
    String platform();
    List<PlatformJobItem> scan(PlatformScanRequest request);
    PlatformDeliveryResult deliver(PlatformDeliveryRequest request);
}
```

当前策略：

- `PlatformType` 统一声明平台编码：`boss`、`zhilian`、`liepin`、`51job`。
- `dto/` 只放通用请求和结果对象，不绑定某个平台的页面细节。
- `boss/BossPlatformAdapter` 先作为 Boss 现有 `BossService` 的轻量包装，不替换现有 Controller、Chrome Bridge 或前端接口。
- `deliver` 暂不直接操作浏览器，只生成可交给现有 Chrome Bridge 的任务信息，继续保留用户确认边界。

后续新增平台时，推荐步骤：

1. 新增平台自己的 `PlatformAdapter` 实现。
2. 在实现类内部复用现有 Service、Mapper 和 worker，不先改前端流程。
3. 先对齐 `scan` 返回的 `PlatformJobItem` 字段，再逐步对齐 `deliver` 的任务生成。
4. 需要真实投递时，仍必须经过用户确认，不允许默认自动绕过确认。
5. 适配稳定后，再考虑把 Controller 或前端页面切到统一接口。

## 迁移边界

平台适配层本轮只提供入口，不做大规模迁移。Boss、智联、猎聘和 51job 的现有页面、接口、worker 继续保持原行为。
