# 架构说明

投递牛马当前是本地单机架构。前端负责配置和结果展示，后端负责 API、SQLite 持久化、AI 分析和任务编排，执行层通过 Playwright 或 Chrome Bridge 操作招聘网站。

当前版本不按 SaaS 多用户服务设计，默认所有数据都保存在使用者自己的电脑上。

## 总体架构

```text
用户浏览器
  │
  │ 访问 http://localhost:6866
  ▼
front/ Next.js 前端
  │
  ├─ HTTP / SSE 调用本地后端
  │
  └─ window.postMessage 调用 Chrome Bridge 扩展
       │
       ▼
chrome-extension/
  │ 复用已登录 Chrome 标签页
  ▼
招聘平台页面

front/
  │
  ▼
Spring Boot 后端 8888
  │
  ├─ SQLite + Flyway
  ├─ AI 服务调用
  ├─ Playwright worker
  └─ Chrome Bridge 回调接口
```

## 模块职责

| 模块 | 位置 | 职责 |
| --- | --- | --- |
| 前端 | `front` | 配置页面、运行入口、SSE 日志、分析列表、确认投递 |
| 后端应用层 | `src/main/java/com/getjobs/application` | Controller、Service、Mapper、配置、初始化、AI 分析 |
| 执行层 | `src/main/java/com/getjobs/worker` | Playwright 浏览器自动化和平台执行逻辑 |
| Chrome Bridge | `chrome-extension` | 连接本地前端、招聘平台页面和本地后端 |
| 数据库 | `db/getjobs.db` | 保存配置、Cookie、简历、岗位、AI 分析、投递状态 |
| 迁移脚本 | `src/main/resources/db/migration` | Flyway 管理新数据库表结构 |
| 启动脚本 | `start_windows.*`、`start_docker.*` | Windows 和 Docker 本地启动 |

## 前端

前端使用 Next.js App Router，默认运行在 `6866` 端口。

主要页面：

- `/`：工作台和状态概览。
- `/env-config`：环境配置。
- `/ai-config`：AI 配置、简历内容、优先公司。
- `/boss`、`/boss/analysis`：Boss 配置和分析。
- `/zhilian`、`/zhilian/analysis`：智联配置和分析。
- `/liepin`、`/liepin/analysis`：猎聘配置和分析。
- `/51job`、`/51job/analysis`：前程无忧配置和分析。

前端通过 `front/lib/api.ts` 读取 API 前缀。开发模式下，`front/next.config.ts` 会把 `/api` 和 `/actuator` 代理到后端 `8888`。

## 后端

后端使用 Spring Boot 3.5，默认运行在 `8888` 端口。

核心职责：

- 提供 REST API 和 SSE 进度流。
- 读写 SQLite 数据库。
- 保存平台配置、AI 配置、Cookie 和候选人档案。
- 接收 Chrome Bridge 采集到的岗位。
- 调用 AI 分析岗位匹配度。
- 生成 `待确认` 任务。
- 接收投递成功或失败结果并更新状态。

后端入口是：

```text
src/main/java/com/getjobs/GetJobsApplication.java
```

主要配置是：

```text
src/main/resources/application.yaml
```

## Chrome Bridge

Chrome Bridge 是本地 Chrome 扩展，位置在 `chrome-extension`。

它的边界很重要：

- 只声明本地前端、后端和 Boss/智联相关域名权限。
- 前端页面只能从 `localhost:6866` 或 `127.0.0.1:6866` 连接扩展。
- 扫描阶段采集岗位结构化数据并交给本地后端。
- 投递阶段必须先由用户在分析页确认。
- 扩展不应该把 Cookie、账号密码、浏览器缓存提交到 Git。

关键文件：

- `manifest.json`：扩展权限和脚本声明。
- `page-bridge.js`：前端页面和扩展之间的消息桥。
- `background.js`：标签页调度、扫描和投递任务编排。
- `boss-content.js`：Boss 页面采集和投递逻辑。
- `zhilian-content.js`：智联页面采集和投递逻辑。

## Playwright Worker

Worker 位于 `src/main/java/com/getjobs/worker`。它保留了 Boss、猎聘、51job、智联的 Playwright 自动化能力。

当前推荐：

- Boss 和智联优先走 Chrome Bridge 确认式流程。
- 猎聘和 51job 仍主要依赖既有 Playwright worker。
- 所有平台都可能受页面改版、登录态、风控、网络环境影响。

## AI 分析

AI 配置由前端页面保存到本地数据库。核心字段包括 `BASE_URL`、`API_KEY`、`MODEL`。

AI 分析流程：

1. 后端读取当前候选人简历和优先公司配置。
2. 根据岗位标题、公司、薪资、地点、经验、学历、描述生成 prompt。
3. 调用模型服务。
4. 尝试解析模型返回 JSON。
5. 根据分数和决策写入 `待确认`、`AI不匹配` 或 `AI分析失败`。

模型返回不是标准 JSON 时，后端会尽量修复或降级为失败结果，不会直接让任务崩掉。

## 数据存储

默认 SQLite 数据库：

```text
db/getjobs.db
```

重要表由 Flyway 和兼容初始化逻辑维护。迁移脚本在：

```text
src/main/resources/db/migration
```

本地数据包括：

- 候选人档案和当前档案。
- 简历文本。
- AI 配置和优先公司。
- 平台配置和平台选项。
- Cookie。
- 岗位数据。
- AI 分析结果。
- 投递状态、失败类型和失败原因。

`db`、日志、缓存、浏览器资料目录都不应该提交到 Git。

## 主要数据流

### Chrome Bridge 流程

```text
用户在 Chrome 登录招聘平台
  ↓
前端发起扫描
  ↓
Chrome Bridge 打开或复用标签页
  ↓
content script 采集岗位列表和详情
  ↓
后端入库并调用 AI 分析
  ↓
命中岗位进入待确认
  ↓
用户在分析页确认
  ↓
Chrome Bridge 执行投递
  ↓
后端写回已投递或投递失败
```

### Playwright 流程

```text
用户在前端点击开始
  ↓
后端读取平台配置和 Cookie
  ↓
worker 使用 Playwright 打开招聘网站
  ↓
执行搜索、筛选、投递或状态采集
  ↓
后端通过 SSE 推送进度
  ↓
投递结果写入 SQLite
```

## 当前设计边界

- 单机、本地、单用户优先。
- 默认不部署公网，不做多人权限隔离。
- Cookie 和 API Key 暂存在本地数据库或本地配置中。
- Chrome Bridge 不绕过用户确认。
- 平台适配层 `application/platform` 是后续统一接口的预留，不替换当前 Controller。
- OpenClaw 是实验通路，不是主流程依赖。

## SaaS 化演进方向

后续如果要 SaaS 化，建议按下面顺序演进：

1. 账号体系和租户隔离：所有配置、简历、岗位、投递任务都带租户和用户维度。
2. 敏感信息加密：API Key、Cookie、简历内容需要加密存储和审计访问。
3. 任务队列化：扫描、AI 分析、投递确认、结果回写拆成可重试任务。
4. 插件通道收敛：Chrome Bridge 变成明确的客户端代理，服务端只收任务状态。
5. 平台适配统一：把当前 Boss/智联/猎聘/51job 的差异逐步收敛到 `PlatformAdapter`。
6. 监控和告警：记录任务失败类型、平台改版信号、AI 调用耗时和成本。
7. 风控边界：保留人工确认，不做绕过平台限制的能力。
