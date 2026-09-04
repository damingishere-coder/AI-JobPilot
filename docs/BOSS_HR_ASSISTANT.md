# BOSS HR 半自动回复助手

这个功能只在你主动点击 BOSS 聊天页右下角的“开始值守”后运行。它每 60 秒检查一次“未读”选项卡和 HR 头像红点，生成草稿后等待你确认；不会后台全自动发送。

## 首次准备

1. 保持 AI-JobPilot 后端运行，并在 Chrome 中登录 BOSS，打开 `https://www.zhipin.com/web/geek/chat`。
2. 安装并启用 OpenCLI Browser Bridge，运行 `opencli doctor`，确认 Browser Bridge 与 Connectivity 都通过。
3. 在 `chrome://extensions` 重新加载本项目 `chrome-extension` 目录，然后刷新 BOSS 聊天页。
4. 如需 QQ 通知，启动 NapCat，在 OneBot 网络配置中新增 WebSocket 服务端：
   - 地址只用 `127.0.0.1`
   - 建议端口 `3001`
   - 设置独立 Token
   - 关闭 `reportSelfMessage`
5. 在 BOSS 页面右下角“沟通资料与 QQ 通知”中选择“私人 QQ”或“指定群聊”，填写真实资料。Token、目标 QQ/群号和操作人 QQ 不会在读取接口中明文返回。

## 使用方法

- 点击“开始值守”时，当前 Chrome 标签页必须是 BOSS 求职者聊天页；OpenCLI 会绑定这个现有标签页，不会新开自动化浏览器。
- 页面出现待确认草稿后，可以修改并保存、确认发送或跳过。编辑后的内容必须先保存，页面才会重新开放“确认发送”，避免确认文本与实际发送文本不一致。
- 高价值消息可以通知到指定私人 QQ 或指定群聊。私人 QQ 模式下，只有该 QQ 发来的命令会被接受：
  - `详情 1234`
  - `修改 1234 新的回复内容`
  - `发送 1234`
  - `跳过 1234`
- 群聊模式需要同时配置目标群号和“群内操作人 QQ”才能在群里执行上述命令；系统必须同时核对群号和发言人 QQ。操作结果会私聊返回操作人，避免在群里继续展示 HR 详情。
- 群聊模式不填写操作人 QQ 时是“仅通知”模式：群成员发出的任何命令都不会执行，请回 BOSS 页面处理。
- 确认码 15 分钟后失效；HR 新发消息或草稿版本变化后，旧确认也会失效。

## 安全边界

- 求职者端不调用 OpenCLI 现有的 `boss send`，因为该命令当前只实现招聘者端；本项目使用 DOM 选择器定位当前会话、填写 `#chat-input`、按 Enter，并再次读取聊天历史确认。
- 任何会话映射不唯一、验证码、登录失效、风控、页面结构变化或发送证据不完整都会停止处理。
- `SEND_UNKNOWN` 表示可能已经发出，系统不会重试。
- 聊天正文、草稿、确认码、HR/公司/岗位、外部 UID、QQ Token、目标 QQ/群号和操作人 QQ 使用 AES-256-GCM 加密；用于去重和定位的索引采用密钥化 HMAC。30 天后会删除消息正文并擦除旧会话身份、草稿、确认码和发送证据，只保留分类、状态、置信度等匿名统计。
- BOSS 对未经授权插件、自动获取及自动操作有限制。启用前请自行确认账号和平台风险，程序不会绕过验证码或风控。

首次真人验收只做“发现未读 → 生成草稿 → 页面/QQ 展示”。只有你针对某一条任务再次确认“发送”后，才执行那一条回复。可同时参考 [BOSS 用户协议](https://www.zhipin.com/web/common/protocol/protocol-2019-09-30.html)、[NapCat 网络配置](https://napneko.github.io/onebot/network) 与 [OneBot API](https://napneko.github.io/onebot/api)。

## 本地配置项

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `APP_HR_OPENCLI_EXECUTABLE` | 自动发现 `opencli.ps1`/`opencli` | OpenCLI 路径 |
| `APP_HR_OPENCLI_SESSION` | `boss-hr` | 持久浏览器会话名 |
| `APP_HR_OPENCLI_TIMEOUT_SECONDS` | `30` | 单条命令超时 |
| `APP_HR_SCAN_INTERVAL_MS` | `60000` | 扫描间隔；代码强制不低于 60 秒 |
| `APP_HR_MAX_CONVERSATIONS_PER_SCAN` | `100` | 单轮安全上限 |
| `APP_HR_KEY_PATH` | `%LOCALAPPDATA%\AI-JobPilot\secrets\hr-chat.key` | 加密密钥路径 |

不要把密钥、Token、Cookie、QQ 号或群号写入仓库或公开截图。
