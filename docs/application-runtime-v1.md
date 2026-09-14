# Application Runtime v1：入口与确认协议

## 当前交付边界

本文记录 P0.1 的协议、安全入口与确认快照。后续 P0.3–P0.5 已补持久执行领取、Page State / Evidence 和受控 Recovery；详见 [升级实施记录](job-agent-upgrade-progress.md)。单独校验确认记录仍不等于原子执行许可，新 Runtime 仍需真实网站门禁。

| 平台 | 推荐采集/分析入口 | 投递 | Legacy |
| --- | --- | --- | --- |
| BOSS | Chrome → `/api/boss/chrome/jobs` → SQLite AI 队列 | 人工预览确认 → Extension | `/start`、`/execute` 保持 410；Playwright 登录/调试代码保留 |
| 智联 | Chrome → `/api/zhilian/chrome/jobs` → SQLite AI 队列 | 人工预览确认 → Extension | `/api/zhilian/start` 是主动调用的扫描/同步分析，返回 `PLAYWRIGHT_LEGACY`；绝不作为自动 fallback |
| 猎聘 | 实验性 Playwright | 原显式 delivery mode + confirmation header | 统一持久分析入口不支持，返回 409 |
| 51job | 实验性 Playwright | 原显式 delivery mode + confirmation header | 统一持久分析入口不支持，返回 409 |

后端 `PlatformAdapter.scan` 是保存岗位的查询接口，不代表浏览器采集能力。这里不删除旧 Worker，不新增平台。

## 会话边界

统一 `/api/cookie`、`/api/cookie/save` 和三个平台 `/cookie`、`/save-cookie` 兼容路由返回 410 / `BROWSER_SESSION_ONLY`，不会初始化浏览器或访问 Cookie 存储。CookieService 的历史读、写、清除、删除入口拒绝调用；启动种子初始化为无操作。

登录监测不再提取 `context.cookies()`，平台启动不再从数据库注入。旧文件导入/导出同样停用。退出旧浏览器仅清理其浏览器会话，不清除数据库历史记录。Chrome 主链始终使用用户浏览器会话。

Legacy 延迟启动浏览器；保留明确配置的 `app.browser.user-data-dir`，未配置时使用用户目录 `.ai-jobpilot/legacy-browser`。这个独立目录由浏览器管理，不是 Cookie 导出文件，禁止提交/上传。原来依赖数据库 Cookie 的用户需手工登录一次。未验证真实登录前不能显示“已迁移登录态”。

## Wire contract

- P0.1 发布时扩展为 1.8.8；当前代码版本以 manifest 为准（1.8.12，background `2026-09-14-runtime-adapters`）。实际 Chrome 加载版本需单独核验。
- 握手附带 `runtimeProtocol=application-runtime/1`。前端在扫描、预检和投递前检查版本；停止命令不受升级检查阻挡。
- 每次明确派发产生 `runId`、`runtimeSessionId`、`correlationId`；不会持久恢复或自动续投。这些是诊断标识，不构成用户授权。
- 投递任务复用 `id`（岗位行）、`profileId`、`requestKey`、`url`、`greeting` 和 `reconciliationOnly`。拒绝空批次、跨平台/跨档案、重复请求和重复岗位。
- 扩展复制并冻结批次和各任务，不会纳入后来扫描到的岗位或改变确认话术。
- 打开招聘标签前校验整批；每个岗位导航前再次通过带本地操作令牌的 `/api/delivery-attempts/{requestKey}/validate-dispatch` 核对当前档案、最新 Attempt、稳定岗位键、链接和话术快照。接口只读、不创建 Attempt、不改变结果。
- 普通执行仅接受 REQUESTED；UNKNOWN 只能 `reconciliationOnly=true`。FAILED 必须走已有人工恢复生成新 Attempt；CONFIRMED 不再执行。
- 校验拒绝、超时或版本不兼容时，停止派发且不伪造平台失败。回调重试仍使用同一 requestKey，不重放页面操作。

`application-runtime-protocol.js` 声明页面类型、阻碍、Action、终态与错误词汇。暂不强行替换平台 Detector：PAGE 与 Action 的实现将在对应平台 Fixture 固定之后逐轮接入。后端终态保持 `CONFIRMED / FAILED / UNKNOWN`。

## 测试与手工验收

自动化全部使用 Mock、合成任务与临时 SQLite，不访问招聘账号或调用 AI：

1. `node --test chrome-extension/tests/*.test.cjs`：固定批次、协议/档案拒绝、确认拒绝不导航、既有投递停止/UNKNOWN 行为。
2. `node scripts/validate-chrome-extension.mjs`。
3. `./gradlew test`：Cookie 存储零调用、平台别名 410、能力一致性、真实临时 DB 快照核对及现有迁移/CAS。
4. 在 `front` 下执行 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`。

发布到已有 6866 服务后，先检查 readiness、版本、静态资源、Cookie 410 与能力 API。用户在 `chrome://extensions` 重新加载扩展 1.8.8，再刷新工作台和招聘页面；检查扩展连接、扫描停止按钮与配置保存。旧实验平台的手工登录属于单独的只读验收，本轮不自动打开账号。

本轮不需要真实投递。后续真实 Smoke 必须由用户针对岗位主动确认。

## Migration / Rollback

无 Schema 变更；不读取或清理历史 Cookie 内容。回退保留业务数据库，不能用旧库覆盖发布后事实。协议前后端/扩展必须匹配；普通回滚不能重新启用 Cookie 存储。协议异常时保留停止和只读对账入口，前滚修复。
