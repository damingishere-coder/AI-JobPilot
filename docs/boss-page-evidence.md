# P0.3：BOSS 页面观察与投递证据

`boss-page-evidence.js` 是只读模块，输出页面类型、阻碍、平台子状态、岗位键、观察时间和版本；不返回正文、聊天、完整 URL、Cookie 或 Token。Manifest 和按需注入列表使用相同模块。

保留旧 `pageState` 与 evidence 字符串，同时在页面状态响应增加 `runtimePage`，投递结果增加 `evidenceDetails`。结构化数据目前用于扩展结果诊断，P0.4 才接入持久 Runtime Event；后端仍以原有 requestKey、白名单 evidence、话术结果与 CAS 接受结果。

现有话术计数逻辑整体移入只读模块，保留原有 DOM 语义：排除发送中/失败、核对本人消息正文、弹窗消息额外要求消息 ID 与成功状态。没有为了统一而替换 Selector，也没有对已有全聊天页额外猜测新的发送状态标记。旧入口函数作为委托保留，测试直接加载新模块，不再截取该计数函数源码。

新增安全优先级：执行前的登录、验证、额度耗尽、岗位失效与错误阻止点击；发送后出现这些阻碍则保持 UNKNOWN。已有联系为 `ALREADY_CONTACTED`，`newApplication=false`；进入聊天、相同消息计数或缺证据都不能算本次新增成功。恢复与重试未在本轮修改。

测试包括原有固定弹窗/精确话术用例、外部详情样本、剩余额度和用尽区分、隐藏弹窗、登录优先级，以及加载完整 content script 后验证“登录覆盖旧沟通时点击次数为零”。jsdom 布局前提不替代 P0.6 的真实浏览器门禁。

本轮没有 migration，也没有真实投递或 AI 调用。扩展 1.8.10，BOSS content 版本 `2026-09-14-boss-evidence`；智联 content 版本不变。回退可单独撤销该模块和委托接入，不能改变既有 UNKNOWN 或 Cookie 边界。真实网站只读状态核对单独记录，不能用自动化结果冒充。
