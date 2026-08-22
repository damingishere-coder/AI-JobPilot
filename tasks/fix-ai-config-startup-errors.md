# 修复简历配置页启动阶段错误层

## 背景

Windows 本地开发时，Next.js 前端可能先于 Spring Boot 后端就绪。此时 `/api/profiles`、`/api/ai/config`、`/api/ai/resume`、`/api/ai/companies/priority` 和 `/api/boss/config` 会由开发代理返回 HTTP 500，响应体可能是纯文本 `Internal Server Error`。简历配置页当前直接调用 `response.json()`，并在已捕获的加载异常中调用 `console.error`，会触发 Next.js 开发错误层。

## 目标

- 后端短暂未就绪时，不再出现截图中的 HTTP 500、档案加载失败和 JSON SyntaxError 开发错误层。
- 页面使用统一的安全响应解析，向用户显示可重试的友好提示。
- 后端恢复后可通过页面刷新按钮重新加载，不影响正常配置读写。

## 允许修改范围

- `front/app/ai-config/page.tsx`
- `front/app/components/ProfileSwitcher.tsx`
- 本任务说明文件

## 禁止修改范围

- 数据库文件、数据库结构和用户档案数据
- Spring Boot 控制器、服务和启动端口
- API Key、Token、Cookie、`.env` 内容
- 与简历配置页无关的页面或业务逻辑

## 已确定实现要求

- 复用 `front/lib/api.ts` 中的 `readApiResponse` 和 `friendlyApiError`。
- 所有简历配置页初始化请求先按文本读取，再尝试 JSON 解析，避免纯文本 500 触发 SyntaxError。
- 已处理的加载失败不得再使用会触发 Next.js 错误层的 `console.error`。
- ProfileSwitcher 和简历配置页都保留用户可见的错误提示与重试入口。
- 不吞掉保存操作的失败；保存失败仍应通过现有弹窗反馈。

## 验收标准

- 后端正常时，档案、AI 配置、简历、优先公司和 Boss 配置均能正常加载。
- 后端返回纯文本 500 时，不出现未处理的 JSON SyntaxError。
- 初始化失败时，不出现由 `console.error` 触发的 Next.js 开发错误层。
- 页面展示友好错误消息，并可在后端恢复后手动重试。
- 前端 lint 和生产构建通过，页面实测无控制台错误。

## 测试命令

- `pnpm lint`
- `pnpm build`
- 请求 `http://127.0.0.1:6866/api/profiles`、`/api/ai/config`、`/api/boss/config` 检查代理响应
- 浏览器打开 `http://127.0.0.1:6866/ai-config`，检查页面与控制台

## 返回格式

- 修改文件清单
- lint、构建、接口和页面验证结果
- Git 分支、commit 名称、commit ID、push 分支和 PR 链接
- 回滚命令
