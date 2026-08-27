# 四平台可信闭环与 AI 沟通助手执行任务

## 背景

当前 codex/stable-v1-completion 已完成本机安全、数据库迁移、投递状态、AI 任务恢复和 Provider 稳定性整改，但真实数据库副本与真实招聘平台尚未形成完整验收。Boss、智联是 Chrome Bridge 主链，猎聘、51job 仍以旧 Playwright 兼容链为主。AI 已生成并保存 greeting，但分析页不可见，投递任务仍主要使用档案默认话术。

## 目标

1. 验收并收口稳定 V1，不直接迁移真实数据库，不自动合并 main。
2. 建立四平台能力注册表和统一的分析/确认契约，Boss、智联为一级质量，猎聘、51job为二级兼容质量。
3. 让 Boss、智联的 AI 沟通话术可见、可编辑、可复制、可恢复，人工编辑不得覆盖 AI 原稿。
4. 确认投递前展示最终话术，并确保任务使用的内容与用户看到的内容一致。

## 允许修改范围

- src/main/java/com/getjobs/application/platform/**
- src/main/java/com/getjobs/application/controller/**
- src/main/java/com/getjobs/application/service/**
- src/main/java/com/getjobs/application/entity/**
- src/main/java/com/getjobs/application/mapper/**
- src/main/resources/db/migration/**
- src/test/java/**
- front/app/boss/analysis/**
- front/app/zhilian/analysis/**
- front/lib/**
- README.md、ROADMAP.md、CHANGELOG.md、doc/使用指南.md、PROJECT_AUDIT.md
- 本任务文件

## 禁止修改范围

- db/getjobs.db 及其 WAL/SHM；迁移只允许在副本或临时 SQLite 上执行。
- .env、Cookie、Token、API Key、浏览器资料和真实简历内容。
- 绕过验证码、登录验证、平台风控或人工确认。
- 自动合并 PR、删除分支、force push、真实投递和真实消息发送。
- 为统一形式而重写四个平台 DOM 采集逻辑，或删除仍承载猎聘/51job 的旧 Worker。

## 已确定实现要求

- 现有平台 API 保持兼容；能力接口为只读新增接口。
- PlatformAdapter 负责能力声明和岗位分析输入规范化，不强制共享 DOM 实现。
- 四个平台只能声明一个正式执行模式；日志使用 profileId、runId、requestKey 关联。
- 用户沟通草稿与 AI 原始 greeting 分开存储，使用 Flyway 新迁移和乐观并发字段。
- 最终话术优先级为：用户编辑稿、AI greeting、档案默认话术、空白警告。
- 单个和批量确认都必须在对外动作前展示最终话术；本任务不增加独立自动发送入口。
- 真实平台 smoke 第一轮停止在待确认队列。

## 验收标准

- 真实数据库副本迁移通过，integrity_check 为 ok，foreign_key_check 无异常，原库指纹不变。
- 平台能力接口准确描述 Boss、智联、猎聘和 51job 的等级与执行模式。
- Boss、智联重复扫描不会因 scanRunId 产生重复业务岗位。
- 四平台分析任务均按当前 Profile 隔离；猎聘、51job可进入待确认但继续保留旧执行链。
- Boss、智联列表返回话术来源和草稿版本；并发旧写入返回冲突，不覆盖新草稿。
- AI 重新分析不覆盖人工草稿；确认任务使用界面展示的最终话术。
- 全量后端、扩展、前端检查通过，git diff --check 通过。

## 测试命令

- .\gradlew.bat clean test jacocoTestReport --console=plain
- node --test chrome-extension/tests/*.test.cjs
- pnpm --dir front lint
- pnpm --dir front typecheck
- pnpm --dir front build
- pnpm --dir front audit --prod
- git diff --check

## 返回格式

- 分里程碑说明完成状态、真实 smoke 状态和剩余风险。
- 报告数据库备份路径、副本迁移证据和原库前后指纹。
- 报告修改文件、测试结果、分支、提交、推送、PR 和回滚方式。
- 明确说明未执行真实投递、真实消息发送和 PR 合并。
