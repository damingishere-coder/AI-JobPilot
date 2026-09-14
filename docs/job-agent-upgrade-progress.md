# AI Job Agent 升级实施记录

保留稳定 V1，按依赖逐轮交付；未通过真实网站门禁不能标记 Phase A 完成。

| 轮次 | 主题 | 状态/依赖 |
| --- | --- | --- |
| P0.1 | 入口、会话边界、Runtime 协议 | 已实施，发布/加载扩展验收单独记录；见 application-runtime-v1.md |
| P0.7 | AI UNKNOWN | 已实施，发布验证单独记录；见 ai-unknown-outcome.md |
| P0.2 | 脱敏 Fixture / BOSS Parser | 已实施；23 份合成结构样本、显式解析入口、主动预览导出；真实结构导出验收单独记录；见 dom-fixture-regression.md |
| P0.3 | BOSS State / Evidence | 已实施；只读状态、原话术计数抽取、关键阻碍优先；结构化持久化在 P0.4；见 boss-page-evidence.md |
| P0.4 | BOSS Action / 执行领取 / Recovery | 已实现 V21 和默认关闭的单次许可路径；上线前仍需离线浏览器及真实单条人工确认门禁；见 boss-action-recovery.md |
| P0.5 | 智联 Runtime | 已接入同一领取/许可/暂停协议；复用 V21，平台 DOM 独立；默认关闭，真实单条验收待完成；见 zhilian-runtime-adapter.md |
| P0.6 | 离线浏览器回归 / 双平台 Smoke | 已建立 Chromium/MV3/HTTP+SQLite 回归及 Windows/Linux CI；完整采集 AI E2E 与真实网站 Smoke 尚未验收；见 browser-regression-gates.md |
| P1.1 | 不可变简历及分析快照 | 已实现 V22、加密版本、冻结上下文、兼容批次及历史未知展示；生产发布单独验收；见 analysis-context-snapshots.md |
| P1.2 | Opportunity / Event | V23 最小模型、事务事件、归档恢复与独立阶段；被动复用旧稳定执行链，真实 Smoke 仍阻止新 Runtime 启用；见 opportunity-event-foundation.md |
| P1.3 | Outcome / HR 关联 | V24 用户确认关联、真实反馈、观察覆盖与来源事件；聊天过期后结构化历史保留；见 outcome-feedback-capture.md |
| P1.4 | CRM 工作台 | 统一事项卡片/列表条件、查询参数详情、跟进和消息已查看；保留旧概览及扫描入口；见 crm-workbench.md |
| P1.5 | 面试记录 | 依赖 P1.4；人工确认、不接外部日历 |
| P1.6 | Strategy Analytics | 依赖真实反馈；显示样本与观察覆盖 |
| P1.7 | Fit / Preference / Opportunity Signal | 依赖 P1.6；预览及用户采用、不自动扩大投递范围 |

约束：不保存招聘凭据/Cookie 到后端，不自动处理登录/验证；真实投递保留人工确认；UNKNOWN 不自动重发；不调用真实 AI 作回归；不删除旧执行链或历史数据。每轮独立提交和 PR，迁移编号与部署串行，验收区分代码、CI、部署、扩展加载及真实页面结果。
