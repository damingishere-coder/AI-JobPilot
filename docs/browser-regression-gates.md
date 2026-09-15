# P0.6 离线 Chromium 回归与发布门禁

## 自动化范围

复用现有 Java Playwright 1.51 和 JUnit，不增加运行时依赖或生产权限。通过独立 `browserRegressionTest` 任务运行；普通 `test` 不启动浏览器。

Windows：

```powershell
pnpm --dir front build
.\gradlew.bat installRegressionBrowser
.\gradlew.bat browserRegressionTest
```

Linux CI 使用 `installRegressionBrowser -PwithBrowserDeps` 安装 Chromium 系统依赖。CI 在 Windows/Linux 两个系统分别运行，并下载同一提交的 Frontend Job 构建产物；缺少实际 Next.js 产物时测试失败，不退回简化页面。

测试复制生产扩展到 JUnit 临时目录，使用全新 Chromium 资料目录。生产 manifest 保持原样；临时副本在 background 启动前禁止 fetch，页面网络默认全部拦截。HTML 来自合成 Fixture；唯一网络例外是单项测试创建的随机回环端口，连接该测试的临时 SQLite。不会访问 6866 服务、招聘站点、账号、Cookie 或 AI Provider。测试中的 localhost 工作台 URL 完全由路由离线响应。

已覆盖：

- 真实 Chromium 布局中隐藏成功提示不算成功；额度阻碍覆盖旧成功文字。
- BOSS 固定弹窗不依赖 offsetParent，阻断副作用许可。
- 页面重载后真实 content scripts 重新注入；只读核对不调用 begin。
- 主动停止 MV3 service worker 后，实际 page-bridge → background 握手恢复，不启动投递标签页。
- 扩展 Runtime → HTTP → 真实 DeliveryRuntimeService / DeliveryAttemptService → 全量 Flyway 初始化的临时 SQLite：许可至多一次、UNKNOWN 重复回调幂等、重建服务后拒绝重发。

新增 `FullPipelineBrowserRegressionTest` 接通真实 Spring Boot 随机端口、Controller、Token、持久 AI 队列及全量迁移后的临时 SQLite：

- BOSS 生产 Parser 从合成页面采集，通过真实 background 的 `chrome-jobs` 消息入库；只有 AI Provider 是 Mockito，执行一次。
- 采集请求即使携带旧 `autoDeliver=true` 也不会生成 Attempt；错误话术快照被拒绝。构建后的实际 Next.js 分析页打开话术弹窗，取消不产生请求，点击“确认并交给 Chrome”后通过真实确认 API 产生一次请求。
- 实际 chromeBridge / page-bridge 派发用户确认任务并附加关联标识；真实扩展 Runtime 领取、background 转发 begin、模拟平台副作用、生产 Detector / Evidence、真实结果 Controller、Attempt / Opportunity 事务事件贯通。
- 跨副作用边界后重复 begin、页面刷新均不能再次操作；迟到 callback 和重复 callback 只落一份确认事实，重采集不重复调用 AI；真实确认页收到结果并刷新后不再显示待确认岗位。
- 已知扩展的确认快照校验 / Runtime CORS 与操作令牌同时验证；未知扩展和招聘网页仍被拒绝，扩展不能自行调用用户确认接口。

新测试仅在临时扩展副本中将 6866 替换为测试随机端口，worker fetch 只允许这个精确回环 origin；页面网络默认拒绝，招聘 URL 仅由 Fixture 路由返回。测试响应中的前端 JS 也仅替换允许的回环 origin；源文件与构建产物不改写。Spring 的前端探测配置被 Mock，避免启动时探测正式 6866。临时消息钩子拦截平台预检/动作，并调用生产 background 的 `validateConfirmedTask` / `claimRuntimeTask`，不模拟它们的实现；该钩子不进入生产包。生产权限和端口不变。测试发现并修复了确认快照校验和 Runtime 路径缺少扩展 CORS 规则造成的真实 403。回归调用 `AiService` / `CodexCliService` 的 Mock，不会调用收费模型。

边界：Next.js 实际确认组件与页面桥在 Chromium 中运行；平台预检由测试钩子返回，副作用仍是合成 DOM 变化。这里不宣称真实招聘网站、实际平台点击或真人投递已经通过。已有五项 Chromium/MV3 回归继续保留。

## 真实网站门禁（当前待完成）

每个平台独立记录以下信息，不保存正文、个人身份或凭据：日期、应用 commit、扩展实际加载版本、平台、Fixture 类型、requestKey、结果/evidence、是否通过。

1. 用户主动打开平台，处理登录及验证；少量采集并核对岗位身份。
2. 检查分析入库与确认预览；真实 AI 调用按用户正常使用操作，不作为自动化测试。
3. 用户指定并确认一个岗位后，执行一次；核对平台证据与数据库 Attempt。
4. 已有 UNKNOWN 仅核对，不重复投递；刷新工作台核对时间线。
5. 明确记录 PASS / FAIL / 未执行；仅“已更新扩展”不等于投递 Smoke 通过。

BOSS、智联 runtime 开关均保持默认关闭，直到对应平台的受控验收完成。不得用离线测试通过替代真实网站验收，也不得据此删除 Legacy。

## 回退

本轮无生产迁移；测试可独立回退。CORS 修复仅允许已知扩展访问 Runtime 路径，仍需操作令牌及执行身份校验；若回退该修复，新 Runtime 将再次被 403 阻止，不能绕过许可继续投递。P0.4/P0.5 的安全许可和旧事实保留。
