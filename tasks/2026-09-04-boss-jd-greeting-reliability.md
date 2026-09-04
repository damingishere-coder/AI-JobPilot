# BOSS 岗位 JD 打招呼语可靠性修复

## 背景

BOSS Chrome Bridge 目前把“平台已进入沟通状态”和“配置话术已发送”混为一次成功判定，导致岗位已有 AI 定制话术时仍可能只触发 BOSS 平台默认话术。AI 分析返回空白 greeting 时，也缺少只重试话术生成的独立兜底。

## 目标

- BOSS 话术优先级保持为：人工编辑稿、岗位 JD 定制 AI 话术、AI-JobPilot 档案默认兜底。
- AI 空白或无效话术只额外重试一次定制话术生成，失败后才使用档案默认兜底。
- 只有聊天记录中新出现与任务快照完全一致的话术后，投递 attempt 才能进入 `CONFIRMED`；仅进入聊天页不算成功。
- 批量投递遇到首个 `UNKNOWN` 后立即暂停，后续任务不触达。

## 允许修改范围

- BOSS AI 分析、配置、投递 attempt 及相关迁移。
- BOSS Chrome 扩展发送和批处理逻辑。
- AI 配置页、BOSS 分析页及相关测试。

## 禁止修改范围

- 不改变智联、猎聘、51job 的发送行为。
- 不重启服务、不重新加载扩展、不执行真实打招呼或投递。
- 不修改真实 `db/getjobs.db`，不读取或写入凭据、Cookie、Token、`.env`。
- 不合并 PR，不重写 Git 历史。

## 已确定实现要求

- 新增“已关闭 BOSS 平台自带打招呼语”档案配置；未确认时阻止创建 BOSS 投递任务。
- 投递 attempt 独立记录话术来源、话术结果和话术证据。
- BOSS 的 `CONFIRMED` 回调必须同时携带 `greetingOutcome=CONFIRMED` 与 `GREETING_RENDERED_EXACT`，否则拒绝确认。
- 扩展写入话术后校验输入框内容，发送一次，并以聊天记录中新出现的精确文本为成功证据。
- 已存在沟通状态不补发话术；批量遇到 `UNKNOWN` 立即暂停。

## 验收标准

- 空白或泛化 greeting 触发一次岗位级话术重试；失败后保留分析结果并显示 `PROFILE_DEFAULT`。
- 输入框、发送按钮或渲染确认任一缺失时，attempt 为 `UNKNOWN`，且不会执行第二次发送。
- 批量结果返回 `halted=true` 和 `unprocessedCount`；后续岗位没有平台动作，只保留未触达审计记录并回到待确认。
- 前端明确区分“岗位 JD 定制”“人工编辑”“AI 失败兜底”。

## 测试命令

```powershell
.\gradlew.bat clean test jacocoTestReport --console=plain
node --test chrome-extension/tests/*.test.cjs
pnpm --dir front test
pnpm --dir front lint
pnpm --dir front typecheck
pnpm --dir front build
git diff --check
```

## 返回格式

报告当前分支、修改文件、提交信息和 SHA、远端 SHA、Push/PR/CI 状态、测试结果、未执行的真实平台验收以及普通 revert 回滚方式。
