# P0.5 智联接入共享执行协议

复用 V21；无新 migration。BOSS/智联分别由 `application.runtime.boss-enabled`、`application.runtime.zhilian-enabled` 控制，默认关闭。停用不能重放已领取或可能执行的旧请求。真实网站单条 Smoke 未完成前不能宣告平台切换验收。

## 共享部分

`browser-application-runtime.js` 负责已确认任务领取、一次性许可、工作台存活检查及许可返回后的页面复核。后端仍是 Attempt/领取/暂停的事实源。BOSS、智联都调用同一 `claim / beforeEffect`，同一结果观察与回调机制；不复制一份恢复状态机。

`DeliveryRuntimeService` 按平台核对现有岗位表与稳定 ID，独立检查发布开关；同一 Attempt 只能有一个执行者。许可通信不自动重试，UNKNOWN 只核对，暂停跨重启保留。观察记录区分 ALREADY_APPLIED/ALREADY_CONTACTED 与本次效果，不能凭观察自行修改业务终态。

## 平台独有部分

- `zhilian-modern-collector.js` 的纯解析、节点替换、详情一致性与有限重取保持不变。
- `zhilian-page-evidence.js` 复用原精确状态标签和对话框文本判定；页面状态结合原 `buildPageBlockDiagnostics`，不共享 BOSS Selector。
- 登录/验证、投递额度用尽、岗位失效优先于旧“已申请”按钮；补齐明确“请先登录”的识别。
- “继续沟通/已申请”若在操作前观察到，跳过点击并标记 ALREADY_APPLIED；不能作为新增投递量。
- 收藏同样跨副作用边界，必须先获取许可。普通详情加载不完整不能获取许可。
- 原 `/api/zhilian/start` 和 Playwright 兼容代码继续保留，不作为 Chrome 异常时的自动回退；没有真实调用清零与网站验收证据前不删除。

## 验证与部署

扩展 1.8.12：background `2026-09-14-runtime-adapters`，BOSS content `2026-09-14-boss-adapter`，智联 content `2026-09-14-zhilian-adapter`。manifest 与动态注入同时加载共享 Runtime 和平台 Evidence，无新增权限。

测试使用合成 Fixture、Mock Chrome 与临时 SQLite：双平台共享许可、并发/重启/暂停、岗位身份、缺失协议字段、关闭工作台、许可返回时页面变化；实际 content 入口在拒绝时零点击、获许可后才达到首个收藏点击。保持原 Parser、扩展和前端回归。

正式验证仍需用户主动选择单个岗位、检查话术/简历后确认投递，并核对平台结果、requestKey、Evidence 与恢复列表。未运行真实账号和收费 AI。回退关闭对应平台开关，保留 V21 与事件；未决请求只读对账，不能换旧库或自动重发。
