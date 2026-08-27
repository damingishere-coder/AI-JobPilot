# P1.1 AI 任务持久化与重启恢复

## 背景

当前 `ChromeJobAnalysisQueueService` 只使用进程内线程池、`activeKeys` 和 30 分钟 `completedKeys`。Controller 会先把岗位写成 `AI分析中`，再入内存队列；进程在排队、Provider 请求或结果写回之间退出时，任务与去重信息丢失，岗位可能永久残留在 `AI分析中`。V4 已创建 `job_analysis_task`，但主链尚未使用。

## 目标

1. 将 Boss/智联 Chrome AI 队列写入 SQLite，线程池只作为持久任务的执行器。
2. 使用稳定 `task_key` 跨 runId、跨重启去重；重复入队不重复调用 Provider。
3. 使用 `PENDING / LEASED / SUCCEEDED / FAILED / UNKNOWN` 和租约 CAS。
4. 重启后自动恢复从未开始的 `PENDING`；过期 `LEASED` 只进入 `UNKNOWN`，不得自动重发计费请求。
5. 若 Provider/结果已完成但任务终态尚未写入，依据平台读模型完成对账，不覆盖已有结果。
6. 提供当前 Profile 下的只读任务查询和 `UNKNOWN/FAILED` 显式重试；重试必须由用户主动调用。

## 允许修改范围

- Flyway V7：演进现有 `job_analysis_task`，增加逐岗位任务、租约、重试和错误字段/索引。
- 新增任务存储服务；改造 `ChromeJobAnalysisQueueService` 使用持久任务。
- `JobAiAnalysisService` 增加只读完成判断和保守的中断状态写回。
- AI Controller 增加当前 Profile 的任务查询/显式重试 API。
- 对应 migration、存储、队列、重启恢复和 Controller 隔离测试。

## 禁止修改范围

- 不调用真实 AI Provider，不启动服务，不访问或迁移 `db/getjobs.db`。
- 不修改 Provider 协议、Prompt、总超时、429/500 退避或计费策略；这些属于 P1.2。
- 不持久化 SSE callback，不整体重写 Controller/Worker，不处理旧 Playwright 同步 AI 路径。
- 不自动重试 `LEASED/UNKNOWN`，不声称外部 Provider 可实现 exactly-once。

## 已确定实现要求

- `task_key` 不包含 runId；至少绑定 profile、platform、jobKey 与岗位分析输入摘要。
- enqueue 的“持久化成功”和 executor 的“已开始执行”分开；executor 满时任务保留 `PENDING`。
- claim、lease、完成、失败、UNKNOWN 均使用条件 UPDATE；旧 lease 或旧 worker 不能覆盖新 attempt。
- 执行期间用独立心跳续租，避免合法长耗时 Provider 被误判过期；单次执行最长续租 65 分钟，防止无请求超时的 Provider 永久占用任务租约。
- Provider 返回后、写入分析结果前必须再次校验当前 lease token；旧 worker 丢失租约后只丢弃结果，不能覆盖显式重试后的新 attempt。
- `PENDING` 可安全自动恢复；`LEASED` 过期后先查看平台状态：结果已经落库则完成任务，否则在同一事务中标记 `UNKNOWN` 并把残留 `AI分析中` 变为明确失败。
- 升级前遗留且没有持久任务的 `AI分析中` 岗位仅在服务启动、尚未接收同步请求时分批登记为 `UNKNOWN`，不得直接补发 Provider 请求。
- `FAILED/UNKNOWN` 显式重试复用同一业务 task，但 attempt 递增、清除旧 lease，并重新进入 `PENDING`。
- `UNKNOWN` 重试必须额外传入 `confirmUnknown=true`，明确承担可能重复计费的风险。
- 旧 V4 聚合行没有 `task_key/request_json`，保留但不调度、不删除。

## 验收标准

- fresh/legacy SQLite 均能迁移到 V7；V4 旧行保留。
- 重复 enqueue 只生成一条可执行任务；重启恢复 PENDING 不重复建任务。
- 两个消费者并发 claim 时只有一个成功。
- 过期 LEASED 在平台已有最终结果时对账完成；仍为 `AI分析中` 时进入 UNKNOWN，Provider 调用次数为 0。
- 遗留无任务的 `AI分析中` 行会在启动阶段分批进入 UNKNOWN，Provider 调用次数为 0；定时维护不得误伤同步 `/analyze-job`；合法长耗时任务通过心跳保持租约，但不能超过硬上限。
- 旧租约 Provider 延迟返回时不会写入分析表或覆盖平台状态；超过硬上限的任务可自然过期并进入 UNKNOWN 对账。
- FAILED/UNKNOWN 只有显式 retry 才重新进入 PENDING；SUCCEEDED/LEASED 不允许重试。
- 完整后端测试与隔离迁移演练通过；真实数据库 hash/mtime/sidecar 不变。

## 测试命令

```powershell
.\gradlew.bat clean test --console=plain
$env:P0_REHEARSAL_DB = (Resolve-Path db/getjobs.db).Path
.\gradlew.bat test --tests com.getjobs.application.service.DatabaseMigrationRehearsalTest
Remove-Item Env:P0_REHEARSAL_DB
```

## 返回格式

- 状态机、租约、重启恢复和重复计费边界说明。
- migration 与并发/崩溃点测试证据。
- 原数据库未修改证据、diff、Commit、Push 与堆叠 PR。
