# 投递牛马 工作无忧

投递牛马是一个基于 Spring Boot、Next.js 和 Playwright 的本地求职辅助工具，用于在招聘平台上完成配置管理、登录状态维护、扫描岗位、AI 分析、待确认、用户确认后投递、进度推送和岗位数据分析。

当前项目阶段：**1.2 MVP 全流程打通**。这一阶段已经把本地 GUI、后端任务编排、AI 岗位分析、Chrome 已登录标签页桥接、待确认投递、结果回写和岗位分析串成可用闭环。


> 项目以本地运行为主，GitHub 仅作为代码备份和版本管理使用；不要提交数据库、Cookie、API Key、简历图片等敏感文件。

## 当前进度

- 阶段名称：`1.2 MVP 全流程打通`
- 版本号：后端 `1.2.0`，前端 `1.2.0`，Chrome 扩展 `1.2.0`。
- 已完成 MVP 主流程：配置检查、岗位扫描、AI 分析、待确认、用户确认后投递、状态回写、分析统计。
- 已完成本地 GUI：工作台、环境配置、AI 配置、平台配置、运行日志、投递分析页面。
- 已完成后端主链路：Spring Boot API、SSE 进度推送、SQLite 持久化、Cookie/配置管理。
- 已完成自动化主链路：Boss、猎聘、51job、智联的 Playwright worker 保留；Boss 和智联打通 Chrome Bridge 扫描/确认投递路线。
- 已完成 AI 分析：采集岗位后进入 AI 匹配，命中岗位写入“待确认”，再由用户确认后投递。
- 已完成文件整理：本地数据库、日志、构建产物、依赖缓存、`.pnpm-store`、`node_modules`、`.env` 等均不进入 Git。

## 功能概览

- 图形化管理界面：在网页端配置平台参数、AI 参数和运行任务。
- 多平台支持：Boss 直聘、猎聘、前程无忧 51job、智联招聘。
- 自动化执行：使用 Playwright 或 Chrome Bridge 辅助登录、搜索、扫描和筛选；Boss/智联推荐按“扫描岗位 → AI 分析 → 待确认 → 用户确认后投递”的流程执行。
- Chrome 扩展桥接：Boss 和智联支持复用用户已登录的 Chrome 标签页扫描岗位、提交 AI 分析，并在确认后执行投递。
- AI 辅助：支持配置模型接口，用于 Boss 直聘岗位匹配和打招呼语生成。
- 实时进度：后端通过 SSE 向前端推送投递进度。
- 数据持久化：使用 SQLite 保存配置、Cookie、投递数据和统计数据。
- 岗位分析：前端提供各平台投递结果列表与统计视图。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | Next.js 16、React 19、TypeScript、Tailwind CSS、shadcn/ui、Chart.js |
| 后端 | JDK 21、Spring Boot 3.5.7、Gradle、MyBatis-Plus |
| 自动化 | Microsoft Playwright for Java |
| 数据库 | SQLite |

## 目录结构

```text
.
├── README.md                 # 项目入口说明
├── build.gradle.kts          # 后端 Gradle 构建配置
├── chrome-extension/          # 投递牛马 Chrome Bridge 扩展
├── db/getjobs.db             # 本地 SQLite 数据库
├── doc/                      # 项目文档
├── front/                    # Next.js 前端
├── src/main/java/com/getjobs # Spring Boot 后端与 worker 自动化逻辑
└── src/main/resources        # 后端配置、静态资源、插件资源
```

## 快速启动

### 1. 准备环境

- JDK 21
- Node.js 20.19 或更高版本
- pnpm
- 可正常访问招聘网站的本机网络环境

### 2. 启动后端

```bash
./gradlew bootRun
```

后端默认端口为 `8888`，配置文件位于 `src/main/resources/application.yaml`。

### 3. 启动前端

```bash
cd front
pnpm install
pnpm dev
```

前端默认端口为 `6866`，配置文件位于 `front/server.config.js`。启动后访问：

```text
http://localhost:6866
```

### 4. 配置并运行

1. 打开网页端。
2. 在环境配置和 AI 配置页面填写企业微信机器人、模型接口等参数。
3. 到对应平台页面配置城市、岗位、薪资、投递页数等筛选条件。
4. 登录平台账号并保存 Cookie。
5. 点击开始运行，在页面中查看实时日志和统计结果。

## Chrome Bridge 扩展

Boss 和智联建议优先使用 Chrome Bridge 路线：

1. 打开 Chrome 扩展管理页 `chrome://extensions/`。
2. 开启开发者模式。
3. 点击“加载已解压的扩展程序”，选择项目内 `chrome-extension/`。
4. 确认前端页面能显示扩展连接状态。
5. 在 Chrome 中登录 Boss 或智联，再回到前端启动 Chrome 扫描。

扩展只面向本地开发地址和招聘平台域名工作；投递前，分析页会先生成待确认任务，用户确认后才会通过 Chrome 页面执行。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [文档索引](doc/文档索引.md) | 所有文档的入口和说明 |
| [1.2 版本说明](doc/1.0自动投简历脚本.md) | MVP 全流程、已完成功能、运行方式和后续计划 |
| [项目检查报告](doc/项目检查报告.md) | 项目结构检查、整理结果和注意事项 |
| [使用指南](doc/使用指南.md) | 环境准备、启动、配置、平台使用说明 |
| [开发指南](doc/开发指南.md) | 本地开发、构建、目录说明、常用命令 |
| [架构说明](doc/架构说明.md) | 前端、后端、worker、数据库和运行流程 |
| [API 接口](doc/API接口.md) | 主要后端接口按模块整理 |
| [更新日志](doc/更新日志.md) | 历史版本变化 |

## 常用命令

```bash
# 后端开发运行
./gradlew bootRun

# 后端测试
./gradlew test

# 前端开发运行
cd front && pnpm dev

# 前端构建
cd front && pnpm build

# 前端生产静态构建并复制 dist
cd front && pnpm build:prod
```

## 重要注意事项

- 本项目以本地运行为主：`.github` 工作流已移除，GitHub 仅作为代码备份和版本管理使用。
- 本项目更适合在个人电脑本地运行，不建议部署到服务器。招聘网站通常会识别服务器 IP，可能无法返回正常数据。
- 不建议开启境外代理访问国内招聘网站，否则页面加载可能变慢或失败。
- 数据库、Cookie、API Key、简历图片等都属于敏感数据，请勿提交到公开仓库。
- `.gitignore` 已忽略 `db/`、`*.db`、`.env`、`cookie.json`、`*.jpg`、`.pnpm-store/`、构建目录和 Playwright 缓存目录。
- 前端构建产物可放到 `src/main/resources/dist` 后由后端静态资源服务承载。
