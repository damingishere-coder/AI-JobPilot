# BOSS 值守修复与人物档案保护

## 原因与改动

- 2026-09-06 实测 6866 基础服务健康，但 `/api/hr-assistant/status` 返回 404。监听 Java PID 7980 来自岗位扫描工作树；RunDock Backend 成员 `1d84134e-f688-4890-8efe-f175c8790b53` 仍使用该工作树的 `scripts/run_backend.ps1`。
- 本修复基于 HR 分支，保留岗位扫描改动和 `gpt-6-astra` 默认模型。扩展升级到 1.6.1，增加环境配置聊天入口及连接状态，区分后端缺失与响应契约错误。
- AI Provider、模型及密钥全局共用，切换档案不改变这些配置；简历、HR 设置和待处理记录按人物档案隔离。
- 值守启动、发送命令领取和档案切换使用同一个后端锁；档案事务提交之前不会释放锁。值守或入库/发送未结束时，切换及删除当前档案返回 `HR_WATCH_ACTIVE`。
- 停止后允许已领取的发送命令回报结果；未知结果不自动重试。发送使用后端租约截止时间，过期不得点击发送。扩展停止后的旧扫描不得恢复值守状态。
- 未增加数据库迁移；旧版无档案归属的 Outbox 保留并提示人工处理。

## 验证

- `gradlew.bat --no-daemon test bootJar`：324 项测试，320 通过，4 跳过，无失败。
- `node --test chrome-extension/tests/*.test.cjs`：106 通过。
- `node scripts/validate-chrome-extension.mjs`：通过。
- `front` 中 `pnpm test`：40 通过；`pnpm typecheck` 通过；`pnpm lint` 0 错误、35 条既有警告；`pnpm build:prod` 通过。
- `git diff --check`：通过。
- 使用本次 JAR、独立 `target/hr-smoke/smoke.db` 和 6867 端口验证：健康接口和环境配置 HTTP 200，静态页面包含聊天入口与全局 AI 说明；测试档案开始值守后切换/删除返回 409，停止后可切换，旧采集请求被拒绝，AI 配置前后完全一致。测试服务已关闭。
- 没有操作真实 BOSS 会话，没有调用真实 AI 生成或发送 HR/QQ 消息。真实采集到草稿验收仍待服务切换和浏览器扩展刷新。

## 待授权的服务切换

1. 重新确认 6866 监听与 RunDock Backend 成员身份，备份共享 `C:\Users\10578\Documents\New project 3\db\getjobs.db`，记录完整性及 SHA-256。
2. 仅停止该 Backend 成员，备份其原始启动配置，将工作目录和启动脚本改成本修复工作树；保留其他启动参数与环境变量，显式沿用共享数据库和原有数据路径。
3. 通过 RunDock 启动，核验成员状态、监听 PID 及父进程、运行目录、共享数据库、`/api/ready`、`/api/hr-assistant/status` 和环境配置静态页面。
4. Chrome 加载本工作树 `chrome-extension`，刷新扩展及 BOSS 聊天页；核对人物档案和 BOSS 账号后，由用户启动半自动值守，验证采集与待确认草稿。

服务切换未执行，6866 仍是旧版本；PR 不自动合并。

## 回滚

- 本次代码修复可通过 `git revert` 回退修复提交，不重写历史。
- 若已切换运行服务，停止同一 Backend 成员并恢复已备份的 cwd、脚本参数和环境配置，再启动旧版本。此次没有新增迁移，不应覆盖数据库或删除新产生的数据。
