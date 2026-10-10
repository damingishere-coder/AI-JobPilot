# HR 托管与岗位扫描隔离

同一人物档案的岗位扫描与 HR 托管分别控制；切换档案仍须先停止托管。扫描按绑定标签 ID 和 URL 双重排除 HR 标签，包括加载、跳转、暂停及旧扫描关联冲突。窗口准备和派发前再次核验，扫描状态查询和停止不会联系 HR 标签。

新草稿和更新确认码后的草稿有效期均为 24 小时。HR 新消息、本人回复及发送前上下文变化立即撤销旧建议；发送租约和发送未知保护沿用原规则。旧失效记录不延长、不恢复、不补发。V37 仅添加 expiry_reason 字段，旧记录留空，在 UI 中标为原因未保存。

回复接口新增 expiryReason；后台状态接口新增 lastTransition。Chrome 后台状态变化同时持久保存时间、来源和原因，普通心跳不覆盖状态变化原因。扩展版本 1.10.12。

验证：后端全量测试 660 项（原配置跳过 4 项），构建通过；补齐失效原因后相关后端 94 项再次通过。扩展 346 项通过，manifest 校验通过；前端 408 项通过，类型检查、lint（20 个已有警告，无错误）、生产构建通过。最后新增状态变化展示测试及失效原因测试分别通过 30 项和 11 项。真实 MV3 离线扫描测试确认新标签加载后再准备独立窗口，该用例修复后通过。完整离线浏览器回归及最终 CI 在交付时继续核对。

部署沿用现有 RunDock Backend 和共享 db/getjobs.db；部署前使用 SQLite 在线备份，保存旧运行提交与四条发送未知记录。回滚代码时保留 V37 迁移及新增字段，不能恢复旧数据库覆盖后续业务数据。真实浏览器须确认实际加载 1.10.12，模拟消息验证发送回归。

本次修改文件：

- 扩展：`chrome-extension/background.js`、`boss-hr-host.js`、`manifest.json`；对应 `tests/background-tab-routing.test.cjs`、`boss-hr-host.test.cjs`、`boss-hr-assistant.test.cjs`、`manifest-id.test.cjs`、`profile-scoped-scan-contract.test.cjs`。
- 界面：`front/app/env-config/HrDutyActivity.tsx`、`HrDutyActivity.test.tsx`、`HrAutopilotSettings.tsx`、`HrAutopilotSettings.test.tsx`。
- 后端：`src/main/java/com/getjobs/application/hr/HrAssistantTypes.java`；`src/main/java/com/getjobs/application/service/` 下 `HrAssistantStore.java`、`HrAssistantWatchService.java`、`HrAutopilotStore.java`、`HrVisualStore.java`。
- 后端测试：`src/test/java/com/getjobs/application/service/` 下 `HrAssistantStoreTest.java`、`HrBackgroundWatchServiceTest.java`、`HrBackgroundStoreTest.java`、`HrVisualStoreTest.java`。
- 迁移：`src/main/resources/db/migration/V37__hr_reply_expiry_reason.sql`；本说明文件。

复测命令：`node scripts/validate-chrome-extension.mjs`、`node --test chrome-extension/tests/*.test.cjs`、`pnpm --dir front test`、`pnpm --dir front typecheck`、`pnpm --dir front lint`、`pnpm --dir front build:prod`、`gradlew.bat test build browserRegressionTest --no-daemon`。浏览器回归只使用临时档案和模拟招聘页面，不向真实 HR 发送消息。
