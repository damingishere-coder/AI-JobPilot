# 智联详情采集与结果状态修复

## 现象与证据

2026-09-09 的扫描 `zhilian-1788922503245` 只有 3 个入库岗位，3 个 AI 任务均成功；截图包含完整详情 0/30、详情失败 4 次和 180 秒上限，但最终显示绿色扫描完成。旧逻辑将失败的零结果关键词当作空结果，未向终态传递失败信息。

官网当前页面可正常显示岗位与正文，尚未在原运行实例复现空标题的确切触发时机。本次覆盖已识别的渲染与生命周期缺口：卡片尚未渲染就读取、持有被替换的 DOM 节点、重试时错误接受上一岗位详情。

## 修改与兼容

- 卡片先滚入视口并等待标题/公司，失效节点仅按已知标题、公司等信息唯一重定位；禁止按旧序号猜测原岗位。
- 保留 ID、标题、选中状态、完整正文和稳定采样校验。两次尝试共享原始详情切换证据，避免第二次误收旧正文。
- 对卡片未就绪、节点失效和详情加载/切换超时最多重试一次，身份不符、正文不足和无法区分的同名卡片不重试。关键词预算跨重载保留，人工登录/验证暂停时间不计入采集预算。
- 日志包含关键词、卡片序号、可用标题/ID、失败原因和重试数。失败关键词继续下一项，已验证岗位沿用原提交回执机制。
- 状态新增 `outcome`（running/complete/partial/failed/stopped）与 `keywordResults`（keywordIndex、keyword、collected、historyDuplicates、detailFailures、stopReason、outcome）。部分完成保留 `stage: complete`，事件为 warning；全部采集失败为 `stage: error`。
- 结果随断点和智联标签页 sessionStorage 状态保存；工作台刷新后经状态查询恢复。关闭智联标签页后的持久存储不在本次范围。
- 档案/批次切换清理旧状态；工作台拒绝其他档案及同档案更旧批次的结果。历史重复与官网明确空结果分开显示，加载无进展不冒充“已到底”。
- 扩展版本为 `1.7.1`，后台、智联内容脚本和支持模块标识为 `2026-09-09-detail-scan`。未修改 BOSS 生产逻辑、后端数据库结构或生产数据。

## 验证

工作目录：`C:\Users\10578\Documents\AI-JobPilot-worktrees\zhilian-detail-scan`。

```powershell
node --test "chrome-extension/tests/*.test.cjs"
Set-Location front
pnpm test --maxWorkers=1
pnpm typecheck
pnpm lint
pnpm build
```

验证结果：扩展 131/131；前端 26 个文件、108/108；类型检查通过；lint 0 errors（30 项现有警告）；默认 Next/Turbopack 构建通过，13 个静态页面生成。

一次并行全量测试中，未改动的 `front/app/ai-config/page.test.tsx:71` 在 B 档案配置尚未加载时立即断言 `B intro`，出现时序失败；该测试等待档案标题而非配置字段就绪。最终使用 `--maxWorkers=1` 全量通过，未修改该无关测试。

新增回归覆盖延迟标题、节点替换、旧详情和同名卡片、正文不足、共享 deadline、取消、失败关键词后继续、刷新恢复、档案/批次隔离和人工暂停恢复。真实官网只读快照经实际新解析器回放：岗位 `CC231175610J40864466707` 对应标题“售服AI运营经理”，提取正文 541 字，错误 ID 被拒绝。快照核对不等于已完成真实账号全量扫描。

新工作区最初复用依赖 junction，Turbopack 因链接越过根目录报错；已移除该工作区的 junction，并通过 `pnpm install --offline --frozen-lockfile` 安装独立依赖解决。未改动原运行目录依赖。

## PR 与部署验收

分支：`codex/fix-zhilian-detail-scan-20260909`，基线：`e0d678a`。

已核实 PR #55 的实际合并目标和当前发布基线均为 `codex/fix-zhilian-analysis-login-20260907`，其远端 HEAD 为 `e0d678a`。`main` 仍是 `49e7e44`，因此修复 PR 以实际发布分支为 base，避免混入之前的发布内容。

合并与生产部署需另行授权。部署时备份现用扩展/静态资源，在 Chrome 重新加载实际扩展目录并刷新智联页，核对扩展版本与内容脚本标识。完整扫描验收应比较逐关键词结果、当前档案/批次的入库岗位数和任务数，同时检查失败关键词继续执行、部分完成提示、停止与暂停行为。不得以绿色日志替代数据库和任务核对，不执行真实投递或发送 HR 消息。

回滚：未部署时仅保留或关闭修复 PR；合并后用普通 revert 提交撤销修复，部署过则恢复备份的扩展与静态资源并重新加载。无需数据库迁移或删除记录。

本地常规 fetch 遇到既有 `refs/codex/turn-diffs/captures/.../base` 缺失对象错误；未删除或重写旧辅助引用。远端基线通过 GitHub PR 元数据与 `git ls-remote` 核实。

## 修改文件

- 采集与状态：`chrome-extension/zhilian-modern-collector.js`、`chrome-extension/zhilian-content.js`、`chrome-extension/zhilian-scan-support.js`。
- 版本握手：`chrome-extension/background.js`、`chrome-extension/manifest.json`。
- 页面：`front/app/zhilian/page.tsx`、`front/app/zhilian/ScanResult.tsx`。
- 回归：`front/lib/zhilian-modern-collector.test.ts`、`front/app/zhilian/page.test.tsx`、`chrome-extension/tests/zhilian-scan-support.test.cjs`、`chrome-extension/tests/zhilian-submission.test.cjs`。
- 版本断言：`chrome-extension/tests/manifest-id.test.cjs`、`chrome-extension/tests/boss-hr-assistant.test.cjs`、`chrome-extension/tests/profile-scoped-scan-contract.test.cjs`。
- 交付记录：`docs/zhilian-detail-scan-repair.md`。
