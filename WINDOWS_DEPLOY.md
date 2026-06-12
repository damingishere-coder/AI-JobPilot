# Windows 本地部署说明

这份文档面向编程新手。你可以选择两种启动方式：

1. 推荐：Docker 一键启动，只需要打开 `http://localhost:6866`。
2. 备用：本机直接启动，需要安装 Java 21、Node.js、pnpm。

## 方式一：Docker 一键启动（推荐）

### 需要安装

1. Docker Desktop
2. Chrome 浏览器
3. Git，只有第一次下载项目时需要

Docker 方式不需要你手动安装 Java、Node.js、pnpm。

### 怎么启动

在项目根目录双击：

```text
start_docker.bat
```

启动成功后，只打开这个前台页面：

```text
http://localhost:6866
```

以后修改前端代码，刷新这个页面即可看到。修改后端 Java 代码后，容器会自动编译并触发后端重启，稍等几秒后刷新页面。

### 常用 Docker 命令

查看日志：

```powershell
docker compose logs -f
```

停止项目：

```powershell
docker compose down
```

重新构建：

```powershell
docker compose up -d --build
```

## 方式二：Windows 本机直接启动

### 需要安装

1. Java 21
2. Node.js LTS
3. pnpm
4. Chrome 浏览器
5. Git

当前项目没有发现 Python 脚本，不需要安装 Python。

当前项目没有发现 ffmpeg 使用点，不需要安装 ffmpeg。

### 怎么确认安装成功

打开 PowerShell，分别执行：

```powershell
java -version
node -v
pnpm -v
git --version
```

成功时你会看到对应版本号。Java 版本需要是 21 或更高。

### 下载项目

如果你还没有项目代码，可以在想保存项目的目录执行：

```powershell
git clone https://github.com/damingishere-coder/AI-JobPilot.git
```

然后进入项目目录。

### 安装前端依赖

在项目根目录执行：

```powershell
cd front
pnpm install
cd ..
```

执行成功后，`front` 目录下会出现 `node_modules` 文件夹。

### 一键启动

在项目根目录双击：

```text
start_windows.bat
```

也可以在 PowerShell 执行：

```powershell
.\start_windows.ps1
```

启动成功后访问：

```text
前端：http://localhost:6866
后端：http://localhost:8888
```

日常使用建议只打开前端页面。

## 配置说明

默认配置在：

```text
src/main/resources/application.yaml
```

也可以复制 `.env.example` 为 `.env` 后按需填写。不要把真实账号、密码、Cookie、Token、API Key 提交到 Git。

Windows 示例路径：

```env
APP_DATA_DIR=C:\Users\YourName\Documents\AI-JobPilot\data
APP_OUTPUT_DIR=C:\Users\YourName\Documents\AI-JobPilot\output
APP_LOG_DIR=C:\Users\YourName\Documents\AI-JobPilot\logs
APP_BROWSER_USER_DATA_DIR=C:\Users\YourName\AppData\Local\AI-JobPilot\chrome-profile
APP_BROWSER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
SPRING_DATASOURCE_URL=jdbc:sqlite:C:\Users\YourName\Documents\AI-JobPilot\db\getjobs.db
LOGGING_FILE_NAME=C:\Users\YourName\Documents\AI-JobPilot\logs\get-jobs.log
```

macOS 示例路径：

```env
APP_DATA_DIR=/Users/YourName/Documents/AI-JobPilot/data
APP_OUTPUT_DIR=/Users/YourName/Documents/AI-JobPilot/output
APP_LOG_DIR=/Users/YourName/Documents/AI-JobPilot/logs
APP_BROWSER_USER_DATA_DIR=/Users/YourName/Library/Application Support/AI-JobPilot/chrome-profile
APP_BROWSER_EXECUTABLE_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
SPRING_DATASOURCE_URL=jdbc:sqlite:/Users/YourName/Documents/AI-JobPilot/db/getjobs.db
LOGGING_FILE_NAME=/Users/YourName/Documents/AI-JobPilot/logs/get-jobs.log
```

## Chrome Extension 加载

1. 打开 Chrome。
2. 地址栏输入 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择项目里的 `chrome-extension` 文件夹。
6. 打开 `http://localhost:6866` 并刷新页面。

## 常见报错处理

### 端口被占用

现象：启动失败，提示 6866 或 8888 已被占用。

处理：

```powershell
.\bin\kill-services.bat
```

然后重新启动。

### Java 版本不对

现象：脚本提示 Java 版本低于 21。

处理：安装 Java 21，然后重新打开 PowerShell，执行 `java -version` 检查。

### pnpm 未安装

处理：

```powershell
corepack enable
corepack prepare pnpm@10.20.0 --activate
pnpm -v
```

### Chrome 找不到

如果 Playwright 找不到浏览器，可以先执行：

```powershell
.\gradlew.bat playwright install chromium
```

如果想使用本机 Chrome，在 `.env` 或系统环境变量中配置：

```env
APP_BROWSER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

### 数据库文件无法创建

通常是目录不存在或没有权限。项目启动时会自动创建 `db`、`data`、`output`、`logs` 等目录。  
如果仍失败，请把项目放到你有权限的目录，例如：

```text
C:\Users\YourName\Documents\AI-JobPilot
```

### 中文路径乱码

本项目已经设置 UTF-8 读写和启动编码。建议使用 `start_windows.bat` 或 Docker 方式启动。

### PowerShell 禁止运行脚本

可以双击 `start_windows.bat`，它会用安全的临时方式绕过脚本限制。  
如果手动运行，可以执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start_windows.ps1
```

## 如何判断启动成功

打开：

```text
http://localhost:6866
```

如果能看到投递牛马页面，说明前端成功。

页面里后端连接状态正常，或打开：

```text
http://localhost:8888/api/health
```

能看到健康检查返回，说明后端成功。
