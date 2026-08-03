# AI JobPilot 文档中心

这里汇总 AI JobPilot 的使用、开发、架构、安全、版本发布和演示资料。当前部分历史文档仍位于仓库根目录或 `doc/`，后续会在不破坏链接的前提下逐步迁移。

## 普通用户

| 文档 | 内容 |
| --- | --- |
| [项目主页](../README.md) | 产品定位、能力、截图、快速开始与平台支持 |
| [Windows 新手部署](../WINDOWS_SETUP.md) | Windows 安装、启动、验证和排错 |
| [任务流程](../TASK_FLOW.md) | 从简历配置、岗位采集到人工确认的完整流程 |
| [版本发布与下载](releases.md) | Release 产物、版本命名、SHA256 校验和发布边界 |
| [安全说明](../SECURITY.md) | API Key、Cookie、简历、数据库与浏览器数据边界 |
| [路线图](../ROADMAP.md) | 当前阶段、下一步和长期方向 |
| [版本记录](../CHANGELOG.md) | 已发布与待发布变更 |

## 贡献者

| 文档 | 内容 |
| --- | --- |
| [参与贡献](../CONTRIBUTING.md) | Bug、功能建议、提交规范与 PR 要求 |
| [开发者本地启动](development/setup.md) | Java、Node、pnpm、后端、前端、扩展和测试 |
| [系统架构](../ARCHITECTURE.md) | 模块职责、数据流与 SaaS 演进说明 |
| [安全报告](../SECURITY.md#报告安全问题) | 如何在不公开敏感数据的情况下报告问题 |
| [自动化安全检查](../SECURITY.md#自动化安全检查) | CodeQL、Dependabot、扩展校验和 Release 校验范围 |

## Demo 与测试资料

| 文档 | 内容 |
| --- | --- |
| [Demo 说明](../demo/README.md) | 离线 Demo 模式规划与安全边界 |
| [示例简历](../demo/sample-resume.md) | 完全虚构的求职档案 |
| [示例岗位](../demo/sample-jobs.json) | 完全虚构的岗位数据 |
| [示例分析](../demo/sample-analysis.json) | 完全虚构的 AI 匹配结果 |

> 当前 Demo 文件尚未自动接入应用，只用于展示、测试设计和后续功能开发。不要将其描述为已经上线的一键 Demo。

## 平台与实验资料

| 文档 | 内容 |
| --- | --- |
| [Boss 搜索 API POC](../doc/BOSS_API_POC.md) | Boss 搜索 API 的手动验证和降级路径 |
| [历史文档索引](../doc/文档索引.md) | 旧方案、实施记录和补充说明 |

## 自动化工作流

| 工作流 | 作用 |
| --- | --- |
| `CI` | 后端测试与构建、前端 lint 与构建、Chrome 扩展校验、Docker 配置校验 |
| `CodeQL` | Java / Kotlin 与 JavaScript / TypeScript 安全分析 |
| `Release` | 版本预览构建、标签发布、产物打包和 SHA256 校验 |
| `Dependabot` | 每周检查后端、前端和 GitHub Actions 依赖更新 |

## 维护原则

新增文档时请遵循：

1. 普通用户首先看到“如何安装、如何使用、当前限制”。
2. 开发者细节放入 `docs/development/`。
3. 历史方案和已废弃内容放入 `docs/archive/` 或现有历史目录。
4. 不在文档、截图和示例中提交真实 Cookie、API Key、简历、账号和数据库。
5. 移动文件前先更新仓库内所有链接，必要时保留迁移说明。
6. README 保持产品入口作用，不重新堆回完整开发日志和内部验收清单。
