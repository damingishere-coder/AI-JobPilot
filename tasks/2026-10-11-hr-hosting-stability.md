# HR 聊天托管稳定性修复（2026-10-11）

## 现场与约束

- 正式服务沿用 RunDock Backend `1d84134e-f688-4890-8efe-f175c8790b53`、`127.0.0.1:6866` 和原工作区 `db/getjobs.db`。服务运行目录为 `AI-JobPilot-worktrees/zhilian-modern-collection`。
- 用户明确禁止持续刷新 BOSS 页面。真实页面操作已停止，托管保持暂停；回归浏览器使用隔离 Chromium、本地合成页面、禁止招聘网络访问，没有向真实 HR 发送消息。
- 现场存在 7 条当前授权下被旧视觉身份核验阻止的采集，以及历史 `SEND_UNKNOWN`。不解除旧未知发送、不重发、不恢复历史失效建议。

## 原因与修复文件

| 问题 | 修复 |
| --- | --- |
| 首次聊天少于两条本人消息，被永久认为历史未读完整 | `boss-hr-identity.js` 导出已加载组件的历史起点；绑定当前 UID、真实列表和已完成加载状态。`boss-hr-bridge.js` 接受该证据，等待慢历史加载并检查消息重叠 |
| 打开聊天后红点消失，不完整读取再也不重试 | `boss-hr-host.js` 保留不完整检查点，按 1/2/5/30 分钟退避重读，其他联系人继续；保留历史范围标记 |
| 页面丢失时后台自动重开 | `boss-hr-host.js` 限制只有用户明确开启/恢复可新建一次专用标签；定时器、Chrome 启动、worker 重启不重开、不刷新，不抢焦点 |
| 切换标签快捷键误判为聊天编辑 | `boss-hr-bridge.js` 排除修饰键与导航快捷键；真实聊天输入、Ctrl+Enter、鼠标操作仍暂停 |
| AI 临时故障留下空建议或审核失败阻塞后续消息 | `HrAssistantWatchService` 在建议入库前完成生成和审核；`HrBackgroundStore` 对分析退避重试，最多 4 次尝试；失败会话不阻塞其他联系人 |
| 建议已创建、发送队列入库失败后被去重跳过 | `HrBackgroundStore.commitProposal` 将建议、审核决定、出站队列放入短事务；AI 不持有数据库事务；提交前重验暂停、档案、会话和授权 |
| SQLite 并发心跳日志反复 SQLITE_BUSY | `application.yaml` 配置 WAL、10 秒 busy timeout；`ScanRunService.sync` 写锁先于读快照，避免读事务升级失败 |
| 工作台连接正常却看不到回复处理受阻 | `HrAutopilotSettings.tsx` 显示后台分析阻塞、等待重试的真实诊断 |

数据库迁移 `V38__hr_analysis_retry.sql` 只新增重试计数、下次重试时间和索引。没有删除或重置会话、消息、建议、发送命令。扩展版本为 `1.10.13`。

## 验证

```powershell
node scripts/validate-chrome-extension.mjs
node --test chrome-extension/tests/*.test.cjs
pnpm --dir front test
pnpm --dir front typecheck
pnpm --dir front lint
pnpm --dir front build:prod
.\gradlew.bat test build browserRegressionTest --no-daemon
```

新增回归覆盖：首次短聊天与错误历史边界、快捷键不误暂停、不完整采集红点清除后的重试、AI 生成/审核临时失败与独立联系人继续、分析重试次数不被重复采集重置、页面缺失/卸载不刷新重开、真实连接池读写竞争、出站入库失败时建议回滚。

本地结果：后端 665 项中 661 通过、4 跳过；前端 410 项、扩展 350 项、离线浏览器 20 项通过。后端构建、前端 typecheck/lint/构建与扩展校验通过（lint 有既存警告，无错误）。

测试通过只证明代码及离线流程；真实账号自动发送和长时间托管稳定性没有在本次验证中执行。旧未知发送仍需人工核验。

## 部署与回滚

按现有 GitHub 主线流程合并后，在上述运行目录切换至合并提交，由现有 RunDock 服务重启。部署前使用 SQLite online backup 保存原数据库及旧版本信息；WAL 数据库不能仅复制 `.db` 文件当作一致备份。

业务代码回滚依据为部署前提交 `8e1e0307529428e014d75af4da82f2aaa85f4879`。回滚时保留 `V38__hr_analysis_retry.sql` 迁移资源和数据库新增字段，避免 Flyway 将已应用的 V38 判为缺失。优先创建回滚 PR：撤销本次业务代码改动后恢复 V38 文件，再按正常验证、合并和部署流程发布；紧急切换旧版本也须先保存并保留该迁移资源，再重启同一服务。不能删除已应用迁移、历史数据或自动覆盖数据库。

Chrome 已加载的扩展 worker 需要用户在扩展管理页重新加载 `Chrome Bridge` 才会使用新代码。此动作不要求刷新 BOSS 页面。托管保持暂停，用户核对后可手动恢复；本次不自动恢复真人回复。

## 本次文件清单

```text
chrome-extension/boss-hr-bridge.js
chrome-extension/boss-hr-host.js
chrome-extension/boss-hr-identity.js
chrome-extension/manifest.json
chrome-extension/tests/boss-hr-assistant.test.cjs
chrome-extension/tests/boss-hr-background-bridge.test.cjs
chrome-extension/tests/boss-hr-host.test.cjs
chrome-extension/tests/manifest-id.test.cjs
chrome-extension/tests/profile-scoped-scan-contract.test.cjs
front/app/env-config/HrAutopilotSettings.test.tsx
front/app/env-config/HrAutopilotSettings.tsx
src/main/java/com/getjobs/application/service/HrAssistantWatchService.java
src/main/java/com/getjobs/application/service/HrAutopilotService.java
src/main/java/com/getjobs/application/service/HrBackgroundStore.java
src/main/java/com/getjobs/application/service/ScanRunService.java
src/main/resources/application.yaml
src/main/resources/db/migration/V38__hr_analysis_retry.sql
src/test/java/com/getjobs/application/service/HrBackgroundBrowserRegressionTest.java
src/test/java/com/getjobs/application/service/HrBackgroundStoreTest.java
src/test/java/com/getjobs/application/service/HrBackgroundWatchServiceTest.java
src/test/java/com/getjobs/application/service/SqliteRuntimeConcurrencyTest.java
tasks/2026-10-11-hr-hosting-stability.md
```
