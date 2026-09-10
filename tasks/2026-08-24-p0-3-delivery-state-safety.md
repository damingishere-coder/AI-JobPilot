# P0.3 投递真实性与幂等回写

## 背景

审计和三路只读侦察确认，四个平台目前没有统一的“投递尝试”事实记录。Boss/智联确认接口只生成临时任务，回调只带 `success` 布尔值并直接覆盖状态；延迟失败可覆盖已投递。扩展在部分 DOM/URL 推断下会把未知结果报为成功，批量部分失败仍返回 `success=true`。猎聘/51job 旧 Playwright 链也会把点击或整页岗位误写为 `delivered=1`。

## 目标

1. 新增持久化投递 attempt，统一使用 `REQUESTED / CONFIRMED / FAILED / UNKNOWN`。
2. 每次投递必须绑定服务端生成的 `requestKey`；回调用事务和 CAS 保证幂等、单调、不可乱序覆盖。
3. 保留旧 `delivery_status` / `delivered` 作为兼容读模型，但只有 `CONFIRMED` 才能映射为“已投递”或 `1`。
4. Boss/智联扩展只有明确平台证据才回写 `CONFIRMED`；点击后证据不足写 `UNKNOWN`。
5. 批量结果返回逐条 `results` 和 confirmed/failed/unknown 计数；部分成功不再伪装为整体成功。
6. 猎聘/51job 旧链停止无证据写 `delivered=1`，无法逐条证明时保守记录 `UNKNOWN`。
7. `UNKNOWN` 提供人工对账和显式重试；重试必须创建新 `requestKey`，并再次提示真实平台动作风险。
8. 清空 Boss/智联分析数据不得重置岗位自增 ID，避免历史 attempt 与新岗位发生行号碰撞。

## 允许修改范围

- Flyway V6、投递 attempt 服务、状态 DTO/常量和对应隔离测试。
- Boss/智联确认与结果回调 Controller，以及兼容读模型更新。
- `chrome-extension/background.js`、Boss/智联 content script 与纯 Node 测试。
- 猎聘/51job Worker 中投递结果判定和旧状态展示。
- 必要的前端类型、状态标签与批量结果提示。

## 禁止修改范围

- 不访问真实招聘平台，不执行真实投递，不调用真实 AI/Provider。
- 不写入、迁移或覆盖 `db/getjobs.db`；迁移只在 `@TempDir` 和隔离副本验证。
- 不处理 AI 队列持久化、Worker 单实例锁、Provider 重试、Profile 数据迁移或全局架构重构。
- 不删除旧状态字段，不清洗历史投递记录，不把历史未知记录自动升级为确认成功。

## 已确定实现要求

- `requestKey` 由后端生成并进入任务、content message、callback 全链。
- 同一 attempt 的相同结果重复提交返回幂等成功；相反终态回调拒绝且不改读模型。
- 旧 attempt 的延迟回调不得覆盖更新 attempt 的状态。
- 无 `requestKey`、岗位/profile 不匹配、无明确 evidence 的成功回调必须失败关闭。
- `UNKNOWN` 可以在同一 attempt 上被更强的明确证据修正为 `CONFIRMED` 或 `FAILED`；`CONFIRMED/FAILED` 互不覆盖。
- callback HTTP 失败必须暴露给调用方；不得用沟通页 URL 或“未检测到错误”作为确认成功。
- 扩展返回必须携带 `persisted`；前端只把 `persisted=true` 视为后端已确认写入，否则幂等补偿为 `UNKNOWN`。
- 旧库中已有“已投递”仅导入为 `LEGACY_STATUS_IMPORT`，不改写原业务字段。

## 验收标准

- fresh/legacy SQLite 可迁移到 V6，Schema 和历史行数完整。
- REQUESTED→CONFIRMED/FAILED/UNKNOWN、重复同结果、相反终态、UNKNOWN 对账、stale request 均有测试。
- Boss/智联 confirm 重复调用不产生不同 request；回调必须匹配当前 profile、岗位和 requestKey。
- 智联无成功 DOM/有无错误均不能默认 CONFIRMED；Boss 空响应进入沟通页只能 UNKNOWN。
- 批量结果逐条可见，存在失败或未知时整体 `success=false` 且 `partial` 正确。
- 51job 不再把当前页全部 jobId 无条件写为已投递；猎聘聊天关闭失败不再写确认成功。
- 清空分析后新岗位不得复用旧行 ID；旧 attempt 继续保留用于审计但不能污染新岗位。
- UNKNOWN 可人工对账或显式重试；51job 回写失败必须升级为任务错误，并在下一轮安全恢复为 UNKNOWN。
- 后端完整测试、前端 lint/typecheck/build、扩展测试全部通过；原数据库 hash/mtime 不变。

## 测试命令

```powershell
.\gradlew.bat test
$env:P0_REHEARSAL_DB = (Resolve-Path db/getjobs.db).Path
.\gradlew.bat test --tests com.getjobs.application.service.DatabaseMigrationRehearsalTest
Remove-Item Env:P0_REHEARSAL_DB
pnpm --dir front lint
pnpm --dir front typecheck
pnpm --dir front build
$extensionTests = Get-ChildItem chrome-extension/tests/*.test.cjs | ForEach-Object { $_.FullName }
node --test $extensionTests
```

## 返回格式

- 状态机、幂等键、证据等级和兼容映射说明。
- 四平台在 confirmed/failed/unknown/partial 下的行为。
- migration、CAS、乱序/重复 callback 与扩展判定测试证据。
- 原数据库未修改证据、diff、Commit、Push 与 PR。
