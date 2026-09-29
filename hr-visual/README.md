# BOSS 本机视觉执行器

该执行器使用现有 Google Chrome 登录窗口，以 Windows UI Automation 读取控件、Windows OCR 核对可见正文，再通过鼠标键盘输入。没有 CDP、DOM 注入、浏览器配置复制、Cookie 导出或自动刷新。后端仍使用现有模型配置与 NapCat QQ 通道。

## 安装与运行

在已有 6866 服务的运行目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File hr-visual/setup.ps1 -Python C:\Python312\python.exe
hr-visual/.venv/Scripts/python.exe -u hr-visual/worker.py --health
```

需要 Windows 交互桌面、中文 OCR、已登录的 Chrome。独立 `.venv` 不改动群报环境。执行时持有与群报一致的 `Local\GroupBrief.WechatDesktopSender` 互斥锁。检测到真人鼠标键盘输入、焦点变化、锁屏或网站验证时停止输入。

工作台“本机 Chrome 视觉聊天”选择三个已有会话，核对登录姓名后点击“读取并发送 QQ 建议卡”。档案名与 BOSS 登录姓名不同时需明确勾选本人绑定。普通入口只生成待确认卡；QQ 的详情、修改、发送、跳过、补充、暂停、恢复沿用原操作人及群校验。

`POST /api/hr-assistant/visual/start` 使用现有本机操作令牌，协议为 `2026-09-29-hr-visual-v1`。仅接受三个不同的已有提案及匹配版本。普通请求的 `approved=false`。明确批准的受控测试可传 `approved=true, approvalSource="USER_CONFIRMED_TEST"` 及本次批准的完整正文；原卡缺岗位时还需 `expectedJobName`，原生简历还需 `sendResume=true, resumeSharingConfirmed=true`。这些值作为本次目标的加密授权种子保存，不修改长期授权，消息正文、类型或时间变化即失效。

`GET /api/hr-assistant/visual/status` 返回安装状态、模式、当前运行、阻塞原因和文字/原生简历各自状态。暂停/恢复使用带本机令牌的 `POST /visual/{runId}/pause|resume`。未启用自动托管也可独立暂停视觉测试。

## 发送约束和证据

- 三个会话均先只读核对，再领取发送步骤。核对当前选中行的姓名与公司、正文姓名、实际岗位、完整待回复消息轮；视觉定位成功后才关联原平台会话，不生成假的平台 ID。
- 切换后等待 3 秒，有界等待稳定正文最多 20 秒。可见且完整的上一条本人消息界定本轮上下文；被截断的待回复消息、无法辨别的媒体、空白正文会阻塞。平台竞争分析推广卡不作为 HR 发言；简历请求卡中的“同意/拒绝”控件不作为消息原文。
- 精确完整的 UIA 文本用于事实与发送回执比对。OCR只辅助确认正文可见，支持高 DPI 下的气泡范围复核；短消息须完整识别，长消息需高字符覆盖，不能用匹配前几个字替代发送回执。
- 私有 stdin/stdout 子进程协议分为准备、后端再次授权、单次提交、回执。输入已有草稿时停止。文字换行使用 Ctrl+Enter，普通 Enter 不用于输入正文。
- 原生简历不上传本地文件。只有一个可核验的简历文件时才能确认选择弹窗，确认前再次比对聊天。多个文件或名称无法读取时交本人选择，不猜测。
- 每个步骤至少间隔 5 秒，完成时间持久化。提交后等待匹配新增本人消息最多 15 秒；点击成功、输入框清空、旧消息均不算成功。未知状态不自动重试。文字已成功而简历未成功时保留两步结果。
- 截图只保存本次正文范围，使用当前 Windows 用户的 DPAPI 加密，位于 `APP_DATA_DIR/hr-visual-evidence`；步骤证据在数据库中加密保存。不要提交截图、运行记录、密钥或真实聊天数据。
- 过期且已停止的运行按现有资料保留天数清理正文副本及截图；步骤状态、时间和未知结果仍保留，不恢复为待发任务。

## 测试、部署和回滚

```powershell
hr-visual/.venv/Scripts/python.exe -m unittest discover -s hr-visual/tests -v
./gradlew.bat test bootJar
# front 目录：pnpm typecheck；pnpm lint；pnpm test；pnpm build:prod
# chrome-extension/tests 下的 node:test 兼容测试
```

部署沿用原 RunDock Backend、6866 端口和运行目录。先使用 SQLite Online Backup 备份实际数据库并备份配置、密钥；在原运行目录更新已合并版本，安装独立环境，停止再启动同一服务记录。V30 只增列和新表，保留原消息/发送记录。升级不会自动创建视觉 run 或开启自动值班。

回滚先暂停视觉任务，核验已触发步骤，再恢复程序版本。保留 V30 表、消息、发送步骤及未知结果；不要用旧数据库覆盖新数据，也不要手工把未知结果改为待发送。回滚程序若不识别较新的 Flyway 版本，需提供兼容补丁而非删除迁移记录。

真实验收须分别证明三条文字及指定会话简历新增本人记录；构建通过、HTTP 200、QQ“已排队”都不是发送完成。未收到 HR 后续回复时只能报告发送验收和合成往返测试。

设计参考：[Airtest](https://github.com/AirtestProject/Airtest) 的图像定位与结果断言、[BOSS automation.py](https://github.com/as161233574-alt/boss-zhipin-bot/blob/main/boss_app/services/automation.py) 的聊天交互流程。没有复制第三方代码或引入其账号、远程控制服务。
