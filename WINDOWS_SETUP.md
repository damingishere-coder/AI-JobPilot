# Windows 本地运行指南 · 1.5

应用版本 **1.5.0**，配套 Chrome Bridge **1.8.0**。普通使用只需要记住 **http://127.0.0.1:6866**，页面和 API 共用一个服务。

## 1. 准备环境

安装 Java 21、Node.js 24 LTS、Chrome 和 Git。Node 24 是当前 CI 使用的版本；旧文档的 Node 20.19 不再适合作为完整开发与测试环境。

打开 PowerShell 检查：

```powershell
java -version
node -v
git --version
```

安装项目使用的 pnpm：

```powershell
npm install --global pnpm@10.20.0
pnpm -v
```

输出应为 `10.20.0`。如果已经使用 Corepack 管理 pnpm，可以继续使用自己的安装方式。

**粘贴简历文本不需要 Python。** 如果要上传 PDF、Word 或图片文件进行本机识别，还需要准备 Python 与本地解析器，见下面第 5 步。无需单独安装 Maven、Chromedriver 或 ffmpeg。

## 2. 获取项目并安装依赖

在你希望保存项目的目录打开 PowerShell：

```powershell
git clone --branch v1.5.0 --depth 1 https://github.com/damingishere-coder/AI-JobPilot.git
cd AI-JobPilot
cd front
pnpm install --frozen-lockfile
cd ..
```

也可以下载 [v1.5.0 的 source.zip](https://github.com/damingishere-coder/AI-JobPilot/releases/tag/v1.5.0)，解压后在项目根目录执行相同的依赖安装命令。根目录应包含 `gradlew.bat`、`start_windows.bat`、`front`、`src` 和 `chrome-extension`。

后面的相对路径都以这个项目根目录为起点，不需要照抄其他人的电脑路径。

## 3. 启动统一服务

双击 `start_windows.bat`，或执行：

```powershell
.\start_windows.bat
```

启动器检查环境和已安装的前端依赖，准备本地目录，然后通过 `scripts/run_backend.ps1` 构建静态前端并启动 Java 服务。**它不会自动安装缺失的前端依赖，也不再同时启动独立 Frontend。** 首次 Gradle 下载和构建可能较慢，请看启动输出。

在 Chrome 打开：

- 页面：**http://127.0.0.1:6866**
- 就绪检查：**http://127.0.0.1:6866/api/ready**
- 基础健康检查：**http://127.0.0.1:6866/api/health**

`/api/ready` 中 `ready: true` 表示应用就绪；只有页面打开或 `/api/health` 返回 `UP`，还不能证明模型、简历和扩展均已配置成功。

### 使用 RunDock / Alter 托管

已有托管服务时，沿用原有服务记录、运行目录和数据路径。不要另建一个相同端口的服务。

新配置时只托管一个统一 Backend：

| 字段 | 内容 |
| --- | --- |
| 程序 | `powershell.exe` |
| 参数 | `-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<项目目录>\scripts\run_backend.ps1"` |
| 工作目录 | 你的项目根目录 |
| 健康检查 | `http://127.0.0.1:6866/api/ready` |

将 `<项目目录>` 换成真实路径。不要把交互式 `start_windows.bat` 作为托管入口，也不要同时托管 `run_frontend.ps1`；两者会争用 6866。修改前端源码后需要重新构建并重启该统一服务。需要热更新的开发者使用 [开发指南](docs/development/setup.md) 的独立双端口模式。

## 4. 加载 Chrome Bridge

1. 在 Chrome 地址栏输入 `chrome://extensions/`。
2. 开启「开发者模式」，点击「加载已解压的扩展程序」。
3. 选择项目的 `chrome-extension` 文件夹，确认版本为 **1.8.0**。
4. 在 Chrome 打开 `http://127.0.0.1:6866`，刷新工作台。
5. 登录 BOSS 或智联，回到工作台检查扩展与平台状态。

更新扩展文件后，需要在扩展管理页点击「重新加载」，再刷新工作台和招聘平台标签页。仅替换文件不会自动更新浏览器已加载的扩展。请使用 `127.0.0.1`，不要混用 `localhost`、局域网 IP 或其他端口。

## 5. 保存资料，开始第一次分析

1. 在「环境配置」填写你使用的模型服务连接信息。
2. 在「AI配置」新建或选择档案，粘贴简历文本，写清目标方向及不考虑的岗位。
3. 核对后保存简历与 AI 配置。涉及生成配置或岗位分析时，会调用你配置的模型服务。
4. 进入 BOSS 或智联，设置关键词、城市等筛选条件。
5. 先运行一轮采集，在分析页查看匹配依据、风险和待确认岗位。
6. 确认岗位与最终沟通语之后，再执行实际投递。

默认模型通路是本机 Codex，使用当前 Windows 用户已经登录的 Codex / ChatGPT 环境；请确认配置的可执行路径可用。也可以在产品设置里显式选择远程 API，并提供自己的服务地址、模型和密钥。这里不会自动安装、登录或替你切换模型服务。

详见 [任务流程](TASK_FLOW.md)。模型服务可能收费，数据本地存储并不意味着不会向该模型发送分析所需的简历和岗位内容。

### 可选：上传文件并在本机识别

先安装可供解析器使用的 Python，然后在项目根目录执行：

```powershell
.\resume-parser\setup.ps1
```

该脚本创建隔离的 `.venv`，安装依赖，并联网下载模型到 `.resume-models`；正式解析时使用本地模型。界面支持 PDF、DOC/DOCX、TXT 和常见图片，单文件不超过 30 MB；默认最多解析 10 页。旧 `.doc` 另需 LibreOffice。

上传后先核对识别预览，再确认保存；失败时可以直接粘贴文本继续。完整说明见 [本地简历识别器](resume-parser/README.md)。

## 6. 常见问题

### 提示前端依赖尚未安装

在项目根目录执行：

```powershell
cd front
pnpm install --frozen-lockfile
cd ..
.\start_windows.bat
```

### Node 版本或依赖安装报错

先执行 `node -v` 和 `pnpm -v`，确认 Node 24、pnpm 10.20.0，然后重新运行锁定依赖安装。网络失败时保留完整错误；不要删除锁文件来绕过依赖约束。

### 6866 端口被占用

先确认是不是已有 AI JobPilot 服务。只读查看监听进程：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 6866 | Select-Object LocalAddress,LocalPort,OwningProcess
```

若是已有实例，直接访问它；需要更新时在原 RunDock / Alter 记录中停止再启动。若属于其他程序，先核对其用途，不要直接批量杀进程。

### 页面存在，但扩展未连接

检查是否使用 Chrome、扩展是否启用且为 1.8.0、页面是否为 `http://127.0.0.1:6866`。重新加载扩展并刷新两个页面；登录或验证提示需要在官网处理。

### PowerShell 禁止执行脚本

可以双击 `start_windows.bat`。手动启动可使用仅对当前进程生效的方式：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start_windows.ps1
```

### 资料或配置在哪里

默认数据库为 `db/getjobs.db`，还可能有 `data`、`output`、`chrome-profile`、`target/logs` 等本地目录。已有托管服务可能通过环境变量使用其他路径，备份前先核对实际配置。

Windows 启动脚本不会因为根目录放了 `.env` 就自动读取它。普通使用先通过页面配置；定制路径使用启动进程的环境变量。`.env` 主要由 Docker Compose 读取。不要上传任何真实配置、数据库或简历。

## 7. 验证、停止与升级

- 确认页面左下角显示 `v1.5.0`，`/api/ready` 返回就绪。
- 确认当前档案、已保存简历与模型配置正确；Chrome Bridge 显示 1.8.0。
- 查看一次采集与分析过程及待确认记录；是否对外投递由你决定，测试通过不代表真实平台投递成功。
- 托管服务在原管理器里停止；前台直接运行 `run_backend.ps1` 时在对应终端按 `Ctrl+C`。双击启动的实例应先辨认其 Java 进程和日志，不要用批量端口清理脚本代替进程归属检查。

升级前先停止写入，备份实际 SQLite 数据库、配置和旧程序。SQLite 正在运行时请使用一致性备份方式，不要只复制主文件而忽略 WAL。1.5 新增 V20 数据表，回滚不能用旧数据库覆盖升级后的新记录，详见 [1.5 发布与回滚](docs/releases/v1.5.0.md)。
