# BOSS AI 托管与 QQ 决策

## 用户确认的边界

AI 根据简历及已确认事实回答并追问岗位职责、地点、待遇。薪资表达为期望 15–20K、结合职责面议，不设城市或薪资硬底线，不自动拒绝。优先电话面试，到岗统一为确认 Offer 后两周内。对方索要时可提供已配置电话和指定 PDF 简历。

具体面试时间、接受 Offer 或合同、薪资让步、付费、证件或银行卡、微信及其他文件、未知或相互矛盾的个人事实、读取不完整的内容，交给用户在 QQ 决策。QQ 补充默认只用于当前会话；“记住 内容”之后必须原文“确认记住 内容”才持久保存到当前人物档案。

## 实现

- V18 增量迁移保存托管授权版本、设置指纹、原始上下文和媒体、发送决策依据、持久 QQ 通知队列，敏感正文沿用本机加密。原有消息及发送历史保留。
- 草稿生成和发送审核分离。独立审核整轮提问、全部拟发送内容及来自可信简历/沟通资料的原文证据；个人事实逐句比对已确认原文，规则文本不充当经历证据；无法对应的改写转人工。不能只因 AI confidence 高而自动发送。设置、授权、来源消息或草稿改变后重新核验。
- 首轮建立历史基线，只整理不补发；之后每分钟检查新消息，每半小时核对列表变化，只读取变化会话。后台闹钟负责扫描及发送，不依赖面板显示或轮询。
- 专用标签使用 `getjobs-autopilot=1` 标记。浏览器侧串行锁、后端租约和发送前授权检查共同约束动作；手动点击、输入或滚动立即让位，需明确恢复；暂停保留在专用标签的会话存储中，页面重载仍生效。恢复后的待发送内容须再次采集并比对完整本轮和授权。停止后不再领取/执行新动作，已触发动作只回报证据。
- 聊天标签禁止通用岗位扫描恢复及导航；浮窗按记录更新，保留未保存文字、焦点和阅读位置。V2 HR 消息类型隔离旧版内容脚本。
- 图片识别、PDF/DOCX 解析沿用现有配置；原件和读取状态一起展示。语音原件可播放及转发，但现有 AI 接口未声明语音转写能力，因此自动转人工。无法取得原件、不支持格式、模糊或不完整解析不得自动答。
- QQ 仅推送人工决策及需人工处理的异常，支持详情分页、发送、修改、跳过、补充、明确记住、暂停、恢复。所有操作限制在配置的群和唯一操作人，结果回同一群。
- QQ 通知分段保留完整文字，图片/语音/PDF/DOCX 以原始媒体消息段发送。先持久化 UNKNOWN 再写 WebSocket，收到成功状态及 message_id 才确认；断线前未写出的 PENDING 可继续发送，UNKNOWN 不自动重发。

## 启用前核对

1. 停止旧值守，等待进行中的发送回报结果。备份共享数据库并验证完整性；只切换既有 Backend 服务，不影响其他项目。
2. 新版扩展为 1.6.6，HR 协议为 `2026-09-07-hr-autopilot`。服务与扩展必须配套更新；不得用反复刷新页面测试。
3. 在工作台填写实际的 QQ 群操作人，保存设置。选择允许发送的 PDF 文件，核对规则并确认授权。文件仅在本地计算 SHA-256；BOSS 必须已上传并选中同一文件。
4. 在 BOSS 浮窗点击“打开专用托管标签”，核对账号后手动开始值守。不要把人物档案标签当作 BOSS 登录账号切换。
5. 第一轮只建立历史基线。使用受控新消息逐类验收，再进入正常托管。未确认送达的通知、正文或简历不能标记发送成功。

### 简历与媒体的实际限制

简历发送只有在页面提供唯一、已选中附件的可读原件，且文件名和 SHA-256 均吻合时才尝试。无法核验会进入人工处理；不会猜测默认简历或盲点通用确认按钮。发送后须出现新增的指定本人附件消息，否则保留未知结果。真实 BOSS 页面兼容性必须单独验收，离线测试不能证明线上发送成功。

历史过长、无法取得本轮及前一完整交互（或明确的历史起点）、媒体来源受限、附件超过 6MB 或一轮媒体超过 12MB，均明确标记无法完整读取。不会从后端跟随 HR 提供的任意链接下载。语音不自动切换到其他模型或服务商。

## 验证与回滚

检查入口：`gradlew.bat --no-daemon test bootJar`；`node --test chrome-extension/tests/*.test.cjs`；`node scripts/validate-chrome-extension.mjs`；front 中 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build:prod`。新增测试覆盖授权边界、历史基线、资料证据、设置变化、旧确认码、媒体读取失败、QQ 回执、重复闹钟、人工暂停、岗位导航隔离和面板输入保持。

回滚先停止托管并等待已领取命令结果，再 revert 本任务提交或恢复原服务/扩展版本。V18 是增量结构，回退旧程序可保留新增表列；不得恢复旧数据库覆盖新消息，不得清除 SEND_UNKNOWN 或重发已触发动作。PR 不自动合并，真实部署和启用需最终核对。

## 协议依据

媒体消息采用 NapCat 官方的 [消息格式](https://napneko.github.io/develop/msg) 和 [资源 URL 规范](https://napneko.github.io/onebot/napcat)，使用 text/image/record/file 消息段及 base64 资源。普通文字放入 text 段，防止 HR 原文中的 CQ 字符串变成执行型消息段。

## 本次文件清单

- `chrome-extension/background.js`
- `chrome-extension/boss-content.js`
- `chrome-extension/boss-hr-assistant.js`
- `chrome-extension/boss-hr-bridge.js`
- `chrome-extension/boss-hr-support.js`
- `chrome-extension/manifest.json`
- `chrome-extension/tests/background-tab-routing.test.cjs`
- `chrome-extension/tests/boss-hr-assistant.test.cjs`
- `chrome-extension/tests/manifest-id.test.cjs`
- `chrome-extension/tests/profile-scoped-scan-contract.test.cjs`
- `front/app/env-config/HrAssistantSettingsCard.test.tsx`
- `front/app/env-config/HrAssistantSettingsCard.tsx`
- `front/app/env-config/HrAutopilotSettings.tsx`
- `front/lib/boss-hr-dom.test.ts`
- `front/lib/boss-hr-guard.test.ts`
- `front/lib/boss-hr-panel.test.ts`
- `src/main/java/com/getjobs/application/controller/HrAssistantController.java`
- `src/main/java/com/getjobs/application/hr/HrAssistantTypes.java`
- `src/main/java/com/getjobs/application/service/AiService.java`
- `src/main/java/com/getjobs/application/service/HrAssistantStore.java`
- `src/main/java/com/getjobs/application/service/HrAssistantWatchService.java`
- `src/main/java/com/getjobs/application/service/HrAutopilotService.java`
- `src/main/java/com/getjobs/application/service/HrAutopilotStore.java`
- `src/main/java/com/getjobs/application/service/HrMediaService.java`
- `src/main/java/com/getjobs/application/service/HrReplyActionService.java`
- `src/main/java/com/getjobs/application/service/HrReplyDraftService.java`
- `src/main/java/com/getjobs/application/service/NapCatGateway.java`
- `src/main/resources/db/migration/V18__add_hr_autopilot.sql`
- `src/test/java/com/getjobs/application/service/HrAutopilotTest.java`
- `src/test/java/com/getjobs/application/service/HrMediaServiceTest.java`
- `src/test/java/com/getjobs/application/service/NapCatGatewayTest.java`
- `tasks/2026-09-07-boss-hr-autopilot.md`

## 本地验证结果（2026-09-07）

- 后端 `gradlew.bat --no-daemon test bootJar` 成功：359 个测试，355 通过、4 跳过、0 失败。
- 扩展 116 个测试全部通过；Manifest 的 19 个引用和 15 个 JS 文件校验通过。
- 前端 23 个测试文件、72 个测试通过；typecheck 通过；lint 0 error、30 个既有 warning；生产构建及静态文件复制通过。
- 在全新临时 SQLite、临时密钥和 127.0.0.1:6867 运行 JAR，应用 V18 增量迁移，创建合成档案后验证 readiness、HR status/settings/autopilot/deliveries/proposals 接口。未连接真实 BOSS、NapCat 或 AI；测试进程结束后关闭。
- 原项目和当前服务目录保持干净。本任务没有部署、修改现有值守、启用托管或发送 HR/QQ 消息。首次真实读取、AI 能力及附件发送必须在备份后受控验收。

PR 承接现有 #51 的分支 `codex/fix-zhilian-analysis-login-20260907`，只审阅本任务差异；依赖分支尚未合并，不能跳过依赖直接合入稳定分支。所有 PR 均需用户确认，不自动合并。
