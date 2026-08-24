// Historical migration entrypoint retained only to give old instructions a safe failure.
// Schema changes are managed by backend Flyway migrations. Never overwrite a live SQLite file with sql.js.

console.error(
  '[migrate-sort-order] 已禁用：数据库结构现在只允许由后端 Flyway 管理。' +
  '请停止服务、备份数据库，并通过正式 migration/rehearsal 流程升级。'
)
process.exitCode = 1
