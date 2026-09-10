# GitHub 同步任务：Codex CLI Provider

## 背景

当前工作树包含一组尚未提交的 Codex CLI Provider 改动，需要在保留本地代码的前提下同步远程最新 `main`，完成验证后提交、推送并创建 PR。

## 目标

- 基于最新 `origin/main` 承载现有本地修改。
- 验证后端 Provider 路由、配置读取与前端配置页可构建。
- 仅提交本次功能相关文件，推送功能分支并创建到 `main` 的 PR。

## 允许修改范围

- `.env.example`
- `ARCHITECTURE.md`
- `doc/使用指南.md`
- `front/app/env-config/page.tsx`
- `src/main/java/com/getjobs/application/service/`
- `src/test/java/com/getjobs/application/service/`
- 本任务文件

## 禁止修改范围

- `.env` 和任何密钥、Token、Cookie、登录数据
- 数据库、日志、浏览器资料、构建产物
- 与 Codex Provider 无关的项目功能
- Git 历史、仓库权限和 `main` 分支

## 已确定实现要求

- 默认 `AI_PROVIDER=codex`，保留远程 API 回退。
- Codex CLI 使用只读沙箱、临时会话和最终消息文件。
- Windows npm 启动器通过系统命令解释器调用。
- 不执行真实 Provider 请求作为普通测试。

## 验收标准

- 当前分支基于最新 `origin/main`，没有未处理冲突。
- 定向后端测试与完整后端测试通过。
- 前端 lint 无错误，生产构建通过。
- 变更中无真实凭证和意外临时产物。
- 功能分支推送成功并创建到 `main` 的 PR。

## 测试命令

```powershell
.\gradlew.bat test --tests "com.getjobs.application.service.ConfigServiceTest" --tests "com.getjobs.application.service.AiServiceConfigTest" --tests "com.getjobs.application.service.AiServiceProviderTest" --tests "com.getjobs.application.service.CodexCliServiceTest" --no-daemon
.\gradlew.bat test --no-daemon
pnpm --dir front lint
pnpm --dir front build
```

## 返回格式

- 当前分支、远程地址、提交名称和 commit ID
- 测试与构建结果
- 推送分支和 PR 链接
- 回滚方式和同步状态
