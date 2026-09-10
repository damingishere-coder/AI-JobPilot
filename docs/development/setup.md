# 开发者本地启动指南

本文对应应用 **1.5.0** / Chrome Bridge **1.8.0**。普通用户使用 [Windows 统一服务](../../WINDOWS_SETUP.md)；这里区分统一运行与热更新开发，避免两个程序争抢 6866。

## 环境与代码

Windows 10 / 11、Git、Java 21、Node.js 24 LTS、pnpm 10.20.0、Chrome。当前 CI 使用 Node 24；jsdom 30 的依赖要求高于旧文档中的 Node 20.19，不再推荐旧组合。

```powershell
git clone https://github.com/damingishere-coder/AI-JobPilot.git
cd AI-JobPilot
git switch main
git pull --ff-only
git switch -c codex/your-change
cd front
pnpm install --frozen-lockfile
cd ..
```

操作前检查 `git status`，保留已有未提交修改。需要文件识别时另外准备 [本地简历解析器](../../resume-parser/README.md)。粘贴文本不需要解析器。

## 选择一种运行模式

| 模式 | 页面 | 后端 | 适合场景 |
| --- | --- | --- | --- |
| 统一服务 | `127.0.0.1:6866` | 同端口 `/api` | 日常使用、现有 RunDock / Alter 部署 |
| 热更新开发 | Next.js `127.0.0.1:6866` | Java `127.0.0.1:8888` | 修改界面和代码；需要明确设置后端端口 |

两种模式不能同时占用 6866。已有日常服务时，先在原管理器停止它，再进入开发模式；确认使用哪份数据库，避免测试写入个人数据。

### 统一服务

项目根目录执行：

```powershell
.\scripts\run_backend.ps1
```

该脚本执行 `pnpm build:prod`，把静态资源复制到`src/main/resources/dist`，设置统一端口 6866 后运行 `bootRun`。独立 `run_frontend.ps1` 不属于此模式。

### 热更新开发

第一个 PowerShell 窗口，在项目根目录执行：

```powershell
$env:SERVER_ADDRESS = '127.0.0.1'
$env:SERVER_PORT = '8888'
$env:APP_STATIC_SERVER_ENABLED = 'false'
$env:APP_AUTO_OPEN_BROWSER = 'false'
$env:APP_BROWSER_INITIALIZE_ON_STARTUP = 'false'
New-Item -ItemType Directory -Force target\dev-data | Out-Null
$env:SPRING_DATASOURCE_URL = 'jdbc:sqlite:./target/dev-data/getjobs.db'
.\gradlew.bat bootRun
```

使用独立开发数据库，首次为空，需创建演示档案。第二个窗口：

```powershell
cd front
$env:API_PROXY_TARGET = 'http://127.0.0.1:8888'
$env:API_BASE_URL = ''
pnpm dev
```

`start-dev.mjs` 开启同源 `/api` 代理。浏览器只访问 **http://127.0.0.1:6866**；后端健康和就绪接口为 `http://127.0.0.1:8888/api/health`、`http://127.0.0.1:8888/api/ready`，也可经前端同源代理访问。

直接执行 `gradlew bootRun` 的默认端口是 **6866**，不会自动让给前端；开发模式必须显式设置上面的 8888。在各自终端按 `Ctrl+C` 停止；环境变量仅影响当前窗口及其子进程。

## 配置和 Chrome Bridge

Windows 脚本和 `bootRun` 不会自动读取根目录 `.env`。通过页面设置模型配置，通过启动进程环境变量定制运行目录。Docker Compose 会读取 `.env`，其中 `backend:8888` 是容器内地址，不能直接套用到 Windows 原生环境。

在 `chrome://extensions/` 开启开发者模式，加载项目 `chrome-extension` 目录。扩展更新后需手动重新加载，并刷新工作台与平台页面。正式发行配套版本为 1.8.0，独立于应用 1.5.0 编号。

不要在测试、截图或 Issue 中暴露真实 Cookie、Token、简历、对话、模型密钥或数据库。使用虚构数据；[demo/](../../demo/README.md) 是样例契约，不是已上线的一键 Demo。

## 运行检查

从项目根目录运行后端与扩展检查：

```powershell
.\gradlew.bat test
node scripts/validate-chrome-extension.mjs
node --test chrome-extension/tests/*.test.cjs
```

前端在 `front` 目录运行：

```powershell
pnpm test
pnpm lint
pnpm build:prod
```

`pnpm build:prod` 会生成 `front/out` 并同步`src/main/resources/dist`。检查与本次改动相关的测试和构建即可；CI 还检查 Docker 配置、CodeQL，并构建 Release 预览。构建产物与缓存不提交。

## 数据库与升级

默认日常数据库为 `db/getjobs.db`；上面的开发模式改用 `target/dev-data/getjobs.db`。部署环境还可能显式覆盖路径，不要依赖目录名猜测实际数据库。

结构变更使用 Flyway；先验证空库，再在一致性备份副本上演练，确认原库未改动。已有数据库中的业务记录必须保留。1.5 的迁移与回滚说明见 [发布说明](../releases/v1.5.0.md)。

## 提交与 PR

按 [AGENTS.md](../../AGENTS.md) 使用独立 `codex/*` 分支、中文提交说明，只暂存相关文件。例如：

```text
修复：恢复验证后的岗位扫描
文档：更新首次启动与截图说明
```

PR 应说明问题、变更、验证结果以及数据库、平台和安全边界。以 `main` 为目标，最终提交的必要检查通过且阻塞审查处理后合并。涉及运行代码时再部署到已有明确目标并验收实际服务；纯文档修改无需重启应用。

更多要求见 [参与贡献](../../CONTRIBUTING.md) 和 [安全说明](../../SECURITY.md)。
