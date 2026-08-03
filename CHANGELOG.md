# 更新日志

本文件记录 AI JobPilot（投递牛马）的重要版本变化。

版本格式遵循 `主版本.次版本.修订版本`。当前项目仍处于快速迭代阶段，招聘平台页面变化可能导致采集能力需要临时修复。

## [Unreleased]

### 计划中

- 统一智联、猎聘和 51job 的平台适配层
- 继续拆分其他平台分析页面的 hooks 与 components
- 增加脱敏 Demo 数据和首次体验流程
- 补充真实界面截图、操作 GIF 和发布包
- 继续将旧兼容 DDL 迁移到 Flyway

## [1.3.0] - 2026-08-03

### Added

- Boss 直聘与智联招聘 Chrome Bridge 本地采集流程
- Boss 受限搜索 API 采集 POC
- 页面内嵌数据、DOM 卡片与点击卡片的降级采集路线
- Boss 分析页 AI 投递分数线、筛选、批量确认和统计视图
- Flyway 数据库迁移目录与脚本
- 轻量 `PlatformAdapter` 接口及 Boss 包装实现
- GitHub Actions 基础 CI
- Chrome 扩展、控制器、服务和 SQL Provider 测试

### Changed

- 增强扫描任务的断点恢复和中断安全处理
- 增强异常页、登录失效和采集失败诊断
- Boss 岗位查重改为批量查询
- 重点公司列表增加缓存
- Boss 统计接口改为 SQL 聚合
- Boss 薪资字段改为结构化存储
- Boss 分析页拆分为 hooks 和 components

### Security

- 收紧本地 API CORS 访问范围
- 加固 Chrome Bridge 消息来源校验
- 增强 Boss 浏览器调试接口安全性
- 明确投递动作必须保留人工确认

### Performance

- 改造 Boss 异步任务线程池
- 补充岗位表关键索引
- 减少重复岗位查询和统计端内存聚合

### Documentation

- 重构中英文项目主页
- 增加贡献指南、社区模板和版本记录
- 补充本地数据、Cookie、API Key 和平台规则边界

## 更早版本

早期版本主要完成了本地求职配置、岗位存储、AI 分析、平台页面、Windows 启动脚本和基础投递任务流程。由于早期提交未统一维护正式 Release 记录，暂不在此文件中补写未经验证的具体发布日期和版本号。
