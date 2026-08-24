# 项目全面工程体检执行任务

## 背景

当前项目是本地单机 V1，包含 Spring Boot / Java 后端、Next.js / TypeScript 前端、Chrome Bridge 扩展、Playwright 自动化执行层和 SQLite 数据库。本轮联合使用 Codemap、Code Overhaul 和 SonarQube，解释项目为什么能运行、哪些路径可靠、哪些路径依赖隐式假设，并形成低风险整改路线图。

## 目标

1. 建立功能模块级架构地图和依赖关系。
2. 完成 FULL AUDIT：架构、代码质量、数据、稳定性、测试、安全、性能、依赖和可观测性。
3. 运行现有安全测试、构建、lint、typecheck、coverage 和 SonarQube 静态扫描。
4. 交叉验证人工审计、Codemap 和 SonarQube 结果。
5. 在仓库根目录生成 `PROJECT_AUDIT.md`，只给出问题、证据、优先级和分轮整改路线，不实施整改。

## 允许修改范围

- `PROJECT_AUDIT.md`
- `.codemap/**`
- `sonar-project.properties`
- `.gitignore`（仅补充审计/扫描临时产物忽略规则）
- 本任务文件

## 禁止修改范围

- `src/main/**`、`front/**`、`chrome-extension/**` 中的生产代码
- 数据库 Schema、Flyway 迁移和现有数据文件
- 生产启动方式、业务状态流和 Provider 路由
- `.env`、Cookie、Token、API Key、浏览器资料和真实用户数据
- 依赖版本和锁文件

## 已确定实现要求

- Codemap 使用中文，按功能能力拆分模块；每个模块由独立只读审计任务依据固定标准评分。
- Code Overhaul 使用 FULL AUDIT 模式，不提出大爆炸重构，不创建 Beads，不自动修复。
- SonarQube 使用本机 `127.0.0.1:9000` 的现有 Community Build；扫描凭据只在命令运行期间使用，不写入仓库。
- 测试使用 `build/audit/` 下的隔离 SQLite 和运行目录；禁止启动招聘网站、Playwright 登录流程、真实 Codex CLI 或远程 AI 调用。
- 不读取 `db/`、`data/`、`logs/`、`output/`、`chrome-profile/`、`.env` 和嵌套历史副本中的真实内容。
- Dead Code、Legacy Code 和删除候选只列出，不删除。

## 验收标准

- `.codemap/modules.json`、`.codemap/codemap.md`、`.codemap/codemap.html` 可生成且模块无空路径。
- 每个 Codemap 模块有独立、带 `file:line` 证据的评分结果。
- 后端测试、前端 lint/typecheck/build、Chrome 扩展测试均有准确结果；失败时保留原始错误证据。
- SonarQube 分析成功，并从 API 读取 Bugs、Vulnerabilities、Hotspots、Smells、Duplication、Coverage、Complexity、Ratings 和 Technical Debt。
- `PROJECT_AUDIT.md` 包含用户要求的 10 维评分、P0-P3、Top 10、删除候选、暂不修改清单、影响/成本矩阵和可独立回滚的整改路线图。
- 最终 `git diff` 只包含允许范围内的审计产物，无敏感信息、无临时扫描 Token、无生产代码变化。

## 计划验证命令

```powershell
$env:APP_AUTO_OPEN_BROWSER = 'false'
$env:APP_BROWSER_INITIALIZE_ON_STARTUP = 'false'
$env:APP_STATIC_SERVER_ENABLED = 'false'
$env:SPRING_DATASOURCE_URL = 'jdbc:sqlite:./build/audit/getjobs-audit.db'
$env:APP_DATA_DIR = './build/audit/data'
$env:APP_OUTPUT_DIR = './build/audit/output'
$env:APP_CACHE_DIR = './build/audit/cache'
$env:APP_LOG_DIR = './build/audit/logs'
$env:LOGGING_FILE_NAME = './build/audit/logs/get-jobs.log'
./gradlew.bat test
corepack pnpm@10.20.0 --dir front lint
corepack pnpm@10.20.0 --dir front exec tsc --noEmit
corepack pnpm@10.20.0 --dir front build
$extensionTests = Get-ChildItem chrome-extension/tests/*.test.cjs | ForEach-Object { $_.FullName }
node --test $extensionTests
```

SonarQube 扫描在完成编译和覆盖率报告后执行，Token 由本地 API 临时创建并在扫描后撤销。

## 返回格式

- 命令
- 退出码
- 通过 / 失败 / 跳过数量
- 构建时间或扫描时间
- 关键告警与原始错误片段
- 未执行项及原因
- 未产生真实外部调用的证据
