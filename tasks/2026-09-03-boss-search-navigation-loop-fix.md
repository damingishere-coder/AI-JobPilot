# Boss 搜索页导航循环修复

## 背景

蒋银峰档案的真实 Boss 扫描在第 7/8 个关键词“AIGC产品运营”处反复往返于搜索页和岗位详情页。已确认页面进入采集阶段时会把导航重试次数清零，Boss 再次重定向后无法触发既有的 5 次失败上限。

## 目标

- 搜索页进入采集阶段后保留本关键词已经发生的导航次数。
- 等待岗位列表期间如果页面漂移到详情页，重新进入搜索导航并累计一次重试。
- 同一关键词连续重定向达到 5 次后以 `NAVIGATION_FAILED` 结束，不再无限循环。
- 新关键词使用新的导航键，从 0 次重新计数。
- 新生成的 Boss 搜索链接使用当前 `/web/geek/jobs` 路径，同时继续兼容历史 `/web/geek/job` 链接。

## 允许修改范围

- `chrome-extension/boss-content.js`
- `chrome-extension/boss-scan-support.js`
- `chrome-extension/background.js`
- `chrome-extension/zhilian-content.js`
- `chrome-extension/manifest.json`
- `chrome-extension/tests/*.test.cjs`
- 本任务文件

## 禁止修改范围

- 后端 AI Provider、模型、登录和认证配置。
- 数据库、历史岗位、现有失败任务和投递状态。
- 服务启动方式、端口和生产数据。
- 自动重启服务、自动重新扫描或自动投递。

## 已确定实现要求

1. 导航次数由纯函数统一读取、进入采集时保留、重定向重试时递增。
2. `waitForJobCards` 返回后必须再次校验当前 URL 是否仍是本关键词搜索页。
3. 页面漂移时保存可恢复的 `searching` 检查点，再调用现有导航逻辑。
4. 达到现有 `SEARCH_NAVIGATION_MAX_ATTEMPTS` 时复用现有失败出口。
5. 提升扩展版本，使后台能识别并重载修复后的内容脚本。

## 验收标准

- `/web/geek/job` 与 `/web/geek/jobs` 仍被视为同一搜索路径。
- 进入采集不会把非零导航次数重置为 0。
- 采集阶段发生路由漂移会递增次数并回到 `searching`。
- 连续 5 次重定向会达到失败上限。
- 导航键变化后尝试次数归零。
- 扩展单测、扩展校验、后端测试和前端质量检查通过。

## 测试命令

- `node --test chrome-extension/tests/*.test.cjs`
- `node scripts/validate-chrome-extension.mjs`
- `gradlew.bat test`
- `pnpm --dir front test`
- `pnpm --dir front typecheck`
- `pnpm --dir front lint`
- `pnpm --dir front build:prod`
- `git diff --check`

## 返回格式

- 修复根因与行为变化。
- 修改文件、测试结果和未执行的运行态操作。
- 分支、提交、Push、PR 和 CI 状态。
- 回滚方式与再次扫描前的人工步骤。
