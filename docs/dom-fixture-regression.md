# P0.2：DOM Fixture 与纯解析入口

本轮保护现有采集/投递行为。没有修改 BOSS content、智联执行器、后台派发、AI、后端或数据库；没有新增权限、自动采集或上传通道。结构范围修复随 1.8.13 发布，嵌套字段识别修复随 1.8.14 发布。

## 样本与运行

`chrome-extension/tests/fixtures/catalog.json` 管理平台、页面类型、来源、日期、HTML 路径及期望结果。保留 23 份 **合成样本**和三份 2026-09-15 用户主动导出的 **脱敏结构故障样本**。首份只有标题和地址，后两份已包含列表卡片及详情链接，但仍有字段缺失，不能当成完整页面或投递验收通过。没有保存账号数据或原始截图。

- BOSS：列表字段、去重、非法/导航 URL、空列表、卡片替换后的结构；详情的标题、公司、薪资、地点、经验、学历、JD、公司介绍。
- 智联：现代分栏详情、稳定岗位身份、旧详情拒绝、空列表；复用现有 `readCard/readDetail`，不重构智联。
- 双平台：登录、验证、固定/隐藏弹窗、剩余额度/用尽、成功和异常结构。此轮只固定结构，**不宣称已完成 PageState / Evidence 状态机验证**。聊天成功样本完全虚构，不允许导出真实聊天。
- 分页容器保留在样本中；滚动、节点替换与 deadline 的动态行为继续由现有测试覆盖。完整分页和真实布局在 P0.6 浏览器回归补齐，不能用 jsdom 可见性 Mock 代替。

在项目根目录执行扩展测试：

```powershell
node --test chrome-extension/tests/*.test.cjs
node scripts/validate-chrome-extension.mjs
```

在 `front` 执行：

```powershell
pnpm exec vitest run lib/recruitment-fixtures.test.ts lib/fixture-export.test.ts
pnpm test
pnpm typecheck
```

现有 CI 自动运行这些 Vitest 测试，无新服务、数据库或依赖。

## BOSS 解析边界

保留原 `collectVisibleJobs`、`collectCurrentDetail` 调用方式。新增：

- `GetJobsBossSearchCollector.parseCard(root, keyword, selectors, {origin, support})`
- `GetJobsBossSearchCollector.isCollectableBossJob(job, {origin, support})`
- `GetJobsBossDetailCollector.parseDetail(document, baseJob, selectors, currentUrl)`

显式入口只读输入 DOM/文本，传入现有 `GetJobsBossScanSupport`，不导航、不点击、不读存储、不请求网络。字段优先级、URL 规范化、缺失字段及回退规则保持不变。测试对完整返回值比较，并在禁止读取环境 location 时验证显式解析。

## 用户主动导出

1. 在 Chrome 扩展管理页重新加载当前版本，并刷新招聘标签页。打开自己正在使用的 BOSS / 智联页面，无需启动扫描。
2. 点击工具栏上的投递牛马扩展图标，选择搜索列表、岗位详情或阻断弹窗。
3. 点击“生成脱敏预览”。只有此动作才读取当前标签页的白名单 DOM；没有白名单结构就失败，不回退整页抓取。
4. 在只读文本框检查 JSON。确认无个人信息、聊天或凭据后勾选确认框，再点击下载。
5. 下载在本地完成，没有上传或数据库写入。关闭弹窗/清除预览即丢弃内存样本；重新生成、切换类型和清除都使旧确认失效。

1.8.13 的 BOSS 搜索/详情根范围补入现有 `boss-selectors.js` 已支持的卡片、列表和详情结构模式，仍不读取整页或保留任意类名。失败返回固定错误码及对应说明，不回显可能包含账号或地址参数的原始异常。样本额外附带 `coverage` 和 `warnings`，缺少 JD、公司、卡片或岗位身份时弹窗明确标注“部分结构样本”；可预览下载用于诊断，不能作为完整验收。`coverage` 仅统计保留下来的结构标记，不证明真实字段值或交互正确。

本次输入未包含搜索列表 DOM，截图无法确定其精确类名。已验证的是新增结构模式的离线回归；当天真实列表/完整 JD 的兼容性仍需用户重导验证。不要把这次兼容扩展标记为真实 Smoke 已通过。

后续 1.8.13 重导样本保留了 15 张卡片和 15 个链接，但 `.job-salary` 位于 `.job-title` 内，旧字段替换按照字段列表优先级寻找任意祖先，误将薪资替换成标题别名。1.8.14 改为由当前元素逐层向上匹配，最近字段优先；下载格式仍为 `structural-fixture/1`，脱敏规则版本为 `structural-fixture/3`。原故障样本不重写，测试分别验证历史输入和新规则。

同批详情已保留一个岗位链接，原始公司/JD 类名在脱敏过程中丢失，不能由这些文件反推 Selector。不同文件里的 `fixture001` 独立分配，不证明列表与详情是同一个真实岗位。

2026-09-15 经用户授权，由 Codex 直接只读检查 Chrome 当前 BOSS 页面，确认公司链接为 `a.boss-info`，父节点为 `.job-card-footer`；职位描述标题的父节点为 `.job-detail-body`，正文是其直接子节点 `p.desc`，HR 区域为 `.job-boss-info`。1.8.15（规则 `structural-fixture/4`）只允许岗位卡片底部的该公司链接，并为正文添加有上下文约束的字段识别。其他 `.boss-info`、整个 `.job-boss-info` 及后代仍排除；未从 HR 公司/姓名或别的岗位填补详情公司。详情若无独立公司字段继续提示缺失。

回归测试按观察到的结构编写虚构内容，覆盖公司链接、JD 隐藏噪声、嵌套 HR 区域和非正文 `.desc`，不将这组合成测试冒充真实导出 Fixture。浏览器随后出现反复加载，尚未取得规则 4 的真实重导样本。Chrome 内部扩展管理页不能被当前浏览器工具接管，不能用磁盘 manifest 版本代替实际已加载版本验收。没有执行投递、发送、AI 调用或导出原始整页。

导出器先构造新的脱敏 DOM，再序列化。原始整页 HTML 不先落盘，也不发送给后台。脚本、图片、表单、可编辑区、聊天和身份子树被排除；任意属性、类名、URL 参数/片段被删除。只保留固定标签、类名、少量 display/visibility/position/opacity 值、已知状态词；自由文本和身份替换为虚构内容。同名标题保持同名，岗位 ID 在一次导出内一致映射。跨导出别名不能当成稳定业务 ID。

这是 **结构脱敏样本**：能复现已知 Selector 与有限布局形状，不能证明真实 JD 或未知状态词解析正确；未允许的类名与文本会损失。遇到新结构应人工编写对应合成变体和期望结果，不能放宽为原文全量导出。超过节点/深度/根数量限制则整次失败，不输出部分成功。

## 样本审核与归档

下载格式 `structural-fixture/1` 包含 `html`、`platform`、`pageType`、来源 `structural-redacted`、采集时间、脱敏版本及限制。维护者审核后将 `html` 写入相应平台目录，在 catalog 中保留来源和采集日期，并手写独立 `expected`；不得根据解析器当前输出自动生成期望。不要提交下载目录或原始页面。修改既有样本要注明页面变体，不能覆盖失败样本来获得绿灯。

真实样本导出需要明确主动触发；用户授权后可由 Codex 操作受支持的浏览器界面并审核脱敏结果，不应将可执行的检查反复交给用户。本地自动化测试使用虚构资料。导出验收与招聘网站单条投递 Smoke 相互独立。

## 回退

纯解析抽取、导出工具、样本基线分别提交。可单独回退导出入口或解析抽取；保留 Fixture、现有安全协议和后端 UNKNOWN 修复。没有 migration，也不需要覆盖 SQLite。回退扩展文件后应重新加载扩展和平台标签页。
