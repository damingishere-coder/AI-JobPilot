# API 接口

本文根据当前 controller 代码整理主要后端接口。默认后端地址：

```text
http://localhost:8888
```

## 健康检查

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 后端健康检查 |
| `GET` | `/api/playwright/status` | Playwright 状态 |
| `GET` | `/api/playwright/test-navigate` | Playwright 测试导航 |

## 全局配置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/config` | 获取全部全局配置 |
| `GET` | `/api/config/{key}` | 获取指定配置 |
| `POST` | `/api/config` | 新增配置 |
| `PUT` | `/api/config/{key}` | 更新指定配置 |
| `GET` | `/api/config/health` | 配置模块健康检查 |

## AI 配置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/ai/config` | 获取 AI 配置 |
| `POST` | `/api/ai/config` | 保存 AI 配置 |
| `GET` | `/api/ai/health` | AI 配置健康检查 |
| `GET` | `/api/ai/chat` | AI 聊天测试接口 |

## Cookie

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/cookie` | 获取 Cookie |
| `POST` | `/api/cookie/save` | 保存 Cookie |

## Boss 直聘

### 配置与黑名单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/boss/config` | 获取 Boss 配置 |
| `PUT` | `/api/boss/config` | 更新 Boss 配置 |
| `GET` | `/api/boss/config/options/{type}` | 获取 Boss 配置选项 |
| `GET` | `/api/boss/config/blacklist` | 获取 Boss 黑名单 |
| `POST` | `/api/boss/config/blacklist` | 新增 Boss 黑名单 |
| `DELETE` | `/api/boss/config/blacklist/{id}` | 删除 Boss 黑名单 |

### 运行与状态

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/boss/stream` | Boss 投递进度 SSE |
| `POST` | `/api/boss/execute` | 执行 Boss 任务 |
| `POST` | `/api/boss/start` | 启动 Boss 任务 |
| `POST` | `/api/boss/stop` | 停止 Boss 任务 |
| `POST` | `/api/boss/logout` | Boss 退出登录 |
| `GET` | `/api/boss/status` | Boss 运行状态 |
| `POST` | `/api/boss/chrome/jobs` | 接收 Chrome Bridge 采集的 Boss 岗位并执行 AI 分析 |
| `POST` | `/api/boss/chrome/stop` | 停止指定 Chrome Bridge Boss 扫描 runId |
| `POST` | `/api/boss/ai-keywords` | 根据现有关键词生成 Boss 搜索关键词建议 |

### 数据分析

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/boss/stats` | Boss 统计数据 |
| `GET` | `/api/boss/list` | Boss 投递结果列表 |
| `GET` | `/api/boss/reload` | 重新加载 Boss 数据 |
| `POST` | `/api/boss/jobs/{id}/confirm` | 校验待确认岗位并生成单个 Chrome 投递任务 |
| `POST` | `/api/boss/jobs/confirm-batch` | 按 id 或筛选条件生成 Boss 批量 Chrome 投递任务 |
| `POST` | `/api/boss/jobs/{id}/delivery-result` | Chrome Bridge 回写 Boss 投递成功或失败 |
| `POST` | `/api/boss/jobs/{id}/skip` | 手动跳过 Boss 待确认岗位 |

## 猎聘

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/liepin/login-status` | 猎聘登录状态 |
| `POST` | `/api/liepin/start` | 启动猎聘任务 |
| `POST` | `/api/liepin/stop` | 停止猎聘任务 |
| `GET` | `/api/liepin/status` | 猎聘运行状态 |
| `GET` | `/api/liepin/health` | 猎聘模块健康检查 |
| `GET` | `/api/liepin/config` | 获取猎聘配置 |
| `PUT` | `/api/liepin/config` | 更新猎聘配置 |
| `GET` | `/api/liepin/config/options/{type}` | 获取猎聘配置选项 |
| `GET` | `/api/liepin/stats` | 猎聘统计数据 |
| `GET` | `/api/liepin/list` | 猎聘投递结果列表 |
| `GET` | `/api/liepin/cookie` | 获取猎聘 Cookie |
| `POST` | `/api/liepin/logout` | 猎聘退出登录 |
| `POST` | `/api/liepin/save-cookie` | 保存猎聘 Cookie |

## 51job

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/51job/stream` | 51job 投递进度 SSE |
| `GET` | `/api/jobs/login-status/stream` | 51job 登录状态 SSE |
| `GET` | `/api/51job/config` | 获取 51job 配置 |
| `PUT` | `/api/51job/config` | 更新 51job 配置 |
| `GET` | `/api/51job/config/options/jobArea` | 获取 51job 地区选项 |
| `GET` | `/api/51job/config/options/salary` | 获取 51job 薪资选项 |
| `POST` | `/api/51job/login` | 51job 登录 |
| `GET` | `/api/51job/login-status` | 51job 登录状态 |
| `POST` | `/api/51job/logout` | 51job 退出登录 |
| `GET` | `/api/51job/cookie` | 获取 51job Cookie |
| `POST` | `/api/51job/save-cookie` | 保存 51job Cookie |
| `POST` | `/api/51job/start` | 启动 51job 任务 |
| `POST` | `/api/51job/stop` | 停止 51job 任务 |
| `GET` | `/api/51job/status` | 51job 运行状态 |
| `GET` | `/api/51job/health` | 51job 模块健康检查 |
| `GET` | `/api/51job/stats` | 51job 统计数据 |
| `GET` | `/api/51job/list` | 51job 投递结果列表 |
| `GET` | `/api/51job/reload` | 重新加载 51job 数据 |

## 智联招聘

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/zhilian/config` | 获取智联配置 |
| `PUT` | `/api/zhilian/config` | 更新智联配置 |
| `GET` | `/api/zhilian/config/options/city` | 获取智联城市选项 |
| `GET` | `/api/zhilian/login-status` | 智联登录状态 |
| `POST` | `/api/zhilian/login` | 智联登录 |
| `POST` | `/api/zhilian/logout` | 智联退出登录 |
| `GET` | `/api/zhilian/cookie` | 获取智联 Cookie |
| `POST` | `/api/zhilian/save-cookie` | 保存智联 Cookie |
| `GET` | `/api/zhilian/stats` | 智联统计数据 |
| `GET` | `/api/zhilian/list` | 智联投递结果列表 |
| `POST` | `/api/zhilian/chrome/jobs` | 接收 Chrome Bridge 采集的智联岗位并执行 AI 分析 |
| `GET` | `/api/zhilian/openclaw/status` | 检查 OpenClaw 实验浏览器通路 |
| `POST` | `/api/zhilian/openclaw/probe` | OpenClaw 实验采集智联岗位，不执行真实投递 |
| `POST` | `/api/zhilian/jobs/{id}/confirm` | 校验待确认岗位并生成单个 Chrome 投递任务 |
| `POST` | `/api/zhilian/jobs/confirm-batch` | 按 id 或筛选条件生成智联批量 Chrome 投递任务 |
| `POST` | `/api/zhilian/jobs/{id}/delivery-result` | Chrome Bridge 回写智联投递成功或失败 |
| `POST` | `/api/zhilian/start` | 启动智联任务 |
| `POST` | `/api/zhilian/stop` | 停止智联任务 |
| `GET` | `/api/zhilian/status` | 智联运行状态 |
| `GET` | `/api/zhilian/health` | 智联模块健康检查 |

## Chrome Bridge 数据结构

Chrome Bridge 采集岗位时提交到后端的主要请求：

```json
{
  "runId": "browser-run-id",
  "keyword": "Java",
  "autoDeliver": false,
  "jobs": [
    {
      "id": "platform-job-id",
      "title": "Java开发工程师",
      "company": "示例公司",
      "salary": "20-30K",
      "location": "深圳",
      "experience": "3-5年",
      "degree": "本科",
      "description": "岗位详情",
      "url": "https://..."
    }
  ]
}
```

后端返回 `tasks` 时，前端会交给 Chrome Bridge 执行投递。投递完成后扩展调用 `delivery-result`，请求体为：

```json
{
  "success": true,
  "message": "岗位已在Chrome中投递"
}
```

## 维护说明

- 新增 controller 方法后，请同步更新本文档。
- SSE 接口的响应类型为 `text/event-stream`。
- 多数接口允许跨域访问，controller 使用了 `@CrossOrigin(origins = "*")`。
