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

## 服务切换记录

1. 重新确认 6866 监听与 RunDock Backend 成员身份，备份共享 `C:\Users\10578\Documents\New project 3\db\getjobs.db`，记录完整性及 SHA-256。
2. 仅停止该 Backend 成员，备份其原始启动配置，将工作目录和启动脚本改成本修复工作树；保留其他启动参数与环境变量，显式沿用共享数据库和原有数据路径。
3. 通过 RunDock 启动，核验成员状态、监听 PID 及父进程、运行目录、共享数据库、`/api/ready`、`/api/hr-assistant/status` 和环境配置静态页面。
4. Chrome 加载本工作树 `chrome-extension`，刷新扩展及 BOSS 聊天页；核对人物档案和 BOSS 账号后，由用户启动半自动值守，验证采集与待确认草稿。

2026-09-06 用户确认后已完成服务切换。RunDock Backend 持久化 cwd 和脚本均指向 `C:\Users\10578\Documents\AI-JobPilot-worktrees\boss-hr-watch-profile`。最终监听 6866 的 Java PID 51720，父进程链经 Gradle / PowerShell PID 47764 到 RunDock daemon PID 27408。`/api/ready`、值守状态和 HR 设置接口均 HTTP 200；当前档案 4、值守停止、全自动锁定。

共享数据库仍为原项目 `db/getjobs.db`：schema 17，完整性检查正常、外键错误 0；人物档案 3、岗位 895、HR 会话/草稿/发送命令均 0，与切换前一致。数据库、原 RunDock 配置和原密钥备份位于 `C:\Users\10578\Documents\New project 3\target\backups\hr-watch-cutover-20260906-173016`，不进入 Git。

部署发现 Windows 对 Codex 的 AppData 文件重定向：原可用密钥实际位于 Codex 包的 LocalCache 中，而 RunDock 在相同表面路径读取另一份新密钥。已保留原件，将可用密钥复制到共享 `data/secrets/hr-chat.key`，通过 Backend 的 `APP_HR_KEY_PATH` 显式指定，解决旧 HR 设置解密失败。除 cwd、脚本参数和这个密钥路径外，其他启动环境保持不变。密钥内容及临时诊断日志不进入源码或 PR。

浏览器环境配置已加载新版入口、值守状态和全局 AI 说明。Chrome 当前扩展仍从旧 HR 工作树加载，需在扩展管理页加载本修复工作树的 `chrome-extension`（1.6.1），再刷新工作台与聊天页。真实标签绑定及采集到待确认草稿仍待此步骤后验收；未发送真实 HR/QQ 消息。PR 不自动合并。

## 回滚

- 本次代码修复可通过 `git revert` 回退修复提交，不重写历史。
- 若已切换运行服务，停止同一 Backend 成员并恢复已备份的 cwd、脚本参数和环境配置，再启动旧版本。此次没有新增迁移，不应覆盖数据库或删除新产生的数据。


## 2026-09-06 当前 BOSS DOM 兼容修复

用户加载 1.6.1 并开始值守后，首次真实采集在打开任何会话前以 `BOSS_CHAT_UID_MISSING` 暂停。观察到当前列表使用 `.user-list .friend-content-warp .friend-content`，没有旧版 `data-friend-id` 等属性。公开 v5535 的 `chat.c4b6e86c.js` 定义卡片 `source` 属性，列表以 `source.uniqueId` 为 key；`app.c4b6e86c.js` 定义此标识为 `friendId-friendSource`。

扩展 1.6.2 增加仅在 BOSS 聊天页执行的 MAIN world 标识适配器。适配器只在内容脚本请求时，将当前卡片自身组件的有效 UID 写入 DOM；验证原始 ID、来源、uniqueId 及当前显示内容一致，先清除旧属性以避免虚拟节点复用造成串人。不会读取登录凭据、请求 BOSS 接口、点击页面、滚动或定时刷新。采集与发送继续要求唯一命中，并核对选中卡片和右侧聊天组件的 UID 一致。

同步修正姓名/公司拆分和聊天消息容器重复读取；只读 `.im-list` 中实际消息行并跳过系统消息。新增使用合成 HR 数据的 DOM 测试，覆盖无旧属性、同名 HR、来源区分、虚拟节点复用、重复 UID、左右会话不一致、消息方向/顺序，以及先写 Outbox 再读取目标会话。扩展版本检查独立于岗位扫描脚本版本。

验证：扩展 107 项通过，清单与脚本语法校验通过；前端全部 48 项通过（包含新增 DOM 场景 8 项），类型检查及新增文件 lint 通过。此次无后端或数据库修改。

用户指出频繁刷新有风控风险后，已停止 BOSS 页面操作，后续仅离线开发和测试。未在真实页面加载 1.6.2，未重新开始值守，未生成真实草稿、发送 HR 或 QQ 消息。下一次真实验收须与用户约定一次受控扩展更新和聊天页刷新，不连续重试。页面账号显示名与人物档案显示名有差异，开始下一轮前需用户核对是否对应同一人。

本补丁回滚可 `git revert` 对应 DOM 兼容修复提交，再在约定时间更新扩展；数据库保持原样。生产后端运行版本无需因这个扩展补丁重启。
