# 任务流程说明

本文说明投递牛马当前真实的业务流程。它不是新增功能说明，而是帮助使用者理解系统从简历到投递结果是怎么流转的。

## 总览

```text
准备环境
  ↓
保存简历和 AI 配置
  ↓
配置求职目标
  ↓
采集岗位
  ↓
AI 分析匹配度
  ↓
生成待确认清单
  ↓
用户确认
  ↓
Chrome Bridge 或 Playwright 执行
  ↓
写回投递状态
```

## 1. 用户上传或填写简历

入口：

- 前端页面：`/ai-config`
- 后端接口：`/api/ai/resume`
- 后端服务：`JobAiAnalysisService`

当前支持：

- 直接保存简历文本。
- 上传 PDF 并提取文字。
- 上传图片简历并调用 AI 识别。
- 保存解析状态，例如 `parsed`、`failed`、`empty_text_pdf`。

注意：

- 简历内容保存在本地 SQLite。
- 扫描版 PDF 可能提取不到文字，需要粘贴文本或上传图片。
- 简历文件和个人信息不要提交到 Git。

## 2. 配置求职目标

入口：

- Boss：`/boss`
- 智联：`/zhilian`
- 猎聘：`/liepin`
- 51job：`/51job`

典型配置：

- 关键词。
- 城市。
- 薪资。
- 经验。
- 学历。
- 公司规模、行业、融资阶段等平台筛选项。
- Boss 黑名单和优先公司。

配置会写入本地数据库。当前多候选人档案通过 `profile_id` 隔离部分配置和分析数据。

## 3. 采集岗位

当前有两条路线。

### Chrome Bridge 路线

主要用于 Boss 和智联。

```text
前端发送扫描任务
  ↓
Chrome 扩展打开或复用招聘平台标签页
  ↓
content script 读取岗位列表和详情
  ↓
扩展把岗位提交给本地后端
```

相关接口：

- `POST /api/boss/chrome/jobs`
- `POST /api/zhilian/chrome/jobs`

### Playwright 路线

主要保留给既有平台自动化流程。

```text
前端点击开始
  ↓
后端读取配置和 Cookie
  ↓
worker 使用 Playwright 操作招聘网站
  ↓
后端通过 SSE 推送运行进度
```

相关接口示例：

- `POST /api/boss/start`
- `POST /api/zhilian/start`
- `POST /api/liepin/start`
- `POST /api/51job/start`

## 4. AI 分析匹配

采集到岗位后，后端会为 Boss 和智联的 Chrome Bridge 岗位执行 AI 分析。

AI 输入包括：

- 当前简历。
- 平台。
- 关键词。
- 公司名称。
- 岗位名称。
- 薪资、地点、经验、学历。
- 公司信息和岗位描述。
- 优先公司配置。

期望 AI 返回 JSON，字段包括：

- `score`
- `decision`
- `summary`
- `strengths`
- `risks`
- `greeting`

后端会尽量从模型输出中提取 JSON。如果格式异常，会记录失败原因，并把岗位标记为 `AI分析失败`。

## 5. 生成投递清单

AI 分析完成后，岗位状态会变成：

| 状态 | 含义 |
| --- | --- |
| `待确认` | AI 建议投递，等待用户确认 |
| `AI不匹配` | AI 判断不建议投递 |
| `AI分析失败` | 模型调用或返回解析失败 |
| `采集信息不足` | 岗位缺少必要字段 |
| `已过滤` | 被筛选条件或黑名单过滤 |

分析页会读取本地数据库，展示统计、筛选、分页和待确认清单。

## 6. 用户确认

投递前必须由用户确认。

Boss 和智联确认入口：

- 单个确认：`POST /api/boss/jobs/{id}/confirm`、`POST /api/zhilian/jobs/{id}/confirm`
- 批量确认：`POST /api/boss/jobs/confirm-batch`、`POST /api/zhilian/jobs/confirm-batch`

确认接口只生成投递任务，不直接绕过用户执行。前端会把任务交给 Chrome Bridge，由扩展在招聘平台页面上执行。

## 7. 执行投递或人工处理

### Chrome Bridge 执行

```text
前端把任务发送给扩展
  ↓
扩展打开岗位页面
  ↓
content script 点击投递或沟通按钮
  ↓
扩展把结果回传后端
```

结果接口：

- `POST /api/boss/jobs/{id}/delivery-result`
- `POST /api/zhilian/jobs/{id}/delivery-result`

### 人工处理

如果扩展不可用、岗位页面变化、登录态失效或平台触发验证，用户可以手动打开岗位链接处理。此时系统不会强制继续自动投递。

## 8. 状态回写

最终状态包括：

| 状态 | 说明 |
| --- | --- |
| `未投递` | 岗位已入库，但未进入确认或执行 |
| `待确认` | 等待用户确认 |
| `已投递` | 投递成功并写回 |
| `投递失败` | 页面、登录、网络、按钮或平台限制导致失败 |
| `已跳过` | 用户主动跳过 |
| `AI不匹配` | AI 不建议投递 |
| `AI分析失败` | AI 调用或解析失败 |
| `采集信息不足` | 缺少投递所需字段 |

已经是 `已投递` 的岗位会被保护，后续 AI 重新分析不会把它改回未投递状态。

## 异常状态说明

- 后端未连接：检查 `http://localhost:8888/api/health`。
- 前端无法打开：检查 `http://localhost:6866` 和 `logs/windows-frontend.log`。
- Chrome Bridge 未响应：确认扩展已加载、页面地址是本地地址，并刷新前端和招聘平台页面。
- Cookie 失效：重新登录平台并保存 Cookie。
- AI 分析失败：检查 AI 配置、网络和模型返回格式。
- 投递失败：查看失败类型和失败原因，常见原因是按钮不可点击、页面结构变化、安全验证、账号限制。
- 平台数据为空：确认关键词、城市、筛选条件和平台登录状态。
