# Boss 历史岗位应用新分数线

## 背景

当前 Boss 分数线保存接口只更新当前档案的 AI 配置。已经完成 AI 分析并保存为“AI不匹配”的历史岗位不会重新按新分数线判定，用户降低分数线后无法让这些岗位回到正常的“待确认”流程。

## 目标

- 保存普通/优先公司分数线时，使用历史 `ai_score` 自动重判当前档案的 Boss 岗位。
- 仅将达到新分数线的“AI不匹配”单向提升为“待确认”。
- 返回本次提升数量，并让前端刷新列表和统计。
- 不调用 AI Provider，不创建投递请求，不触发真实招聘平台操作。

## 允许修改范围

- AI 分数线保存 Controller 与岗位分析 Service。
- Boss 分数线前端组件、分析页刷新回调及对应测试。
- 本任务文件。

## 禁止修改范围

- 不新增数据库迁移，不修改 `db/getjobs.db`、WAL、SHM 或用户历史分析记录。
- 不修改智联、猎聘、51job 的状态。
- 不修改已投递、投递中、结果未知、失败、已跳过等非“AI不匹配”状态。
- 不调用真实 AI、真实招聘平台或真实投递。
- 不自动合并 PR、删除分支、force push、reset 或 stash。

## 已确定实现要求

- 分数线保存与 Boss 历史提升处于同一事务，任一步失败整体回滚。
- 使用保存后的 `profile_id` 和阈值；`priority_company=1` 使用优先分数线，其余使用普通分数线。
- 更新条件必须包含当前 `delivery_status='AI不匹配'`、有效 `ai_score` 和对应分数线，防止覆盖并发状态变化。
- 提升时只更新 `delivery_status='待确认'`、`ai_decision='APPLY'` 和 `updated_at`；保留 AI 分数、原因及 `job_ai_analysis` 历史证据。
- 重复保存必须幂等；提高分数线不得反向降级已有“待确认”岗位。
- `POST /api/ai/thresholds` 请求保持兼容，响应 `data` 增加 `bossHistoricalPromotedCount`。
- 前端显示提升数量；成功后刷新岗位列表与统计，刷新失败时必须明确说明配置和数据已经保存。

## 验收标准

- 普通/优先公司按各自阈值提升，低分、空分、其他档案和其他状态不变。
- 提升后的岗位进入“待确认”，AI 决策显示 `APPLY`，现有待确认投递流程可继续使用。
- 重复保存返回 0，不产生重复投递或 AI 调用。
- 列表、待确认卡片和统计在保存后刷新。
- 定向测试、完整后端测试、前端测试、lint、typecheck 和生产构建通过。

## 测试命令

```powershell
.\gradlew.bat test --tests "com.getjobs.application.service.JobAiAnalysisServiceStatusTest" --tests "com.getjobs.application.controller.AiConfigControllerThresholdTest"
.\gradlew.bat test --tests "com.getjobs.application.service.BossThresholdReclassificationIntegrationTest"
.\gradlew.bat test
pnpm --dir front test
pnpm --dir front lint
pnpm --dir front typecheck
pnpm --dir front build:prod
```

## 返回格式

- 修改文件与关键行为。
- 测试命令、结果和失败证据。
- Git 分支、提交、Push、PR 和 CI 状态。
- 运行切换前后 PID、监听端口、数据库备份与接口验收证据。
