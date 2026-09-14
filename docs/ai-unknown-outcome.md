# P0.7：AI 未知调用结果与有界修复

## 结果边界

Codex CLI 和远程 Provider 统一使用 `AiProviderException` 的 `outcomeUnknown` 与非秘密 `clientRequestId`。

- 找不到可执行文件、临时文件准备失败、等待并发名额超时、进程无法启动：已知未发起调用，标记 FAILED。
- 进程已启动后超时、非零退出、输入写入/结果读取失败、中断、结果文件丢失或为空：可能已产生调用，标记 UNKNOWN。异常提示明确说明可能产生费用或额度消耗。
- 超时边界出现的迟到文件不会被当成功；不自动再启动进程。清理只终止本次创建的进程树，删除本次临时文件。
- Job AI 匹配调用 UNKNOWN 进入现有持久任务 UNKNOWN 状态；普通重试不通过，须明确 `confirmUnknown=true`。不新建队列，不切换 Provider、模型或认证。

## 修复调用与费用归因

`AiAnalysisCallLedger` 记录本批次的逻辑调用用途、序号、所属任务、返回/失败/未知及未知调用的关联 ID，不记录 Prompt、原始响应、密钥或简历。

| 用途 | 自动调用上限 |
| --- | --- |
| MATCH_BATCH | 每批 1 次 |
| BATCH_FORMAT_REPAIR | 只有已收到坏格式响应时，每批最多 1 次 |
| SINGLE_FORMAT_REPAIR | 只有已收到缺失/无效项时，每岗位最多 1 次 |
| GREETING_REPAIR | 每 BOSS 岗位最多 1 次，匹配与话术分开 |

总逻辑调用预算不超过 `2 + 2 × 批次岗位数`，保留原有上限（目前每批最多 5 岗）。网络层仍使用 AiService 原有最多 2 次 HTTP 请求预算，429 和兼容端点切换共享该预算；CLI 每个逻辑调用最多启动 1 个进程。逻辑调用数不是实际 HTTP 请求数，更不是账单金额，不能混用。

`RESPONSE_RECEIVED` 仅表示收到响应，业务有效性继续由原 Schema、证据和话术规则验证。每个分析结果在持久化时保存当时的调用审计快照到现有诊断 JSON 与岗位分析理由；较早完成的岗位不宣称包含后续尚未发生的调用。

BOSS 话术补生成 UNKNOWN 时，保留已完成的匹配结果和原阈值决策；单独记录 `greetingGenerationOutcome=UNKNOWN`，不将整批改为失败或自动重跑。界面风险和分析详情提醒手工编辑/核对话术，原用户草稿不覆盖。

## 验证及回退

模拟 Process 覆盖启动前失败、启动后超时/退出/丢文件/空结果/管道失败/中断/迟到结果、调用次数和临时文件清理。所有测试禁止启动真实 Codex 或远程 AI。业务测试覆盖匹配 UNKNOWN 只调用一次、话术 UNKNOWN 保留匹配、预算去重以及现有任务 `confirmUnknown` 门禁。

无数据库 migration，现有诊断 JSON 兼容扩展。上线不补跑历史任务。回退保留未知分类安全修复及历史结果，不将 UNKNOWN 改为 FAILED，不自动续跑；必要时暂停新 AI 分析并前滚修复。
