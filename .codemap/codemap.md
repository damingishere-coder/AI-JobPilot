<!--
  This file:        .codemap/codemap.md   (written report)
  Interactive map:  .codemap/codemap.html
-->

# 投递牛马 AI-JobPilot V1 — Functional Module Quality Audit

> **Interactive view:** [`.codemap/codemap.html`](codemap.html) — per-module scores, findings, LoC, and the dependency graph. This file is the written report.

**Generated:** 2026-08-24 · **Modules:** 15 · **Size:** 52425 tracked LoC across 233 files

## Health by layer

| Layer | Modules | Avg score |
|---|--:|--:|
| 前端 · 操作与分析 | 3 | 60 |
| Chrome Bridge · 采集与投递 | 3 | 53 |
| 后端 · API 与平台编排 | 4 | 48 |
| 核心 · AI、配置与状态 | 1 | 52 |
| 持久化 · SQLite 与 Schema | 1 | 45 |
| 执行层 · Playwright | 2 | 49 |
| 工程化 · 构建、启动与文档 | 1 | 61 |

## Per-module lines of code & score

_LoC is the representative file/folder per module; folder-level modules overlap and are not additive._

### 前端 · 操作与分析

| Module | LoC | Score | Tags |
|---|--:|:--|:--|
| 分析与确认投递界面 | 5,111 | 55 D | god-component, duplication, dual-format, any-escape, stub, legacy, fallback |
| 平台扫描控制页 | 4,179 | 58 D | god-component, bloat, duplication, dual-format, legacy, fallback, silent-except |
| 前端壳与配置中心 | 3,246 | 68 C | fallback, any-escape, bloat, duplication, glue |

### Chrome Bridge · 采集与投递

| Module | LoC | Score | Tags |
|---|--:|:--|:--|
| Boss 扩展适配器 | 6,012 | 52 D | god-component, bloat, duplication, fallback, silent-except, dual-format, over-fit |
| 智联扩展适配器 | 3,230 | 50 D | god-component, bloat, fallback, silent-except, legacy, dual-format, duplication, over-fit |
| Chrome Bridge 网关 | 1,839 | 58 D | god-component, bloat, duplication, legacy, dual-format, fallback, silent-except |

### 后端 · API 与平台编排

| Module | LoC | Score | Tags |
|---|--:|:--|:--|
| Boss 后端业务 | 4,221 | 55 D | monkeypatch, fallback, silent-except, legacy, dual-format, stub, duplication, bloat, glue, god-component |
| 猎聘与 51job 后端 | 2,680 | 42 D | legacy, fallback, silent-except, glue, god-component, bloat, duplication |
| 智联后端业务 | 2,134 | 50 D | fallback, silent-except, duplication, bloat, glue, god-component, fake-output, monkeypatch |
| API 运行时与共享契约 | 1,673 | 43 D | any-escape, fallback, silent-except, stub, legacy, bloat, duplication, glue, fake-output |

### 核心 · AI、配置与状态

| Module | LoC | Score | Tags |
|---|--:|:--|:--|
| AI 分析与 Provider | 3,028 | 52 D | fallback, silent-except, fake-output, duplication, bloat, glue, god-component |

### 持久化 · SQLite 与 Schema

| Module | LoC | Score | Tags |
|---|--:|:--|:--|
| 数据与配置基础 | 861 | 45 D | fallback, silent-except, legacy, duplication, bloat |

### 执行层 · Playwright

| Module | LoC | Score | Tags |
|---|--:|:--|:--|
| 旧平台 Playwright Worker | 4,456 | 43 D | fake-output, silent-except, fallback, duplication, bloat, legacy, god-component, placeholder, dual-format |
| Playwright 运行时 | 3,416 | 55 D | god-component, bloat, duplication, legacy, silent-except, fallback |

### 工程化 · 构建、启动与文档

| Module | LoC | Score | Tags |
|---|--:|:--|:--|
| 构建、交付与文档 | 6,339 | 61 C | fallback, legacy, duplication, stub, placeholder, over-fit, glue |

## Worst offenders

- **猎聘与 51job 后端 (42/D)** — src/main/java/com/getjobs/application/controller/JobController.java:343-364: 公开 GET 接口直接返回 cookie_value 明文；Controller 直接拼装敏感 Cookie 数据。个人本地 V1 是本机 API 泄露风险，对外 SaaS 则可造成会话接管。
- **API 运行时与共享契约 (43/D)** — src/main/java/com/getjobs/application/controller/ConfigController.java:28-45: GET /api/config 未见认证或授权检查，直接返回所有配置；同控制器还允许任意 key 批量或单项写入，若配置包含 API_KEY 等 secret 则可被读取或覆盖。
- **旧平台 Playwright Worker (43/D)** — src/main/java/com/getjobs/worker/service/JobRunCoordinator.java:17-43: JobRunCoordinator 只按平台字符串加锁，允许不同平台同时运行；猎聘和 51job 服务未注入 coordinator，仅靠非原子的 isRunning 检查，可能并发操作共享浏览器资源并重复投递。
- **数据与配置基础 (45/D)** — src/main/java/com/getjobs/application/service/DatabaseSchemaService.java:21-39: 启动时执行大量 CREATE、ALTER、回填及 priority_company DROP+重建，但未显式事务或回滚；initializeSchema 捕获所有异常后仅 warn 并让应用继续。中途失败可能留下缺表或半迁移。
- **智联扩展适配器 (50/D)** — chrome-extension/zhilian-content.js:2661-2697: normalizeZhilianJobUrl 允许任意 host，isZhilianJobDetailUrl 仅用 host.endsWith(zhaopin.com) 且不限制 https；evilzhaopin.com 等 lookalike 域名会通过岗位详情校验并交给后台导航。
- **智联后端业务 (50/D)** — src/main/java/com/getjobs/application/service/ZhilianService.java:278: upsertChromeJob 在 job_id 或标题公司查询时都按 scanRunId 过滤；不同 scanRunId 的同一岗位不会命中旧记录而会再次插入。实体仅有自增主键，未见 job_id/profile_id 唯一约束或原子 upsert，并发批次也可重复插入。
- **Boss 扩展适配器 (52/D)** — chrome-extension/boss-scan-support.js:94-106: Boss URL 校验使用 hostname.endsWith(zhipin.com)，同类逻辑也出现在 boss-content、boss-search-collector；evilzhipin.com 等非官方域名会被当作 Boss 页面或岗位，可能进入导航、采集或投递链路。
- **AI 分析与 Provider (52/D)** — src/main/java/com/getjobs/application/service/AiService.java:66: HTTP 客户端只设置 connectTimeout，HttpRequest 未设置 request/read timeout，client.send 可能在提供商无响应时长期阻塞；图片和 Responses fallback 同样只有连接超时。
- **分析与确认投递界面 (55/D)** — front/app/zhilian/analysis/AnalysisContent.tsx:502: 智联分析页约 1273 行，在一个组件内同时承担图表、总览、筛选分页、列表、统计、清空数据、CSV 导出、薪资回算、单条确认和批量 Chrome 投递，是真正的 God Component。
- **Boss 后端业务 (55/D)** — src/main/java/com/getjobs/application/service/BossService.java:535: ensureBossDataColumnOrder 由 BossAnalyticsController reload 请求触发，在线创建 boss_data_new、复制数据、DROP 原表并 RENAME；复制 SQL 对多列直接假设存在，失败只记录 warn，ROLLBACK/close 异常又被吞掉，存在数据损坏或停写风险。

## All findings

### HIGH (24)

- **平台扫描控制页** · `front/app/boss/page.tsx:167` — BossPage 是真正的 God Component：同一组件集中维护约 30 个状态，并同时负责配置/选项、Profile、黑名单、SSE 登录状态、Chrome Bridge 扫描与停止、进度日志、诊断/API POC、Cookie/退出登录、分析刷新和完整页面渲染，主要逻辑覆盖 167-1180、1186-1790、1929-2109；任一平台控制流程改动都可能影响整页状态机。
- **分析与确认投递界面** · `front/app/zhilian/analysis/AnalysisContent.tsx:502` — 智联分析页约 1273 行，在一个组件内同时承担图表、总览、筛选分页、列表、统计、清空数据、CSV 导出、薪资回算、单条确认和批量 Chrome 投递，是真正的 God Component。
- **Chrome Bridge 网关** · `chrome-extension/background.js:1574-1590` — Boss 域名校验使用 hostname.endsWith(zhipin.com)，未要求根域或点边界；同时投递路径直接使用 task.url 并导航，例如 evilzhipin.com/job_detail/x 可能被当作官方岗位地址，存在钓鱼导航与错误投递风险。
- **Boss 扩展适配器** · `chrome-extension/boss-scan-support.js:94-106` — Boss URL 校验使用 hostname.endsWith(zhipin.com)，同类逻辑也出现在 boss-content、boss-search-collector；evilzhipin.com 等非官方域名会被当作 Boss 页面或岗位，可能进入导航、采集或投递链路。
- **智联扩展适配器** · `chrome-extension/zhilian-content.js:2661-2697` — normalizeZhilianJobUrl 允许任意 host，isZhilianJobDetailUrl 仅用 host.endsWith(zhaopin.com) 且不限制 https；evilzhaopin.com 等 lookalike 域名会通过岗位详情校验并交给后台导航。
- **API 运行时与共享契约** · `src/main/java/com/getjobs/application/controller/ConfigController.java:28-45` — GET /api/config 未见认证或授权检查，直接返回所有配置；同控制器还允许任意 key 批量或单项写入，若配置包含 API_KEY 等 secret 则可被读取或覆盖。
- **API 运行时与共享契约** · `src/main/java/com/getjobs/application/controller/CookieController.java:30-56` — GET /api/cookie 未见认证或授权检查，直接把 CookieEntity.cookieValue 原样放入 JSON；调用方可取得可复用的平台会话凭据。
- **Boss 后端业务** · `src/main/java/com/getjobs/application/service/BossService.java:535` — ensureBossDataColumnOrder 由 BossAnalyticsController reload 请求触发，在线创建 boss_data_new、复制数据、DROP 原表并 RENAME；复制 SQL 对多列直接假设存在，失败只记录 warn，ROLLBACK/close 异常又被吞掉，存在数据损坏或停写风险。
- **Boss 后端业务** · `src/main/java/com/getjobs/application/controller/BossAnalyticsController.java:239` — delivery-result 只检查岗位存在即把状态写为已投递或投递失败；BossService 1020-1043 没有校验当前状态、合法状态转换或幂等条件，重复或延迟回调可覆盖 SKIPPED、AI_NOT_MATCH 等状态。
- **Boss 后端业务** · `src/main/java/com/getjobs/application/service/BossService.java:48` — 1818 行 BossService 同时承担配置、选项、黑名单、Schema 在线迁移、Chrome upsert、投递状态、统计、分页和数据库维护，是真正的高耦合 God Service，修改 blast radius 很大。
- **智联后端业务** · `src/main/java/com/getjobs/application/service/ZhilianService.java:278` — upsertChromeJob 在 job_id 或标题公司查询时都按 scanRunId 过滤；不同 scanRunId 的同一岗位不会命中旧记录而会再次插入。实体仅有自增主键，未见 job_id/profile_id 唯一约束或原子 upsert，并发批次也可重复插入。
- **智联后端业务** · `src/main/java/com/getjobs/application/controller/ZhilianController.java:550` — delivery-result 仅检查岗位存在即写入已投递或投递失败；没有当前状态、合法状态转换或幂等条件，重复或延迟回调可覆盖跳过、AI不匹配等状态。
- **智联后端业务** · `src/main/java/com/getjobs/application/controller/ZhilianController.java:250` — 调试接口直接将 CookieEntity.cookieValue 放入响应 cookie_value；本控制器未见脱敏或权限校验，若路由可访问会泄漏智联登录凭证。
- **猎聘与 51job 后端** · `src/main/java/com/getjobs/application/controller/JobController.java:343-364` — 公开 GET 接口直接返回 cookie_value 明文；Controller 直接拼装敏感 Cookie 数据。个人本地 V1 是本机 API 泄露风险，对外 SaaS 则可造成会话接管。
- **AI 分析与 Provider** · `src/main/java/com/getjobs/application/service/AiService.java:66` — HTTP 客户端只设置 connectTimeout，HttpRequest 未设置 request/read timeout，client.send 可能在提供商无响应时长期阻塞；图片和 Responses fallback 同样只有连接超时。
- **AI 分析与 Provider** · `src/main/java/com/getjobs/application/service/ChromeJobAnalysisQueueService.java:25` — AI 队列、activeKeys、completedKeys 全为进程内状态；关闭时没有持久化队列或重启恢复，进程重启会遗失排队任务并留下 AI_ANALYZING。任务失败也在 finally 写入 completedKeys，30 分钟内无法自然重试。
- **AI 分析与 Provider** · `src/main/java/com/getjobs/application/service/JobAiAnalysisService.java:207` — analyzeJob 先标记 AI_ANALYZING，再分别 persistAnalysis 和 updatePlatformCache；持久化异常只告警，两个写操作无原子边界，可能出现分析记录缺失但岗位状态已完成。
- **数据与配置基础** · `src/main/java/com/getjobs/application/service/DatabaseSchemaService.java:21-39` — 启动时执行大量 CREATE、ALTER、回填及 priority_company DROP+重建，但未显式事务或回滚；initializeSchema 捕获所有异常后仅 warn 并让应用继续。中途失败可能留下缺表或半迁移。
- **Playwright 运行时** · `src/main/java/com/getjobs/worker/manager/PlaywrightManager.java:237-250` — 四个平台 setup 通过 CompletableFuture 并发执行，却共享同一个 BrowserContext；各 setup 同时 addCookies、navigate 和设置登录监控，未见统一 context/page 操作锁，存在竞态与跨平台状态污染风险。
- **Playwright 运行时** · `src/main/java/com/getjobs/worker/manager/PlaywrightManager.java:478-529` — 页面恢复主要在 page 为空或关闭时新建页面；若浏览器崩溃、context 失效或页面被替换，没有完整重放 Cookie、导航、登录检查和初始化流程。
- **旧平台 Playwright Worker** · `src/main/java/com/getjobs/worker/service/JobRunCoordinator.java:17-43` — JobRunCoordinator 只按平台字符串加锁，允许不同平台同时运行；猎聘和 51job 服务未注入 coordinator，仅靠非原子的 isRunning 检查，可能并发操作共享浏览器资源并重复投递。
- **旧平台 Playwright Worker** · `src/main/java/com/getjobs/worker/boss/Boss.java:825-875` — Boss 点击发送按钮后只要 locator 存在就立即将 sendSuccess 设为 true，没有等待发送结果或服务端确认；缺失标识仍加入 resultList，存在假成功。
- **旧平台 Playwright Worker** · `src/main/java/com/getjobs/worker/job51/Job51.java:244-299` — 51job 在实际批量投递前就把勾选岗位加入 resultList；随后无论成功或失败数量、按钮结果如何，都把当前页全部 jobId 标记 delivered，可能造成批量状态误写。
- **旧平台 Playwright Worker** · `src/main/java/com/getjobs/worker/liepin/Liepin.java:550-577` — 猎聘点击聊一聊后只等待聊天头部并尝试关闭窗口；等待或关闭异常时仍记录结果并 markDelivered，未建立真实发送确认。

### MED (80)

- **前端壳与配置中心** · `front/app/page.tsx:64` — loadPlatformStats 将 API 超时、HTTP 错误和解析失败全部静默转换为 pendingConfirm/delivered/failed 全为 0；首页无法区分真实为零和后端不可用，会产生误导性统计。
- **前端壳与配置中心** · `front/lib/setupChecklist.ts:146` — Boss 登录检查异常时直接返回 done=true，并显示将在 Chrome 扫描启动时确认；这是一种隐式成功 fallback，可能让准备检查显示完成但实际未确认登录态。
- **前端壳与配置中心** · `front/app/env-config/page.tsx:35` — 环境配置页从后端读取原始 API_KEY 到 client state，并在客户端 DOM 中保存且允许切换明文显示；应明确 local-only 信任边界或改为掩码及仅更新方式。
- **前端壳与配置中心** · `front/components/ui/select.tsx:31` — 共享 Select 通过运行时检查 React children 并使用多处 as any，既绕过类型安全又伪造 onChange 事件；React children 形态变化可能导致选项解析或回调行为异常。
- **前端壳与配置中心** · `front/app/page.tsx:52` — 超时 fetchJson 在首页自行实现，类似逻辑又出现在 setupChecklist 和 Sidebar；API 错误策略分散在壳层组件中，修复超时或状态映射时容易漂移。
- **平台扫描控制页** · `front/app/boss/page.tsx:324` — 四个平台页重复实现登录 SSE、配置加载、启动/停止、退出登录和错误处理：Boss 324-492、494-512，智联 214-292，猎聘 54-106，51job 43-115；虽共享 createSSEWithBackoff，但事件解析和状态转换仍各自维护，行为修复容易出现平台间漂移。
- **平台扫描控制页** · `front/app/boss/page.tsx:512` — UI 直接承担历史数据兼容和持久化格式解析：Boss 546-568 同时兼容 JSON 数组、非严格括号列表和普通文本，712-726 再序列化；智联 150-175、398-401兼容旧 code/name，猎聘 109-133 和 51job 118-160、272-295各自复制 JSON/逗号/中文名转换。该 dual-format/legacy 逻辑使页面绑定后端旧 Schema。
- **平台扫描控制页** · `front/app/51job/page.tsx:242` — 停止投递请求异常时使用空 catch，既不提示用户也不重置 isDelivering，网络失败后页面可能永久显示[正在投递]：237-243。
- **平台扫描控制页** · `front/app/zhilian/page.tsx:698` — 配置 PUT 成功后 Cookie 保存失败被空 catch 忽略，随后仍执行 fetchAllData 并显示[保存成功，配置已更新]：692-700，用户无法知道 Cookie 实际未保存。
- **分析与确认投递界面** · `front/app/liepin/analysis/AnalysisContent.tsx:81` — ChartCanvas 及分析页主流程在猎聘、51job、智联中重复实现，四个平台分别复制图表销毁、异步创建、颜色和列表、统计、导出逻辑，修复容易漂移。
- **分析与确认投递界面** · `front/app/liepin/analysis/AnalysisContent.tsx:97` — 猎聘和 51job 通过 window.Chart 和 jsDelivr CDN 动态加载 Chart.js 并大量使用 any；智联使用打包 Chart.js，形成两套图表供应链，离线或 CDN 失败时旧平台图表可能为空。
- **分析与确认投递界面** · `front/app/zhilian/analysis/AnalysisContent.tsx:529` — activeScanRunId 被硬编码为空字符串，列表和统计虽尝试附加 scanRunId，但条件永远不成立；智联分析无法按扫描运行隔离，可能混合不同扫描批次。
- **分析与确认投递界面** · `front/app/zhilian/analysis/AnalysisContent.tsx:814` — 批量投递只读取 Bridge 结果 message 并提示任务已结束，不检查 success、不展示每个任务成功、失败或部分成功，也不区分扩展超时后的未知状态。
- **分析与确认投递界面** · `front/app/51job/analysis/AnalysisContent.tsx:120` — 51job、猎聘、智联分析请求直接 res.json 且只在 catch 中 console.error，不检查 HTTP 状态或设置可见错误状态；失败时可能保留旧列表和旧统计。
- **Chrome Bridge 网关** · `chrome-extension/background.js:975-1003` — 投递结果回传使用硬编码 http://localhost:6866，未设置超时、未检查 response.ok；调用方在 720-747、828-854 等处统一 catch 后忽略回传失败，投递已执行但后端状态可能无法落库。
- **Chrome Bridge 网关** · `chrome-extension/background.js:435-480` — requestLocalApi 对 POST 的 5xx/超时自动重试最多 3 次，但没有幂等键；chrome-jobs 失败响应后可能重复提交岗位并重复触发后端入队，属于有界但真实的重复执行风险。
- **Chrome Bridge 网关** · `chrome-extension/background.js:958-970` — Boss 空响应时只要当前 URL 命中 chat/im/message 就推断投递成功并回传成功状态，没有读取页面明确成功标志，可能产生错误的已投递记录。
- **Chrome Bridge 网关** · `chrome-extension/background.js:1-1694` — 单个 background.js 同时承担消息路由、本地 API、页面导航、扫描会话持久化、Boss/智联投递、错误分类和重试，形成明显 God Component/bloat；Boss 与智联投递流程及失败分类大量平行重复。
- **Chrome Bridge 网关** · `chrome-extension/background.js:49-65` — manifest 同时加载多条采集路径，background 仍保留 BOSS_DEBUG_COLLECT/BOSS_API_POC_COLLECT 分支，POC/legacy 接线与主流程并存，职责边界不清。
- **Boss 扩展适配器** · `chrome-extension/boss-content.js:1-4758` — 单个 4758 行 content script 同时承担消息协议、搜索、API、嵌入数据、DOM、点击采集、多级详情解析、任务状态与恢复、批量提交、自动投递、存储和诊断，属于明显 god component。
- **Boss 扩展适配器** · `chrome-extension/boss-api-collector.js:69-98` — API_EMPTY、API_SCHEMA_CHANGED 或请求失败时依次降级到嵌入数据、DOM 卡片和点击卡片；只要返回非空 jobs 就 success=true，部分字段错误可能进入后端。
- **Boss 扩展适配器** · `chrome-extension/boss-content.js:4302-4320` — 详情 JSON 请求、JSON.parse 和嵌入脚本解析异常被空 catch 后直接转入 DOM 或正文 fallback；坏 JSON、接口 500 与页面结构变化没有独立错误状态。
- **Boss 扩展适配器** · `chrome-extension/boss-content.js:2623-2649` — 自动投递调用 deliverOnCurrentPage 的返回值被忽略，失败后仍进入下一岗位；deliverBatch 即使 failed 大于零仍返回 success:true，仅附带 failedCount。
- **Boss 扩展适配器** · `chrome-extension/boss-content.js:3084-3091` — storeScanTask 写 sessionStorage 后 fire-and-forget 调用 chrome.storage.local.set，未等待写入完成；页面销毁期间可能丢失最近 checkpoint。
- **Boss 扩展适配器** · `chrome-extension/tests/boss-api-collector.test.cjs:7-18` — Boss 测试主要使用 VM 和 fake DOM；没有 boss-content、真实 Chrome 消息、导航重试、存储恢复、详情解析或投递集成覆盖，高风险路径主要依赖人工验证。
- **智联扩展适配器** · `chrome-extension/zhilian-content.js:1514-1555` — 点击投递后只在 finalFailure 且未检测到已投递状态时判失败；没有失败提示、也没有成功状态时仍报告成功。deliverBatch 即使 failed 大于零仍返回 success:true。
- **智联扩展适配器** · `chrome-extension/zhilian-content.js:1214-1227` — chrome-jobs 提交响应丢失或超时会保存断点，恢复后再次提交同一 jobs 批次；虽携带 runId，但没有提交幂等键或已提交批次标记。
- **智联扩展适配器** · `chrome-extension/zhilian-content.js:1345-1373` — 详情解析失败时降级为列表 description，嵌入状态 JSON.parse 异常静默忽略并继续 DOM fallback；结果未标记 detailSource、解析失败或字段可信度。
- **智联扩展适配器** · `chrome-extension/zhilian-content.js:1-3026` — 3026 行单体 content script 同时承担扫描状态机、分页导航、采集、详情解析、checkpoint、恢复、投递确认、本地 API、诊断和协议兼容，属于 god-component。
- **智联扩展适配器** · `chrome-extension/tests/zhilian-scan-support.test.cjs:92-127` — 智联测试主要在 VM 中加载 support 模块，content 流程仅用源码正则断言；没有真实 DOM、Chrome 消息、导航重试、存储恢复、投递确认或重复执行集成覆盖。
- **API 运行时与共享契约** · `src/main/java/com/getjobs/application/config/CorsConfig.java:33-50` — 对 chrome-extension://* 开放凭据、任意 header 和 method，覆盖采集、投递路径；测试确认任意扩展 ID 可通过，恶意本机扩展可代调用接口。
- **API 运行时与共享契约** · `src/main/java/com/getjobs/application/controller/HealthController.java:29-50` — 健康状态只读取 PlaywrightManager；浏览器未启动且无错误时仍返回 UP，不检查数据库、任务队列、AI 或配置依赖。
- **API 运行时与共享契约** · `src/main/java/com/getjobs/application/controller/PlaywrightController.java:46-63` — test-navigate 直接对共享 Boss Page 执行外网 navigate，未先检查初始化或页面为空，访问者可触发运行时副作用。
- **API 运行时与共享契约** · `src/main/java/com/getjobs/application/controller/GlobalExceptionHandler.java:17-42` — 全局只处理三类异常；多个控制器又各自 catch Exception 并把 e.getMessage() 返回，错误格式、状态码和信息暴露不一致。
- **API 运行时与共享契约** · `src/main/java/com/getjobs/application/config/StaticResourceConfiguration.java:55-98` — 同一路径叠加文件系统、classpath、html、txt 与 index 多级 fallback，IOException 静默吞掉；附加静态端口也可能让路由随部署 cwd 漂移。
- **API 运行时与共享契约** · `src/main/java/com/getjobs/application/platform/boss/BossPlatformAdapter.java:50-66` — 适配器 deliver 只组装 task，随后以 success=true 返回仍需 Chrome Bridge 确认；误接线会产生假成功。
- **Boss 后端业务** · `src/main/java/com/getjobs/application/service/BossService.java:1161` — BossService 保留旧 JDBC/内存统计实现，同时 BossStatsService 提供新的 MyBatis SQL 实现；BossAnalyticsController 当前走新路径，双实现存在指标漂移和维护重复。
- **Boss 后端业务** · `src/main/java/com/getjobs/application/service/BossService.java:1719` — listBossJobs 先 selectList 全量加载，再在内存做薪资过滤和分页；size 没有上限，confirmBatch 直接请求 5000，数据增长后会放大内存和延迟风险。
- **Boss 后端业务** · `src/main/java/com/getjobs/application/service/BossService.java:406` — toCodes 对未知选项最终静默映射为 code=0；loadBossConfig 广泛使用该逻辑，拼写错误或过期配置会被当成不限，扩大扫描范围。
- **Boss 后端业务** · `src/main/java/com/getjobs/application/service/BossService.java:478` — 黑名单采用 selectCount 后 insert 的非原子检查，实体未表达唯一约束；删除路径按 type/value 删除，重复记录时可能批量删除。
- **Boss 后端业务** · `src/main/java/com/getjobs/application/service/BossStatsService.java:91` — 统计异常被 catch 后返回初始化的空响应；数据库故障会表现为成功但零数据，掩盖真实错误。
- **智联后端业务** · `src/main/java/com/getjobs/application/controller/ZhilianController.java:426` — 采集字段校验不要求 jobId，但 AI 状态更新依赖 jobId；服务方法对空 jobId 静默返回，随后仍继续入队，岗位可能保持未投递状态并被重复分析。
- **智联后端业务** · `src/main/java/com/getjobs/application/controller/ZhilianController.java:50` — 933 行控制器通过 9 个注入依赖同时承担配置、选项、登录、Cookie、统计、Chrome 入库、AI 队列、投递回调、SSE、Worker 启停和健康检查，职责明显膨胀。
- **智联后端业务** · `src/main/java/com/getjobs/application/init/ZhilianOptionInitializer.java:105` — replaceCityAndSalaryOptions 先删除全部 city/salary，再逐条插入，未见事务；任一插入失败会留下部分选项。
- **智联后端业务** · `src/test/java/com/getjobs/application/service/ZhilianServiceSearchParamTest.java:13` — 现有直接测试只覆盖城市、薪资参数归一化和官方选项解析；未覆盖跨扫描 upsert、并发重复、状态转换、重复回调、队列失败恢复或控制器 API。
- **智联后端业务** · `src/main/java/com/getjobs/application/service/ZhilianService.java:756` — 列表和统计均先 selectList 全量加载，再在内存做薪资过滤和分页；size 没有上限，数据增长后会产生内存和响应延迟风险。
- **猎聘与 51job 后端** · `src/main/java/com/getjobs/application/entity/LiepinConfigEntity.java:10-30` — 猎聘与 51job 配置和岗位实体均没有 profile_id；服务按全局最小 id 取第一条配置，数据查询也不按当前 profile 隔离。多档案会共享或覆盖配置、岗位和投递状态。
- **猎聘与 51job 后端** · `src/main/java/com/getjobs/application/service/LiepinService.java:85-127` — 保存与配置更新都是先查后写，没有唯一约束或方法级事务；并发扫描可能重复插入或覆盖状态。批量写失败只记录 warn，部分成功和重试恢复难判断。
- **猎聘与 51job 后端** · `src/main/java/com/getjobs/application/service/LiepinService.java:42-79` — 服务在 PostConstruct 或运行路径重复执行 CREATE、ALTER、DROP 兼容 DDL，异常被忽略或仅 warn 后继续；Flyway 与运行时逻辑双轨。
- **猎聘与 51job 后端** · `src/main/java/com/getjobs/application/service/LiepinService.java:462-513` — 统计和列表先读取整表，再在 Java 内存完成薪资、关键词和分页过滤；数据量增长时资源线性放大且会混入跨档案数据。
- **猎聘与 51job 后端** · `src/main/java/com/getjobs/application/controller/JobController.java:390-425` — Controller 直接协调 PlaywrightManager、任务 Service、SSE；异步任务在后台真正执行前即返回 success=true，后台失败只靠日志或 SSE，没有持久化任务状态或可恢复 run id。
- **猎聘与 51job 后端** · `src/test/java/com/getjobs/application:1` — 没有直接测试覆盖第一条配置选择、profile 隔离、并发写、旧库迁移、批量部分失败、投递状态回写或大数据统计，属于完全无测试风险。
- **AI 分析与 Provider** · `src/main/java/com/getjobs/application/service/AiService.java:130` — 429、5xx 与网络异常没有 Retry-After、退避或有限重试；reasoning 参数错误时会发起第二次提供商请求，存在重复计费。错误日志还直接包含完整 response body。
- **AI 分析与 Provider** · `src/main/java/com/getjobs/application/service/JobAiAnalysisService.java:302` — 无法修复的错误 JSON 会转换成 score=0、默认 SKIP 的正常结果；空内容、非 JSON 或无法识别的 Markdown 可能被当成跳过岗位，而不是明确失败。
- **AI 分析与 Provider** · `src/main/java/com/getjobs/application/service/ChromeJobAnalysisQueueService.java:128` — dedupeKey 包含 runId，completed key 只保留 30 分钟；同一岗位换扫描 runId 就会再次调用模型，失败任务先进入 completedKeys，重复成本与失败重试不一致。
- **AI 分析与 Provider** · `src/main/java/com/getjobs/application/service/AiService.java:158` — 图片简历固定构造 Chat Completions endpoint，没有按模型选择 Responses API，也没有 reasoning fallback；仅支持 Responses 的视觉模型会失败。
- **AI 分析与 Provider** · `src/test/java/com/getjobs/application/service/AiServiceProviderTest.java:37` — 直接测试主要是 mock provider 路由、阈值和 Markdown 修复；未覆盖真实 HTTP timeout、429/5xx、空或错误 JSON、fallback 二次调用、队列重启或真实 Codex 进程边界。
- **数据与配置基础** · `src/main/resources/db/migration/V1__init_schema.sql:1-291` — Flyway DDL 与运行时兼容 DDL 双轨维护；DatabaseSchemaService 未创建 V1 中多张平台和选项表，也未创建 V4 的 job_analysis_task，不同初始化路径可能得到不同 schema。
- **数据与配置基础** · `src/main/resources/db/migration/V1__init_schema.sql:10-28` — config.config_key 与 cookie.platform 均无 UNIQUE/NOT NULL；服务采用先查询后 insert/update，并发请求可产生重复配置或 Cookie。
- **数据与配置基础** · `src/main/java/com/getjobs/application/service/ProfileService.java:22-32` — 强制删除档案只清理固定 PROFILE_RELATED_TABLES，遗漏含 profile_id 的 job_analysis_task；数据库没有外键或 ON DELETE，删除后会留下孤儿任务记录。
- **数据与配置基础** · `src/main/resources/db/migration/V1__init_schema.sql:1-7` — profile.is_active 没有 CHECK 或唯一约束；createProfile 与 activateProfile 都是非原子多步操作，并发时可能出现多个 active 档案。
- **数据与配置基础** · `src/main/java/com/getjobs/application/entity/ConfigEntity.java:27-33` — API_KEY、Webhook、Cookie 等敏感值直接明文存入 config/cookie 表，读取接口返回完整实体值；个人本地 V1 是本机泄露风险，对外 SaaS 则为高风险。
- **数据与配置基础** · `src/test/java/com/getjobs/application/service/DatabaseSchemaServiceAiThresholdTest.java:22-54` — 直接测试只覆盖一个已有 ai 表补列场景及 mocked ConfigService；没有 Flyway 全量迁移、双轨 schema 对比、事务回滚、profile 孤儿、并发唯一性或备份恢复测试。
- **Playwright 运行时** · `src/main/java/com/getjobs/worker/manager/PlaywrightManager.java:92-121` — PlaywrightManager 约 2376 行，同时承担四个平台浏览器生命周期、Cookie、导航、登录监控、状态通知和调试操作，存在明显 God Component。
- **Playwright 运行时** · `src/main/java/com/getjobs/worker/utils/PlaywrightUtil.java:38-98` — PlaywrightUtil 另维护一套静态 Playwright、Browser、Context、Page 生命周期，且 init 无同步或幂等保护；与 Spring PlaywrightManager 并存形成重复运行时。
- **Playwright 运行时** · `src/main/java/com/getjobs/worker/utils/PlaywrightUtil.java:103-145` — 静态 close 不清空引用，navigate 直接使用静态 Page 且未显式设置导航超时；重复 close、并发 init/close 或页面已关闭时可能操作失效对象。
- **Playwright 运行时** · `src/main/java/com/getjobs/worker/utils/PlaywrightUtil.java:343-429` — saveCookies 将完整 Cookie value 以明文 JSON 写入传入路径，未见文件权限、加密或敏感值保护。
- **Playwright 运行时** · `src/main/java/com/getjobs/worker/manager/PlaywrightManager.java:421-469` — 登录检查、URL、选择器和等待操作大量空 catch 或返回 false/空字符串；导航异常又以当前 URL 命中作为成功 fallback，可能吞掉根因。
- **Playwright 运行时** · `src/main/java/com/getjobs/worker/utils/PlaywrightUtil.java:217-298` — 通用 click、fill、type、读取函数捕获异常后只记录并返回 void 或空字符串，调用方无法区分成功、超时、页面失效和元素不存在。
- **Playwright 运行时** · `src/test/java/com/getjobs/worker/manager/PlaywrightManagerStatusTest.java:1` — 直接测试主要覆盖登录状态、通知和 profile lock；未见真实页面并发、Cookie 重载、导航超时、浏览器异常退出、restart recovery 或资源关闭测试。
- **旧平台 Playwright Worker** · `src/main/java/com/getjobs/worker/boss/Boss.java:73-1035` — 四个旧 Worker 都把导航、DOM 选择器、网络监听、数据库写入、AI 分析、投递和进度状态揉在单个大类中，流程高度重复且没有统一确认协议。
- **旧平台 Playwright Worker** · `src/main/java/com/getjobs/worker/liepin/Liepin.java:67-98` — 响应监听会清空并重建 API 实体，提交时却按 DOM 卡片索引取实体；接口响应与 DOM 顺序不一致时可能绑定错误岗位或 HR。
- **旧平台 Playwright Worker** · `src/main/java/com/getjobs/worker/zhilian/ZhiLian.java:291-331` — 智联使用 existsByJobId 后再 insertJob 的分离式检查，插入异常只告警；已存在岗位仍加入后续 AI 分析，重复扫描可能重复消耗。
- **旧平台 Playwright Worker** · `src/main/java/com/getjobs/worker/job51/Job51.java:111-180` — 网络监听、导航和页面处理大量捕获异常后继续；外层仍可能发送完成进度并返回已有结果，无法区分完整成功、部分成功和页面失效。
- **旧平台 Playwright Worker** · `src/main/java/com/getjobs/worker/boss/Boss.java:247-287` — 核心流程依赖大量脆弱选择器、固定 sleep、滚动重试和文本匹配；站点 DOM 小幅变化就可能误判，且没有对应浏览器回归测试。
- **构建、交付与文档** · `.github/workflows/ci.yml:109-123` — Chrome 扩展 CI 只运行 manifest 引用和 JavaScript 语法校验，没有执行扩展功能测试；sonar 配置虽声明扩展测试与 LCOV，测试契约未在 CI 接线。
- **构建、交付与文档** · `.github/workflows/release.yml:7-19` — Release 工作流同时响应 pull_request 和 tag push，但整个 job 统一声明 contents: write；PR 构建执行不可信代码时权限边界过宽。
- **构建、交付与文档** · `sonar-project.properties:6-15` — 配置了 JaCoCo、扩展 LCOV 和 TypeScript tsconfig，但现有工作流没有 Sonar 扫描、质量门禁或 coverage 生成，指标尚未成为发布门槛。
- **构建、交付与文档** · `start_docker.ps1:85-103` — Docker 启动器只用 TCP 端口 6866 判断前端就绪，不检查 HTTP 内容或后端 health；depends_on 只保证容器启动，脚本可能在 API 未可用时宣称完成。
- **构建、交付与文档** · `start_windows.ps1:259` — Windows 总启动脚本无条件覆盖 JAVA_TOOL_OPTIONS，run_backend 脚本却会保留并追加参数，两个入口环境契约不一致。

### LOW (17)

- **前端壳与配置中心** · `front/app/ai-config/page.tsx:111` — AI 配置页约 651 行，同时协调 AI 配置、简历上传解析、优先公司、Boss 配置、Profile 切换、生成配置和整页 UI，已经出现页面级膨胀。
- **前端壳与配置中心** · `front/lib/sse.ts:10` — 共享 SSE helper 的 onError 使用显式 any；目前范围有限，但丢失 EventSource 和网络错误的类型约束。
- **分析与确认投递界面** · `front/app/51job/analysis/AnalysisContent.tsx:112` — 51job 与猎聘仍是旧 Worker 平台能力边界，分析页缺少当前 Chrome 主链具备的确认投递和人工覆盖闭环。
- **Chrome Bridge 网关** · `chrome-extension/background.js:1500-1513` — 智联消息在 background 中做未版本化与 _V2 双格式转换；这是有界兼容 shim，但增加协议维护成本。
- **Chrome Bridge 网关** · `chrome-extension/page-bridge.js:32-81` — page bridge 已限制 event.source、origin、source 字段和允许消息类型，manifest 权限范围也主要限定本地工作台及招聘平台；该部分职责清楚。
- **Boss 扩展适配器** · `chrome-extension/boss-selectors.js:4-63` — 选择器集合存在重复与高度宽泛的 class* fallback；虽有去重和容错，仍增加页面结构变化时的误匹配与维护成本。
- **智联扩展适配器** · `chrome-extension/zhilian-content.js:81-129` — 运行时消息会去掉 _V2，同时并存多套投递协议入口；这是有界兼容 shim，但增加 legacy 和 dual-format 维护成本。
- **API 运行时与共享契约** · `src/main/java/com/getjobs/application/controller/ConfigController.java:159-167` — 配置 health 端点固定返回 success=true/status=healthy，未调用 ConfigService 或数据库，属于假健康检查。
- **Boss 后端业务** · `src/main/java/com/getjobs/application/controller/BossController.java:98` — execute/start 接口固定返回 410 backend_scan_disabled，但同一控制器仍保留 Playwright 登录、停止和调试接口；这是 Chrome Bridge 迁移兼容层。
- **智联后端业务** · `src/main/java/com/getjobs/application/controller/ZhilianController.java:720` — health 接口固定返回 success=true/status=healthy，不检查数据库、队列、浏览器或 Worker，依赖故障时会产生误导性健康结果。
- **猎聘与 51job 后端** · `src/main/java/com/getjobs/application/service/Job51Service.java:27-808` — 两个 legacy Service 各自承担 schema 初始化、配置解析、采集入库、投递状态、统计和分页，存在重复逻辑且修改 blast radius 高。
- **AI 分析与 Provider** · `src/main/java/com/getjobs/application/service/CodexCliService.java:61` — Codex 子进程 stdout/stderr 均丢弃，失败时只能看到退出码；临时文件清理也吞掉异常，诊断和资源残留不可观测。
- **旧平台 Playwright Worker** · `src/main/java/com/getjobs/worker/boss/Boss.java:889-923` — 详情响应监听定义完整但在该类中未见调用，属于疑似遗留链路；当前实际路径另行处理详情。
- **构建、交付与文档** · `front/start-prod.mjs:40-57` — 前端生产静态服务器、Next 导出、复制到后端 dist 和后端静态端口多套交付路径并存，修改资源路由时容易漂移。
- **构建、交付与文档** · `docker-compose.yml:12-16` — 默认 Compose 使用开发镜像、Gradle continuous 和 bind mount，前端启动执行 pnpm install，定位是开发容器而非可复现生产运行时。
- **构建、交付与文档** · `docs/README.md:3-15` — 历史文档仍分散在根目录、doc 与 docs，多入口和旧方案并存，文档职责存在重复和漂移风险。
- **构建、交付与文档** · `demo/README.md:10-14` — Demo 样例明确尚未自动接入应用，后续导入、隔离和重置仍是未来流程；属于 placeholder 数据契约。

## Cross-cutting themes

- **状态机是最高风险共性问题.** 扫描、AI 分析和投递横跨前端、扩展、后端与旧 Worker，但成功、部分成功、未知结果、重复回调和重启恢复没有一套持久化且受约束的状态转换；多处 fallback 会把故障转换成零数据、跳过或 success=true。
- **Chrome 主链与 Playwright 旧链长期并存.** Boss/智联已以 Chrome Bridge 为主，猎聘/51job 仍依赖 Playwright，旧 Boss/智联 Worker 和多套静态交付路径仍保留；兼容性让 V1 能跑，也让维护者难以判断真正执行路径。
- **数据层缺少可靠约束与单一迁移真相.** Flyway、DatabaseSchemaService 与平台 Service 的运行时 DDL 三轨并存，关键 profile/job/config/cookie 关系缺少外键、唯一约束和原子 upsert；不同初始化、并发或中途失败可能得到不同结果。
- **本地单机信任边界没有被代码强制.** 配置和 Cookie 接口可读写明文敏感值，后端默认未绑定 loopback、无认证授权，任意扩展 ID 还能访问部分接口；只在严格本机单用户环境下风险才被运行方式降低。
- **God Component 与跨平台复制主导维护成本.** BossPage、各分析页、background/content scripts、BossService、ZhilianController 和 PlaywrightManager 同时承担 UI、协议、状态、持久化与错误处理；四平台相似实现复制，修一处很容易让另一平台漂移。
- **测试覆盖集中在纯函数而非真实失败边界.** 现有 Java 与扩展测试能保护参数归一化、路由和少量状态，但真实 Chrome 导航、投递确认、SQLite 迁移/并发、队列重启、Provider 超时与前端核心交互仍主要依赖人工验证；健康接口也无法证明这些依赖可用。

