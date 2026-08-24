# P0.1 本地安全边界与敏感配置收口

## 背景

工程审计确认：原生启动时后端与前端生产服务可能监听全部网卡；配置接口和 Cookie 查询接口会把敏感值原样返回；`CODEX_PATH` 可被配置为任意本地可执行文件。这些问题在个人本机开发时不一定立即出错，但会扩大误暴露和误执行的风险。

## 目标

1. 原生 Windows 启动默认只监听 `127.0.0.1`。
2. Docker 内部服务保留容器所需的 `0.0.0.0`，宿主端口继续只发布到回环地址。
3. HTTP 配置接口只读写明确允许的 UI 配置键；`API_KEY`、`HOOK_URL` 只返回“是否已配置”，不回传原值。
4. Cookie 查询接口只返回“是否已配置”和非敏感元数据，不回传 Cookie 原文。
5. `CODEX_PATH` 只允许 Codex CLI 的受支持启动文件名，不允许借配置执行任意程序或附加命令参数。

## 允许修改范围

- 服务监听配置、Docker Compose 覆盖项和本地启动脚本。
- 配置与 Cookie HTTP 展示层、环境配置页面。
- Codex CLI 路径校验。
- 与本轮行为直接相关的单元测试、配置烟雾测试和接口文档。

## 禁止修改范围

- 不修改数据库 Schema、Migration 或现有数据。
- 不改变 AI Provider 选择、请求协议、模型路由或业务流程。
- 不改变 Codex 登录方式、认证目录或现有内部读取逻辑。
- 不调用真实 AI、招聘平台、Webhook 或其他外部服务。
- 不删除历史配置、Cookie、代码或依赖。

## 已确定实现要求

- `server.address` 原生默认值为 `127.0.0.1`，允许通过 `SERVER_ADDRESS` 显式覆盖。
- Docker Compose 后端显式设置 `SERVER_ADDRESS=0.0.0.0`；宿主端口保持 `127.0.0.1:8888:8888`。
- 前端生产服务默认监听 `127.0.0.1`，允许环境变量显式覆盖；容器现有显式 `-H 0.0.0.0` 行为不变。
- UI 可管理配置键采用白名单；`CODEX_HOME` 不通过 HTTP 暴露或修改，但内部历史值继续按原逻辑读取。
- 敏感配置普通保存请求中的空字符串视为“保持原值”，防止遮罩后被旧页面误清空；显式清除使用受限的删除接口。
- Cookie 内部注入流程继续读取原值，只有 HTTP 响应做脱敏。
- `CODEX_PATH` 接受 `codex`、`codex.exe`、`codex.cmd`、`codex.bat`、`codex.ps1` 及其完整路径，拒绝其他文件名和带参数的字符串。

## 验收标准

- 未设置覆盖变量时，本地前后端仅监听回环地址。
- Docker Compose 仍能从前端容器访问后端容器，且宿主发布地址仍是回环地址。
- 所有配置 GET 响应均不包含 `API_KEY`、`HOOK_URL` 的原值，也不包含 `CODEX_HOME`。
- 所有 Cookie GET 响应均不包含 Cookie 原文。
- 未修改敏感输入时保存其他设置，不会覆盖已保存的敏感值。
- 非白名单配置键和非 Codex 可执行文件被明确拒绝。
- 内部 AI、Bot、浏览器注入仍能按原逻辑读取敏感值。
- 后端测试、前端 lint/typecheck/build 与扩展测试通过；测试过程不触发真实外部调用。

## 测试命令

```powershell
gradlew.bat test
pnpm --dir front lint
pnpm --dir front typecheck
pnpm --dir front build
$extensionTests = Get-ChildItem chrome-extension/tests/*.test.cjs | ForEach-Object { $_.FullName }
node --test $extensionTests
```

## 返回格式

- 修改文件与关键行为摘要。
- 测试命令、退出码和失败证据（如有）。
- 范围外变更检查、敏感信息检查和 Git diff 摘要。
- Commit、分支、Push 与 PR 状态。
