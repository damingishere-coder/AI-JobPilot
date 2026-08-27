# Stable V1 连续整改任务

## 背景

`PROJECT_AUDIT.md` 将项目评为 50/100。P0.1、P0.2、P0.3、P1.1、P1.2 已在前置堆叠分支完成。本任务连续完成剩余的 P1.3、P1.4、P1.5、P1.6、P2.1，并重新执行 SonarQube 后更新审计结论。

## 目标

1. 完成 Profile 数据隔离、数据库唯一性与关联约束的兼容迁移。
2. 收紧 URL、静态资源和 Chrome 扩展消息边界。
3. 建立可观测的 readiness，以及 delivery attempt 的 UNKNOWN 对账和显式重试入口。
4. 将 Next.js 升级到当前 16.x 安全修复版本，不跨 major，不同时升级 Tailwind。
5. 为迁移、隔离、回调乱序、重启恢复、URL 边界、readiness 和 UNKNOWN 恢复补核心自动化测试。
6. 使用隔离构建产物重新扫描 SonarQube，更新 `PROJECT_AUDIT.md` 的客观指标、问题状态和健康度评分。

## 允许修改范围

- `src/main/java/**`
- `src/main/resources/db/migration/**`
- `src/test/java/**`
- `front/**` 中的源码、`package.json`、`pnpm-lock.yaml`
- `chrome-extension/**` 中的源码与测试
- `sonar-project.properties`
- `PROJECT_AUDIT.md`
- 本任务文件

## 禁止修改范围

- `db/**` 真实数据库及其 WAL/SHM
- `.env*`、Cookie、Token、API Key、浏览器资料
- 真实招聘平台、真实 AI Provider、生产部署与 GitHub PR 合并
- 与六个阶段无关的大规模重构、格式化、Dead Code 删除和依赖 major 升级
- 删除旧运行时兼容逻辑，除非隔离旧库迁移测试已经证明可替代

## 已确定实现要求

- 数据库变更只能通过新的幂等 Flyway 迁移完成；迁移测试必须使用临时 SQLite。
- Profile 校验必须进入数据库写条件，不能只做“先读后写”的前置校验。
- URL 白名单必须使用精确根域或其子域，并要求正确协议。
- 静态资源必须限制在既定静态根目录，拒绝编码后的路径穿越。
- UNKNOWN 不得自动推断为成功或失败；对账与重试必须显式、可审计、使用新的 request key，并保护已确认终态。
- readiness 与 liveness 分离；readiness 不通过实时收费调用探测 Provider。
- Next.js 只升级到官方已修复且兼容静态导出的 16.x 版本；同步 `eslint-config-next` 与 lockfile。
- 测试关注核心失败边界，不以凑覆盖率为目标。
- SonarQube 只使用临时令牌；令牌不得写入项目文件或报告，扫描后撤销。

## 验收标准

- 新库和代表性旧库迁移测试通过，Profile 隔离、唯一约束、删除策略有自动化证据。
- 恶意 lookalike host、非 HTTPS、路径穿越和越权消息被拒绝。
- readiness 能区分 DB/Schema/队列状态；UNKNOWN 可查询、人工对账或显式重试，重复/乱序操作保持幂等。
- `pnpm audit` 不再存在本轮 Next.js 可修的 critical/high 漏洞；lint、typecheck、build 通过。
- 后端全量测试、Chrome 扩展测试和新增集成测试通过。
- SonarQube 扫描成功，`PROJECT_AUDIT.md` 使用新指标并明确剩余风险，不能仅因测试全绿机械给高分。
- `git diff --check` 通过，真实数据库文件指纹不变，工作区无未跟踪临时产物。

## 测试命令

```powershell
.\gradlew.bat clean test jacocoTestReport --console=plain
node --test chrome-extension/tests/*.test.cjs
pnpm --dir front lint
pnpm --dir front typecheck
pnpm --dir front build
pnpm --dir front audit --prod
git diff --check
```

SonarQube 扫描沿用项目现有 `sonar-project.properties` 与机器级共享实例，运行前后只读核对服务状态，不停止或删除共享卷。

## 返回格式

- 六阶段完成状态与剩余风险
- 修改文件、测试结果、SonarQube 新指标和新评分
- 分支、提交、推送、PR 与回滚方式
- 明确说明未执行真实投递、真实 Provider 调用和真实数据库迁移

## 最终验收记录

- 六阶段代码与隔离验证完成；193 个 Java 测试（189 通过、4 跳过）、62 个扩展测试、前端 lint/typecheck/13 页面 build、`pnpm audit --prod` 全部通过。
- 最终 JaCoCo：line 31.03%、branch 22.10%；最终 Sonar 分析 ID `57d5cabe-1069-4099-97e4-4a6f3e9ad593`。
- 完整测试前后，真实 `db/getjobs.db` 的 size/mtime/SHA256 完全一致，证明最终验证没有写库；但其当前指纹与 2026-08-22 基准不同，更早变化来源无法归因，已作为发布前待确认项记录在 `PROJECT_AUDIT.md`。
- 未执行真实投递、真实招聘平台访问、真实 Provider 调用或真实数据库迁移。
