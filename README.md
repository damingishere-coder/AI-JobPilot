# 投递牛马

投递牛马是一个本地运行的求职辅助工具。它用网页界面管理求职配置，用 Spring Boot 后端保存数据和编排任务，用 Playwright 或 Chrome Bridge 辅助采集岗位、调用 AI 做匹配分析，并在用户确认后执行投递。

当前版本以 Windows 本机使用为主，阶段为 `1.3 多平台采集与分析增强版`。后端、前端和 Chrome 扩展版本均为 `1.3.0`。

## 当前能做什么

- 管理多个候选人档案、简历文本、AI 配置、平台配置和黑名单。
- 支持 Boss 直聘、智联招聘、猎聘、前程无忧 51job 四个平台的本地流程。
- Boss 和智联支持 Chrome Bridge：复用你已登录的 Chrome 页面，扫描岗位，提交本地后端做 AI 分析，并安全恢复中断的扫描任务。
- Boss 提供受限搜索 API 采集 POC；API 不可用时会降级到页面内嵌数据、DOM 卡片和点击卡片采集。
- Boss 分析页支持 AI 投递分数线、筛选、批量确认和更完整的统计视图。
- AI 命中的岗位会进入 `待确认`，用户在分析页确认后才会投递。
- 保存投递状态，展示统计卡片、图表、岗位列表和失败原因。
- 使用 SQLite 保存在本机，默认数据库在 `db/getjobs.db`。

## 当前不能做什么

- 不能保证招聘网站改版后仍然稳定，页面结构变化可能需要维护选择器。
- 不能绕过平台风控、登录验证、验证码或投递限制。
- 不能自动合并 PR、删除分支或 force push。
- 不是 SaaS 服务，不建议部署到公网服务器给多人共用。
- OpenClaw 通路仍是实验能力，不是 Windows 主流程必需项。

## 目录结构

```text
.
├── src/main/java/com/getjobs        # Spring Boot 后端、业务服务、worker
├── src/main/resources               # 后端配置、Flyway 迁移、可选静态资源
├── front                            # Next.js 前端
├── chrome-extension                 # 投递牛马 Chrome Bridge 扩展
├── bin                              # Windows 辅助脚本
├── doc                              # 历史文档、使用指南和说明
├── .github/workflows/ci.yml         # GitHub Actions 检查
├── start_windows.bat / .ps1         # Windows 本机启动入口
├── start_docker.bat / .ps1 / .sh    # Docker 启动入口
├── build.gradle.kts                 # 后端 Gradle 配置
├── README.md                        # 项目入口说明
├── ARCHITECTURE.md                  # 架构说明
├── TASK_FLOW.md                     # 任务流程说明
└── WINDOWS_SETUP.md                 # Windows 新手部署说明
```

## 环境准备

Windows 本机运行需要：

- Windows 10 或 Windows 11
- Java 21
- Node.js 20.19 或更高版本
- pnpm
- Chrome 浏览器
- Git

如果使用 Docker 方式，则需要 Docker Desktop，且不需要手动安装 Java、Node.js、pnpm。

## Windows 本机快速启动

在项目根目录双击：

```text
start_windows.bat
```

它会检查 Java、Node.js、pnpm、前端依赖，准备 `db`、`data`、`logs`、`output` 等运行目录，然后分别启动后端和前端。

启动成功后打开：

```text
http://localhost:6866
```

后端健康检查地址：

```text
http://localhost:8888/api/health
```

如果你手动运行，请在项目根目录执行：

```powershell
.\start_windows.ps1
```

更完整的新手步骤见 [WINDOWS_SETUP.md](WINDOWS_SETUP.md)。

## 手动开发启动

后端：

```powershell
.\gradlew.bat bootRun
```

前端：

```powershell
cd front
pnpm install
pnpm dev
```

前端默认端口为 `6866`，后端默认端口为 `8888`。前端开发代理配置在 `front/server.config.js`。

## Docker 启动

在项目根目录双击：

```text
start_docker.bat
```

或执行：

```powershell
.\start_docker.ps1
```

Docker 方式会读取 `.env`，如果没有 `.env`，会使用 `docker-compose.yml` 和 `.env.example` 中说明的默认值。

## 配置 `.env`

普通 Windows 本机使用通常不需要先写 `.env`。建议先用网页端填写环境配置和 AI 配置。

需要自定义目录或 Docker 参数时，可以复制：

```text
.env.example -> .env
```

然后只填写你需要的值。不要把真实 `.env`、API Key、Cookie、账号密码、简历或浏览器缓存提交到 Git。

## Chrome Bridge 扩展

Boss 和智联推荐使用 Chrome Bridge 路线：

1. 打开 Chrome 地址 `chrome://extensions/`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目里的 `chrome-extension` 文件夹。
5. 打开 `http://localhost:6866`，确认扩展连接正常。
6. 在 Chrome 中登录 Boss 或智联，再回到前端开始扫描。

投递前仍需要你在分析页确认，不会默认绕过人工确认。

Boss 搜索 API 手动 POC 的完整 Windows 验证步骤见 [doc/BOSS_API_POC.md](doc/BOSS_API_POC.md)。

## 常用命令

```powershell
# 后端测试
.\gradlew.bat test

# 后端构建
.\gradlew.bat build

# 前端检查
cd front
pnpm lint

# 前端静态构建并复制到后端资源目录
cd front
pnpm build:prod

# 停止本机端口上的前后端服务
.\bin\kill-services.bat
```

## 新手使用流程

1. 按 [WINDOWS_SETUP.md](WINDOWS_SETUP.md) 启动项目。
2. 打开首页，看左侧检查项是否正常。
3. 到“环境配置”页面保存基础配置。
4. 到“AI 配置”页面保存模型配置和简历内容。
5. 到 Boss 或智联页面配置求职目标。
6. 加载 Chrome 扩展，并在 Chrome 里登录招聘平台。
7. 点击 Chrome 扫描，让系统采集岗位并做 AI 分析。
8. 到对应平台分析页查看 `待确认` 岗位。
9. 人工确认后执行单个或批量投递。
10. 查看统计结果和失败原因。

## 常见问题

- 前端打不开：确认 `http://localhost:6866` 端口是否启动，可查看 `logs/windows-frontend.log`。
- 后端连接失败：确认 `http://localhost:8888/api/health` 是否返回 `UP`，可查看 `logs/windows-backend.log`。
- 端口被占用：执行 `.\bin\kill-services.bat` 后重新启动。
- Java 版本低：安装 Java 21，并重新打开 PowerShell。
- pnpm 不存在：执行 `corepack enable`，再执行 `corepack prepare pnpm@10.20.0 --activate`。
- Chrome 扩展无响应：确认扩展已加载、前端地址是 `localhost:6866` 或 `127.0.0.1:6866`，并刷新页面。
- AI 分析失败：确认 AI 配置里的 `BASE_URL`、`API_KEY`、`MODEL` 正确，且简历内容已保存。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [WINDOWS_SETUP.md](WINDOWS_SETUP.md) | Windows 新手安装、启动、验证和排错 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 当前架构、模块职责、数据流和 SaaS 演进 |
| [TASK_FLOW.md](TASK_FLOW.md) | 从上传简历到确认投递的完整流程 |
| [SECURITY.md](SECURITY.md) | 本地数据、Cookie、API Key 的安全边界 |
| [ROADMAP.md](ROADMAP.md) | 阶段计划和后续方向 |
| [doc/BOSS_API_POC.md](doc/BOSS_API_POC.md) | Boss 搜索 API 手动 POC 与 Windows 验证 |
| [doc/文档索引.md](doc/文档索引.md) | 历史文档和补充资料索引 |
