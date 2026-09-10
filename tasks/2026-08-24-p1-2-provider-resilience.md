# P1.2 Provider 超时、重试与成本保护

## 背景

远程 AI API 目前只有连接超时，没有请求总超时；429 不读取 `Retry-After`，错误日志和异常消息会携带完整响应体。岗位分析对空内容、坏 JSON 和缺字段会降级为 `score=0/SKIP`，分析历史或平台缓存写入失败后任务仍可能显示成功。Codex CLI 的槽位等待和进程执行还会各自消耗一整份超时预算。

## 目标

1. 远程文本和图片请求都具备明确总超时，不再无限占用 AI worker。
2. 自动重发仅限明确 429，最多一次，遵守且限制 `Retry-After`；500、网络断开和超时不盲目重发。
3. 单次业务调用最多两次远程请求；reasoning endpoint fallback 与 429 重试共享预算。
4. 每次调用生成本地 request id；日志和异常只保留安全元数据，不输出完整 Provider body、Prompt 或密钥。
5. 空内容、不可修复 JSON、缺字段、非法 score/decision 进入明确 AI 失败，不再伪装为业务 `SKIP`。
6. 分析历史插入失败或平台 CAS 未命中时，持久任务不得标记 SUCCEEDED。
7. timeout/network/结果写回不确定进入任务 UNKNOWN，显式重试继续沿用 P1.1 的 `confirmUnknown=true` 门禁。
8. Codex CLI 的槽位等待和进程执行共享一个总 deadline，超时后清理本次进程树。

## 允许修改范围

- `AiService` 的远程 HTTP 请求、错误分类、请求追踪和日志。
- `CodexCliService` 的 deadline 与本次子进程清理。
- `ConfigService`、环境配置页和示例配置中的远程 API 超时设置。
- `JobAiAnalysisService` 的严格输出校验、脱敏诊断、写入结果判断。
- `JobAnalysisTaskStore` / `ChromeJobAnalysisQueueService` 的 UNKNOWN 完成语义。
- AI Controller 的失败响应，以及对应纯本地单元/故障注入测试。

## 禁止修改范围

- 不调用真实 Provider、Codex CLI 或招聘平台，不启动正式服务，不访问真实数据库。
- 不修改 Prompt 内容、模型路由启发式、AI 阈值、投递状态机或数据库 Schema。
- 不加入 Resilience4j、消息队列、多 Provider 智能路由、全局配额/计费系统。
- 不对 timeout、网络异常、500/502/503/504 自动重试；这些结果可能已产生费用。
- 不将 request id 描述为 Provider 幂等保证。

## 已确定实现要求

- 新增 `AI_REQUEST_TIMEOUT_SECONDS`，默认 120 秒，限制 1～1800 秒；同时写入 `HttpRequest.timeout`。
- 每次远程业务调用使用同一个 UUID request id 和最多 2 次总请求预算。
- 429 仅在首次请求、可解析且不超过 10 秒的 `Retry-After`（缺失时使用短默认值）下重试一次；不得与 reasoning fallback 叠加超过两次。
- 错误分类至少包含 rate limit、HTTP 4xx、HTTP 5xx、timeout、network、empty response；异常消息不得拼接原始 body。
- 错误日志只含 endpoint host、client request id、provider request id、status、body length 与 SHA-256 短摘要。
- 合法 Markdown JSON 和有限语法修复继续兼容；无法修复或 schema 不完整必须失败。
- 成功结果不再把完整 `raw_response` 写入数据库，只保留长度、hash 和请求诊断；结构化 score/decision/summary 等字段继续保存。
- `job_ai_analysis` insert 返回 0/异常，或平台状态更新影响 0 行，必须返回明确错误结果；不得完成为 SUCCEEDED。
- Codex CLI 总时长以单一 deadline 计算；只终止本次创建的进程及其 descendants。

## 验收标准

- 本地 HTTP fixture 覆盖：200、429+Retry-After、500、timeout、空 body、reasoning fallback；断言请求次数上限和 request id 一致。
- 500/timeout 不自动重试；429 最多两次；reasoning fallback 最多两次。
- 日志/异常/持久化诊断不包含 fixture 中的敏感响应正文。
- Markdown 合法 JSON 保持成功；空、坏 JSON、缺字段、非法 score/decision 全部进入 AI_ANALYSIS_FAILED。
- 历史写入失败、平台 update=0 时任务不进入 SUCCEEDED；timeout/network 任务进入 UNKNOWN。
- Codex 纯单元测试验证 deadline 计算和进程清理 helper，不启动真实 Codex CLI。
- Java 全量测试、前端 lint/typecheck/build 通过；真实数据库文件指纹和 sidecar 状态不变。

## 测试命令

```powershell
.\gradlew.bat clean test --console=plain
pnpm --dir front lint
pnpm --dir front exec tsc --noEmit
pnpm --dir front build
```

## 返回格式

- 超时、重试次数、UNKNOWN/FAILED 判定和成本边界说明。
- 故障矩阵与测试证据。
- 真实数据库未修改证据、diff、Commit、Push 与堆叠 PR。
