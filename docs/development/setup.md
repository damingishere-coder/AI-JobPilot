# 开发者本地启动指南

本文面向准备修改 AI JobPilot 代码、运行测试或提交 Pull Request 的贡献者。普通用户优先阅读根目录的 `README.md` 和 `WINDOWS_SETUP.md`。

## 1. 环境要求

- Windows 10 / 11（当前主要开发与验证环境）
- Git
- Java 21
- Node.js 20.19 或更高版本
- pnpm 10.20.0
- Chrome
- 可选：Docker Desktop

检查版本：

```powershell
git --version
java -version
node --version
pnpm --version
```

如未安装 pnpm：

```powershell
corepack enable
corepack prepare pnpm@10.20.0 --activate
```

## 2. 获取代码

```powershell
git clone https://github.com/damingishere-coder/AI-JobPilot.git
cd AI-JobPilot
```

开发新功能前，从最新 `main` 创建独立分支：

```powershell
git checkout main
git pull
git checkout -b feat/your-change
```

常用分支前缀：

- `feat/`：新功能
- `fix/`：Bug 修复
- `docs/`：文档
- `test/`：测试
- `chore/`：依赖或仓库治理

## 3. 本地配置

复制示例配置：

```powershell
Copy-Item .env.example .env
```

只填写本地运行必需的值。不要把以下内容提交到 Git：

- API Key、密码、Cookie、Token
- 真实简历和聊天截图
- SQLite 数据库及备份
- Chrome 用户目录和浏览器缓存
- `.env`、日志和运行输出

## 4. 启动后端

```powershell
.\gradlew.bat bootRun
```

默认地址：

```text
http://localhost:8888
```

健康检查：

```text
http://localhost:8888/api/health
```

返回 `UP` 表示后端基础服务正常。

## 5. 启动前端

另开一个 PowerShell 窗口：

```powershell
cd front
pnpm install --frozen-lockfile
pnpm dev
```

默认地址：

```text
http://localhost:6866
```

## 6. 加载 Chrome Bridge

1. 打开 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择仓库中的 `chrome-extension` 目录。
5. 打开前端工作台并确认扩展连接状态。

不要在测试代码、Issue 或截图中暴露真实 Cookie、账号信息或招聘平台个人数据。

## 7. 运行检查

后端测试：

```powershell
.\gradlew.bat test
```

后端完整构建：

```powershell
.\gradlew.bat build
```

前端代码检查：

```powershell
cd front
pnpm lint
```

前端生产构建：

```powershell
cd front
pnpm build
```

提交 PR 前，至少确保与改动相关的检查通过。

## 8. 数据库与测试数据

默认本地数据库：

```text
db/getjobs.db
```

数据库文件不能提交。结构变更优先通过 Flyway 迁移脚本完成，并验证：

- 新数据库能够完整初始化
- 已有数据库可以向前迁移
- 迁移不会删除用户数据
- CI 使用临时 SQLite 数据库

仓库中的 `demo/` 目录只包含虚构、脱敏的示例数据。当前阶段这些文件用于界面说明、测试设计和后续 Demo 模式开发，不代表已自动接入应用。

## 9. 提交规范

推荐使用清晰的英文或中文提交信息：

```text
feat: add offline demo data loader
fix: restore Boss scan after verification
chore: configure weekly dependency updates
docs: improve contributor setup guide
```

一次提交尽量只解决一个问题，不要混入数据库、日志、缓存和个人配置。

## 10. 创建 Pull Request

PR 中应说明：

- 为什么需要修改
- 修改了哪些模块
- 如何验证
- 是否影响数据库、平台流程或安全边界
- 是否包含界面变化和截图

涉及招聘平台自动化时，请明确：

- 是否仍然保留人工确认
- 是否会绕过验证码、登录验证或平台限制
- 是否会读取、保存或传输敏感信息

项目不接受绕过风控、验证码或账号限制的实现。

更多要求见根目录的 `CONTRIBUTING.md` 和 `SECURITY.md`。
