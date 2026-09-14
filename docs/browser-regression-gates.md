# P0.6 离线 Chromium 回归与发布门禁

## 自动化范围

复用现有 Java Playwright 1.51 和 JUnit，不增加运行时依赖或生产权限。通过独立 `browserRegressionTest` 任务运行；普通 `test` 不启动浏览器。

Windows：

```powershell
.\gradlew.bat installRegressionBrowser
.\gradlew.bat browserRegressionTest
```

Linux CI 使用 `installRegressionBrowser -PwithBrowserDeps` 安装 Chromium 系统依赖。CI 在 Windows/Linux 两个系统分别运行。

测试复制生产扩展到 JUnit 临时目录，使用全新 Chromium 资料目录。生产 manifest 保持原样；临时副本在 background 启动前禁止 fetch，页面网络默认全部拦截。HTML 来自合成 Fixture；唯一网络例外是单项测试创建的随机回环端口，连接该测试的临时 SQLite。不会访问 6866 服务、招聘站点、账号、Cookie 或 AI Provider。测试中的 localhost 工作台 URL 完全由路由离线响应。

已覆盖：

- 真实 Chromium 布局中隐藏成功提示不算成功；额度阻碍覆盖旧成功文字。
- BOSS 固定弹窗不依赖 offsetParent，阻断副作用许可。
- 页面重载后真实 content scripts 重新注入；只读核对不调用 begin。
- 主动停止 MV3 service worker 后，实际 page-bridge → background 握手恢复，不启动投递标签页。
- 扩展 Runtime → HTTP → 真实 DeliveryRuntimeService / DeliveryAttemptService → 全量 Flyway 初始化的临时 SQLite：许可至多一次、UNKNOWN 重复回调幂等、重建服务后拒绝重发。

最后一项的 HTTP 是测试服务封装，尚不等于 Spring Controller、Token、完整采集与 Mock AI 的全链 E2E；相关边界仍由现有 Java/扩展 Contract Test 覆盖。合成 Fixture 也不代表当前招聘页面已经验收。

## 真实网站门禁（当前待完成）

每个平台独立记录以下信息，不保存正文、个人身份或凭据：日期、应用 commit、扩展实际加载版本、平台、Fixture 类型、requestKey、结果/evidence、是否通过。

1. 用户主动打开平台，处理登录及验证；少量采集并核对岗位身份。
2. 检查分析入库与确认预览；真实 AI 调用按用户正常使用操作，不作为自动化测试。
3. 用户指定并确认一个岗位后，执行一次；核对平台证据与数据库 Attempt。
4. 已有 UNKNOWN 仅核对，不重复投递；刷新工作台核对时间线。
5. 明确记录 PASS / FAIL / 未执行；仅“已更新扩展”不等于投递 Smoke 通过。

BOSS、智联 runtime 开关均保持默认关闭，直到对应平台的受控验收完成。不得用离线测试通过替代真实网站验收，也不得据此删除 Legacy。

## 回退

本轮无生产迁移/业务变更；可独立回退测试与 CI 提交。P0.4/P0.5 的安全许可和旧事实保留，不因测试基础设施回退而弱化。
