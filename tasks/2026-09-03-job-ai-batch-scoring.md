# 岗位 AI 匹配提质、提速与失败修复

## 背景

当前岗位分析由模型直接给出分数与决策，理由以 JSON 字符串原样展示；持久队列逐岗调用 Codex CLI，并存在合法中文弯引号被兼容修复逻辑破坏的问题。

## 目标

- 使用六个固定维度在后端确定性计算分数和 APPLY/SKIP。
- 将 AI 输出升级为带原文证据的 `schemaVersion: 2` 理由。
- 同档案、同平台每批最多分析 5 岗，最多 2 批并发，单岗失败不影响同批其他岗位。
- Boss 分析页结构化展示理由，显示队列状态并支持失败任务单岗重试。

## 允许修改范围

- `src/main/java/com/getjobs/application/service/JobAiAnalysisService.java`
- `src/main/java/com/getjobs/application/service/JobAnalysisTaskStore.java`
- `src/main/java/com/getjobs/application/service/ChromeJobAnalysisQueueService.java`
- `src/main/java/com/getjobs/application/controller/AiConfigController.java`
- 对应的 `src/test/java/com/getjobs/application/controller/` 测试
- 对应的 `src/test/java/com/getjobs/application/service/` 测试
- `front/app/boss/analysis/` 内的类型、工具、Hooks、组件和测试
- 本任务说明文件

## 禁止修改范围

- AI Provider、登录方式、认证配置和当前 Codex 模型。
- 数据库结构、用户简历、岗位历史数据和运行日志。
- 自动投递或历史失败任务自动重跑。
- 当前运行服务、RunDock 配置与端口监听；未经确认不得重启。

## 已确定实现要求

- 六维权重：核心职责与技能 35、相关经历 25、成果与复杂度 15、行业可迁移性 10、学历与年限 10、地点与薪资 5。
- 状态系数：`MATCH=1.0`、`PARTIAL=0.75`、`UNKNOWN=0.6`、`CONFLICT=0`。
- 简历未写只能是 `UNKNOWN`；硬冲突必须同时具有岗位与简历原文证据，并与一个 `CONFLICT` 分项复用双方证据，否则降级为待核实。
- 最终决策：无有效硬冲突且分数达到普通或优先公司阈值才为 APPLY；APPLY 仍只进入待确认。
- 先解析原始合法 JSON，失败后才兼容修复；批量 JSON 整体无效最多重试一次，单项缺失或无效只重试该岗位一次。
- 每个岗位保留独立任务 ID、租约、终态与数据库写入。
- 任务去重键包含当前简历指纹；Boss 页面任务列表及计数按平台隔离。
- 记录每批岗位数量、耗时、失败数、未知数与失败率，供下一次正常扫描测量实际提速。
- `aiReason` 继续使用字符串列，内部写入 `schemaVersion: 2`，前端兼容新版、旧版 JSON 与历史纯文本。
- 页面可见且存在未完成任务时每 3 秒刷新；隐藏或无未完成任务时停止。

## 验收标准

- 合法 JSON 字符串中的中文弯引号不会触发失败。
- 同档案、同平台 50 个岗位正常路径只调用 AI 10 次；批量并发不超过 2。
- 混合档案或平台不会进入同一批；部分结果失败不影响其他岗位完成。
- 阈值、未知证据与硬冲突规则由后端确定性测试证明。
- Boss 页面不再直接显示原始 JSON或重复同一理由，失败任务可明确单岗重试。

## 测试命令

- `./gradlew.bat test`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build:prod`

## 返回格式

- 汇报变更文件、两次中文提交及 SHA、测试与 CI 结果、Push/PR 状态、未重启服务的说明和回滚方法。
