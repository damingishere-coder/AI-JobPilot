# 岗位 AI 分析超时修复

2026-10-09 的 BOSS 扫描记录显示：两个五岗位批次各执行约 301 秒后超时，十条任务进入 UNKNOWN。服务实际模型已经是 `gpt-6.1-sol`，但 CLI 继承了桌面用户配置的 `xhigh` 推理强度；第一批持久请求合计约 2.7 万字符。

岗位结构化分析固定使用 `gpt-6.1-sol`。Codex 调用独立使用 `high` 和 `--ignore-user-config`，继续通过原 CODEX_HOME 登录，保留只读沙箱、临时会话和 JSON Schema。通用文本、简历图片和 HR 入口保持各自原有配置。该选项需要 CLI 支持；现有部署使用的 `0.162.0-alpha.2` 已通过实际调用验证，旧 CLI 不应被静默降级或替换。

队列按持久请求的字符总量合并岗位，每批最多 12,000 字符且最多五个岗位。超过上限的单个岗位独立执行，材料不截断，未合并任务继续排队。简历仍完整保留。字符上限控制批量大小，不能保证所有网络或模型请求永远不会超时。

分析输入快照与实际模型共用同一配置规则。调用日志记录请求 ID、模型、分析模式和结果状态，不输出简历、岗位正文或凭据。已启动但超时的调用继续标记 UNKNOWN，禁止自动重试；既有模型为 GPT-6.1 的快照身份保持兼容。CLI 旧实现已删除临时结果，无法从本机核对这十次岗位结果，不得将其伪造为成功。

本地验证命令：

```powershell
.\gradlew.bat test --tests '*AiServiceProviderTest' --tests '*CodexCli*Test' --tests '*ChromeJobAnalysisQueueServiceTest' --tests '*JobAnalysisTaskStoreTest' --tests '*JobAiAnalysisServiceStatusTest' --tests '*AnalysisClearSequenceSafetyTest'
```

真实 CLI 验证使用合成岗位材料；不执行投递或联系 HR。发布沿用 RunDock Backend `1d84134e-f688-4890-8efe-f175c8790b53`、端口 6866 和共享数据库。部署前用 SQLite backup API 保留一致性备份，等待没有正在执行的 AI 任务后重启原托管服务。部署后检查模型、实际 CLI 参数、分析结果和 readiness。

回滚通过普通 revert 本 PR 合并提交并重启原服务。保留全部业务记录，不用旧数据库覆盖发布后的岗位或分析数据。
