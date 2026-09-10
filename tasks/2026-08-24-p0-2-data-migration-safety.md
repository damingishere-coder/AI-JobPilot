# P0.2 数据一致性与迁移止血

## 背景

审计确认项目同时依赖 Flyway、`DatabaseSchemaService`、平台 Service 和手工 `sql.js` 脚本修改 Schema。部分异常只记录 warning 后继续，Boss 刷新与 Worker 还可能在线重建 `boss_data`。旧的非空数据库若没有 Flyway 历史，会被 baseline 到 v4，可能跳过 V1-V4 并遗留缺表、缺列或缺索引。

当前 `db/getjobs.db` 只读画像显示：V1-V4 均成功、`integrity_check=ok`、无 WAL/SHM、未发现已检查的重复/孤儿数据。该结果仅说明当前库尚未损坏，不代表现有迁移机制安全。

## 目标

1. 以一次性 Flyway V5 兼容迁移收敛旧库缺失的表、列和索引。
2. Flyway 完成后，应用启动阶段只读校验 Schema；缺失时阻止启动，不再静默带病运行。
3. 禁止普通 API、Worker prepare 和平台 Service 初始化执行 DROP/重建/补列。
4. 禁用会整文件覆盖 SQLite 且不处理 WAL/SHM 的旧手工迁移脚本。
5. 在临时数据库和当前数据库隔离副本上验证迁移前后行数与完整性。

## 允许修改范围

- `src/main/resources/db/migration/` 与对应 Java migration。
- `DatabaseSchemaService` 的迁移/校验职责边界。
- Boss、猎聘、51job、智联中与运行时 DDL 直接相关的调用。
- 旧手工迁移脚本的安全禁用提示。
- 隔离数据库迁移测试、任务文档与数据库说明。

## 禁止修改范围

- 不写入、迁移、覆盖或删除 `db/getjobs.db`。
- 不新增业务 UNIQUE/FK、不清洗历史重复数据、不改写已有的非空 Profile 归属；仅沿用旧迁移对 NULL `profile_id` 的兼容回填。
- 不修改投递、AI、Provider、Cookie 或平台采集业务逻辑。
- 不进行真实招聘平台、Webhook 或计费 AI 调用。
- 不删除旧数据库字段；本轮只保证兼容和停止在线 destructive DDL。

## 已确定实现要求

- V5 对 fresh DB、已有 V1-V4 DB、非空无历史旧库均可执行。
- V5 必须在 Flyway 事务内工作；`priority_company` 重建前后校验行数，不使用 `INSERT OR IGNORE` 静默丢数据。
- V5 补齐 V1/V4 缺表、运行时漂移列和 V2/V4 索引。
- 启动 Schema 校验必须验证关键表、关键列、关键索引；失败抛异常阻止启动。
- Boss reload 只做只读计数，不再重建表、checkpoint 或 VACUUM。
- 平台 Service 不再在 `@PostConstruct` 中执行 DDL。
- 原库 rehearsal 必须先复制到测试临时目录，且源库存在 WAL/SHM/journal 时拒绝复制。

## 验收标准

- fresh SQLite 从 V1-V5 初始化成功。
- 无 Flyway 历史的旧 schema 被 baseline v4 后执行 V5，补齐缺失对象并保留原行数。
- 当前 `db/getjobs.db` 的隔离副本执行 V5 后 `integrity_check=ok`，关键表行数不减少，原库时间戳/hash 不变。
- 任一关键表、列或索引缺失时，Schema 校验明确失败。
- 源码中不再存在从 Boss reload/Worker prepare、Liepin/51job `@PostConstruct` 触发的 DROP/ALTER/CREATE。
- 完整后端测试、前端 lint/typecheck/build 与扩展测试通过。

## 测试命令

```powershell
.\gradlew.bat test
$env:P0_REHEARSAL_DB = (Resolve-Path db/getjobs.db).Path
.\gradlew.bat test --tests com.getjobs.application.service.DatabaseMigrationRehearsalTest
Remove-Item Env:P0_REHEARSAL_DB
pnpm --dir front lint
pnpm --dir front typecheck
pnpm --dir front build
$extensionTests = Get-ChildItem chrome-extension/tests/*.test.cjs | ForEach-Object { $_.FullName }
node --test $extensionTests
```

## 返回格式

- 迁移对象、职责变化和兼容边界。
- fresh/legacy/真实副本的版本、完整性与行数对账结果。
- 原库未修改的 hash/mtime 证据。
- 测试、diff、Commit、Push 与 PR 状态。
