# BOSS / 智联扫描启动与旧任务恢复

扩展 1.10.15 修复扫描启动交接、旧任务占用入口及工作台状态同步。沿用现有扫描接口、控制命令和数据库，不迁移或删除历史记录。

## 启动确认

页面保存本轮初始断点后，启动响应须包含 `startAccepted: true`、`runId`、`profileId`、`scanOwnerToken`。后台核对对应任务身份；后台注册记录、页面跳转中的推断状态和空响应均不能证明页面已接受任务。

明确没有页面接收者时，后台仅在原标签页重新等待和准备一次；仍需核对平台、HR 聊天保护及独立扫描窗口。消息端口关闭、响应超时等结果不明时，只读核对该页面的已接受任务，不再次派发 START。无法核实时保留任务和控制联系，显示 `SCAN_START_UNCONFIRMED`，等待明确继续或停止。

两平台 `STATUS` 的 `reconcileStart: true` 分支只读任务和状态，不清理、恢复断点、注入脚本或跳转页面。同任务、同档案、同执行器和同配置的重复 START 仅返回已有接受状态，不重复采集，也不把已暂停任务自动恢复。

任务配置比较键使用 SHA-256 指纹，避免新增明文筛选串副本。读取旧比较键时仅在内存转换，保留原有关键词进度和断点；采集所需的原配置仍按既有结构保存。固定第三方实现及校验信息见 `chrome-extension/vendor/README.md`。

## 暂停、停止与登记冲突

智联页面隐藏且岗位关键字段尚未渲染时，继续安全暂停并保留 `PAGE_HIDDEN` 断点。普通刷新只连接控制；显式 RESUME 才继续采集；STOP 清理对应断点。

登记新任务遇到 `PLATFORM_SCAN_ALREADY_ACTIVE` 时，工作台显示具体原因并关联当前档案的实际未结束任务。另一个档案占用平台时，只提示切换档案查看，不控制其他档案任务。

已保存 STOP 的旧任务禁止后续入库，即使扫描页离线或尚未确认，也允许登记新轮。旧命令仍显示等待扩展执行，不冒充已停止。重复 STOP 可修复旧版本留下的停止约束，并保留原指令和历史。

主工作台采用同平台、同档案、同任务的后端状态。迟到的扩展状态不能覆盖后端终态或停止约束；扫描与 HR 托管分别处理。

## 验证与发布

```powershell
node --test chrome-extension/tests/*.test.cjs
node scripts/validate-chrome-extension.mjs
pnpm --dir front test
pnpm --dir front typecheck
pnpm --dir front lint
pnpm --dir front build:prod
.\gradlew.bat test browserRegressionTest --no-daemon
```

部署沿用现有 RunDock Backend / 6866 和共享数据库。更新前保存 SQLite 一致性备份及旧代码版本，核对无活跃采集和待处理分析。更新后重新加载 Chrome 中现有“投递牛马 Chrome Bridge”，刷新工作台及扫描页，并从 PING 确认实际版本；磁盘版本不能作为实际加载证据。

真实验收使用当前档案和已保存的搜索配置，核对关键词过程、`fresh_scan_receipt` 入库回执及对应 AI 队列；岗位重复或结果耗尽须按真实原因展示。验证码和登录要求交由本人处理，保留断点。扫描不自动投递或操作 HR 聊天。

回滚只恢复代码、静态资源和扩展；保留新增扫描、岗位和分析事实，不以旧数据库覆盖后续记录。
