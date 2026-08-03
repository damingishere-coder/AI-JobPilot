# 参与贡献

感谢你愿意帮助改进 AI JobPilot（投递牛马）。本项目涉及招聘平台页面、本地浏览器登录状态、个人简历和模型密钥，请在提交内容前优先保护隐私并遵守平台规则。

## 可以贡献什么

欢迎以下类型的贡献：

- 可复现的 Bug 报告
- 招聘平台页面改版后的适配修复
- Windows 安装、启动和排错文档
- 前端交互和可访问性改进
- 后端测试、性能和稳定性改进
- 平台适配层、数据清洗和失败诊断
- 中英文文档修正

以下内容通常不会被接受：

- 绕过验证码、登录验证、平台风控或投递限制
- 默认取消人工确认的批量投递逻辑
- 将真实 Cookie、Token、API Key、简历或账号信息提交到仓库
- 未说明来源或许可证的第三方代码和素材
- 无法复现、缺少环境信息的大范围重写

## 提交 Issue 前

1. 搜索现有 Issue，避免重复提交。
2. 确认问题可以在当前主分支或最新版本中复现。
3. 移除日志、截图和配置中的个人信息。
4. 记录操作系统、Java、Node.js、浏览器版本和平台页面。
5. 提供最小复现步骤、预期结果和实际结果。

涉及安全问题时，不要在公开 Issue 中粘贴密钥、Cookie、账号或简历。请先阅读 [SECURITY.md](SECURITY.md)。

## 本地开发

### 环境

- Windows 10 / 11
- Java 21
- Node.js 20.19 或更高版本
- pnpm
- Chrome
- Git

### 启动后端

```powershell
.\gradlew.bat bootRun
```

### 启动前端

```powershell
cd front
pnpm install
pnpm dev
```

默认地址：

```text
前端：http://localhost:6866
后端：http://localhost:8888
健康检查：http://localhost:8888/api/health
```

## 提交前检查

后端：

```powershell
.\gradlew.bat test
.\gradlew.bat build
```

前端：

```powershell
cd front
pnpm lint
```

修改 Chrome 扩展时，请至少完成：

- 重新加载扩展
- 验证消息来源校验仍然有效
- 验证本地前端可以连接
- 验证不会把 Cookie、密码或浏览器缓存写入后端或日志
- 验证投递动作仍然需要人工确认

## 分支与提交

建议从最新 `main` 创建短生命周期分支：

```text
fix/boss-selector
feat/platform-adapter
refactor/job-analysis
Docs/windows-setup
```

推荐提交信息格式：

```text
类型: 简短说明
```

常用类型：

- `feat`：新增能力
- `fix`：修复问题
- `docs`：文档修改
- `refactor`：不改变外部行为的重构
- `test`：测试相关
- `chore`：构建、依赖和维护工作

示例：

```text
fix: handle expired Boss login page
Docs: clarify Chrome Bridge setup
```

## Pull Request 要求

一个 PR 尽量只解决一个明确问题，并包含：

- 修改背景和目标
- 主要改动
- 验证方式和结果
- 影响的平台和模块
- 是否涉及数据库迁移
- 是否涉及 Cookie、API Key、简历或其他敏感数据
- 界面修改前后的截图（请脱敏）

不要在 PR 中提交：

- `.env`、`.env.local`
- `db/`、`data/`、`logs/`、`output/`
- 浏览器用户目录或缓存
- 真实简历和账号截图
- IDE 和系统临时文件

## 平台适配原则

招聘平台随时可能修改页面结构。提交平台适配时，请：

1. 优先使用稳定的结构化字段或语义标识。
2. 将平台差异限制在对应适配器或采集模块内。
3. 为异常页、登录过期和空结果提供可诊断信息。
4. 保留降级路径，不要让单一选择器失败导致全部任务中断。
5. 不实现绕过验证码、风控和访问限制的逻辑。

## 文档同步

行为、配置、端口、环境要求或安全边界发生变化时，应同步更新相关文档：

- `README.md` / `README.en.md`
- `WINDOWS_SETUP.md`
- `TASK_FLOW.md`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `ROADMAP.md`
- `CHANGELOG.md`

## License

提交贡献即表示你有权提供相关代码和内容，并同意贡献内容按照仓库现有的 [TOUDI NIUMA Non-Commercial License 1.0](LICENSE) 分发。
