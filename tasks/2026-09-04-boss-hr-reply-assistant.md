# BOSS HR 半自动回复助手执行任务

## 背景

项目已有 BOSS Chrome Bridge、AI Provider、简历档案、招呼语草稿和本地动作令牌，但没有 HR 入站消息、回复草稿、QQ 通知或求职者端安全发送闭环。

## 目标

- 用户在 BOSS 聊天页手动开始值守后，每 60 秒扫描一次带红色未读标记的会话，单轮最多 100 个且禁止重入。
- 使用 OpenCLI 的 BOSS 求职者端只读适配器和 Chrome DOM 命令，不使用屏幕坐标或图像识别。
- AI 基于当前档案简历、岗位、最近对话和沟通资料生成草稿；事实缺失时转人工，不编造。
- 页面助手或授权 QQ 可逐条修改、发送、跳过；通知目标支持私人 QQ 或指定群聊，未经确认不得发送，全自动始终锁定。
- 沟通资料和 QQ/NapCat 设置统一放在投递牛马工作台的“环境配置”页面；BOSS 页面浮窗只显示状态、值守控制和待确认回复，不承载敏感配置。
- 发送前校验会话、来源消息和草稿版本；结果不明时进入 SEND_UNKNOWN 且禁止重试。
- 敏感正文 AES-256-GCM 本地加密，30 天后清除。

## 允许修改范围

- `src/main/java/com/getjobs/application/**`
- `src/main/resources/db/migration/**`
- `src/test/**`
- `chrome-extension/**`
- 本任务文件及必要说明文档

## 禁止修改范围

- 不修改全局 OpenCLI 安装包、OpenAI Provider/登录认证、现有用户数据、现有迁移内容。
- 不执行真实 BOSS 回复、QQ 消息、验证码绕过、PR 合并、强推或历史重写。
- 不把 Cookie、Token、QQ号、密钥或 `.env` 内容写入仓库。

## 已确定实现要求

- OpenCLI 会话名固定为 `boss-hr`；当前 BOSS 适配器 `chatlist/chatmsg --side geek` 用于结构化读取，求职者端发送使用 DOM 选择、`fill #chat-input`、`keys Enter` 和发送后回读确认。
- 未读筛选以聊天项头像旁红色数字为主，顶部 `未读(n)` 为一致性校验；DOM 映射不唯一时失败关闭。
- 状态机：`OBSERVED -> GENERATING -> REVIEW_REQUIRED -> APPROVED -> SENDING -> SENT_CONFIRMED | SEND_UNKNOWN | BLOCKED | SKIPPED | EXPIRED`。
- QQ 使用 NapCat 本机 WebSocket、Token 和严格白名单；通知目标类型支持 `PRIVATE`/`GROUP`，目标 QQ/群号及可选操作人 QQ 均由运行时加密保存，不写死在代码中。
- 私聊模式只接受目标 QQ 的命令；群聊模式必须同时匹配目标群号和已配置的操作人 QQ。群聊未配置操作人时仅发送通知，不执行任何群命令。
- 支持 `发送/修改/跳过/详情 + 4位确认码`，确认码 15 分钟失效；群命令的执行结果私聊返回操作人，避免在群内扩散 HR 详情。
- 高价值分类才通知 QQ；图片、语音、附件和可疑内容转人工。

## 验收标准

- 60 秒调度单实例运行，静止页面不重复建草稿，16 个未读可一次入队。
- 未经逐条确认没有任何发送路径；新 HR 消息或草稿变更使旧确认失效。
- 发送成功必须有 OpenCLI 动作结果和聊天回读双证据；不明结果不重试。
- 非授权 QQ、错误群聊、错误操作人、重复/过期指令被拒绝；全自动入口不可启用。
- 工作台保存 HR 设置必须继续使用本地动作令牌；切换人物档案时重新加载对应设置，并阻止未保存内容被静默覆盖。
- 开始值守前必须释放 OpenCLI 持久化的旧自有会话，再绑定当前 BOSS 聊天标签；启动失败原因必须保留在页面面板中供用户处理。
- 数据库不存在聊天正文、草稿、QQ Token 的明文，30 天清理可验证。

## 测试命令

```powershell
./gradlew test --no-daemon --stacktrace
node scripts/validate-chrome-extension.mjs
$extensionTests = Get-ChildItem chrome-extension/tests -Filter '*.test.cjs' | ForEach-Object { $_.FullName }
node --test $extensionTests
cd front
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

## 返回格式

- 改动文件与行为摘要
- 测试、构建和范围检查的准确结果
- Git 分支、提交 SHA、Push/PR/CI 状态
- 未执行的真人 BOSS/QQ 验收和明确后续步骤
