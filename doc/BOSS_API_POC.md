# Boss 岗位搜索 API 采集 POC：Windows 人工验证

本功能只在你主动点击“测试 Boss API POC”后运行一次。它只读取一个关键词、一个城市、第一页，最多 10 条岗位；不会自动翻页、自动投递、绕过验证码或启动独立 Chrome。

本功能已经合入主项目。下文用 `<项目目录>` 表示你保存或克隆 `AI-JobPilot` 的目录，例如：

```text
C:\path\to\AI-JobPilot
```

## 1. 重新加载 Chrome 扩展

1. 在 Chrome 地址栏输入 `chrome://extensions/` 并回车。
2. 打开右上角“开发者模式”。
3. 如果还没有加载主项目扩展，点击“加载已解压的扩展程序”。
4. 选择下面这个文件夹：

```text
C:\path\to\AI-JobPilot\chrome-extension
```

5. 找到“投递牛马 Chrome Bridge”，点击卡片上的“重新加载”按钮。
6. 刷新已经打开的 Boss 页面和 `http://localhost:6866/boss` 页面。

成功后，扩展版本应为 `1.3.0`。如果出现“扩展上下文已失效”，再刷新一次 Boss 和投递牛马页面。

## 2. 启动投递牛马

最简单的方法是在资源管理器中打开下面目录，然后双击 `start_windows.bat`：

```text
C:\path\to\AI-JobPilot
```

也可以使用 PowerShell：

- 执行目录：`<项目目录>`
- 完整命令：

```powershell
.\start_windows.bat
```

- 作用：检查 Java、Node.js、pnpm 和前端依赖，然后启动前端与后端。
- 成功现象：窗口提示前端 `http://localhost:6866`、后端 `http://localhost:8888`；稍等后 6866 和 8888 端口都显示已监听。

如果提示 `front\node_modules` 不存在，请在下面目录安装前端依赖：

- 执行目录：`<项目目录>\front`
- 完整命令：

```powershell
pnpm install
```

- 作用：安装前端依赖，不会修改业务数据。
- 成功现象：命令最后没有红色 error，并出现 `front\node_modules` 文件夹。安装完成后重新运行 `start_windows.bat`。

## 3. 打开 Boss 搜索页

在正常使用的 Chrome 中打开一个 Boss 搜索结果页，例如：

[https://www.zhipin.com/web/geek/job?city=101280600&query=Java](https://www.zhipin.com/web/geek/job?city=101280600&query=Java)

这个示例表示“Java + 深圳”。投递牛马页面中配置的关键词和城市必须与准备测试的内容一致，并且只能填写一个关键词、一个明确城市。

## 4. 确认已经登录

在 Boss 页面确认：

- 页面右上角能看到头像或个人中心入口；
- 页面没有要求手机号登录、扫码登录；
- 页面没有验证码、滑块或“安全验证”提示；
- 搜索结果区域能正常显示岗位。

然后打开 `http://localhost:6866/boss`，先点击“诊断当前 Boss 页面”。成功时日志应显示页面可采集，`isLoginPage=false`、`isSecurityPage=false`。

## 5. 点击 API POC

1. 在投递牛马 Boss 配置页填写恰好一个关键词。
2. 选择一个具体城市，不能选择“不限”。
3. 确认已经创建并选中简历档案。
4. 确认完整扫描没有运行。
5. 点击页面顶部的“测试 Boss API POC”。

按钮只会请求第一页，`pageSize` 取当前岗位上限与 10 的较小值。

## 6. 成功时应看到什么

正常成功时，运行日志会出现：

```text
API_SUCCESS
collectorSource=boss-search-api
fallbackUsed=false
```

后面还会显示 `candidateCount`、`saved` 和 `listCollected`。API 岗位的内部标记为：

```text
source=boss-search-api
salarySource=api
```

岗位按 `LIST_COLLECTED` 入库，不进入 AI 分析，也不会自动投递。

如果 API 返回岗位但个别岗位没有 `salaryDesc`，日志会显示 `API_SALARY_MISSING` 和缺失数量。缺薪岗位仍会入库，但薪资保持空值，不会使用 DOM 薪资冒充 API 明文薪资。

## 7. code 37 时应看到什么

如果 Boss 接口返回 `code=37`，日志会显示：

```text
API_CODE_37
```

本次 POC 会立即停止，不自动重试，也不会尝试点击卡片或处理验证。请回到 Boss 页面查看是否出现登录失效或安全验证，并按 Boss 页面要求手动处理。

## 8. 查看扩展日志

内容脚本日志：

1. 保持 Boss 页面为当前页面。
2. 按 `F12` 打开开发者工具。
3. 切换到“Console/控制台”。
4. 搜索 `GetJobs` 或 `Boss API POC`。

后台日志：

1. 打开 `chrome://extensions/`。
2. 找到“投递牛马 Chrome Bridge”。
3. 点击“Service Worker”旁边的“检查视图”。
4. 在弹出的 Console 中查看日志。

日志不会输出 Cookie、Token、`securityId` 或完整原始响应。

## 9. 查看后端日志

后端启动日志位于：

```text
<项目目录>\logs\windows-backend.log
```

Spring Boot 文件日志位于：

```text
<项目目录>\target\logs\get-jobs.log
```

可以直接用记事本打开。也可以实时查看：

- 执行目录：`<项目目录>`
- 完整命令：

```powershell
Get-Content -LiteralPath ".\logs\windows-backend.log" -Wait
```

- 作用：持续显示新增后端日志；按 `Ctrl+C` 停止查看，不会停止投递牛马。
- 成功现象：点击 POC 后能看到“Chrome已采集到”或 `LIST_COLLECTED` 相关信息。

## 10. 确认岗位已经进入 SQLite

先在投递牛马 Boss 岗位列表中查看最新记录，状态应为 `LIST_COLLECTED`。该列表由后端直接读取 SQLite。

如需直接读取数据库，请使用下面的只读 Node 命令：

- 执行目录：`<项目目录>`
- 完整命令：

```powershell
node -e "const fs=require('node:fs'); const init=require('./front/node_modules/sql.js'); init().then(SQL=>{const db=new SQL.Database(fs.readFileSync('./db/getjobs.db')); console.log(JSON.stringify(db.exec('SELECT id, company_name, job_name, salary, delivery_status, created_at FROM boss_data ORDER BY id DESC LIMIT 10'),null,2)); db.close();})"
```

- 作用：只读打开 `db\getjobs.db`，显示 `boss_data` 最新 10 条岗位，不会修改数据库。
- 成功现象：输出 JSON，其中能看到刚才采集的公司、岗位、薪资，以及 `LIST_COLLECTED` 状态。

## 已知风险和下一轮判断

- Boss 搜索接口属于站内接口，路径、字段和诊断 code 可能变化。
- POC 依赖当前 Chrome 中有效的 Boss 登录态，出现验证时必须手动处理。
- `source`、`salarySource`、`securityId`、`lid` 等 POC 元数据本轮不会新增 SQLite 列；核心岗位字段仍正常入库。
- DOM 降级薪资统一标记为 `dom_untrusted`，不能与 API 明文薪资视为同等可信。

只有在多次手工测试中稳定获得 `API_SUCCESS`、薪资字段完整，并且没有频繁触发 code 37 或安全验证后，才适合下一轮接入完整扫描。
