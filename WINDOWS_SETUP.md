# Windows 本地运行说明

这份文档面向不熟悉命令行的新手。你可以优先使用一键启动脚本，不需要理解每个技术细节。

## 你需要准备什么

Windows 本机启动需要安装：

- Java 21
- Node.js 20.19 或更高版本
- pnpm
- Chrome 浏览器
- Git

可选：

- Docker Desktop，用于 Docker 一键启动。

当前项目不需要你安装 Python、Maven、Chromedriver 或 ffmpeg。

## 确认项目目录

本项目根目录应该包含这些文件：

```text
README.md
build.gradle.kts
gradlew.bat
start_windows.bat
front
src
chrome-extension
```

你当前项目目录是：

```text
C:\Users\10578\Documents\New project 3\AI-JobPilot
```

后面的命令如果需要手动执行，都在这个目录或它的 `front` 子目录执行。

## 检查环境

打开 PowerShell，在项目根目录执行：

```powershell
java -version
node -v
pnpm -v
git --version
```

这些命令的作用：

- `java -version`：检查 Java 是否安装，版本需要是 21 或更高。
- `node -v`：检查 Node.js 是否安装。
- `pnpm -v`：检查前端包管理工具是否安装。
- `git --version`：检查 Git 是否安装。

成功后你应该看到各自的版本号。

## 安装 pnpm

如果 `pnpm -v` 报错，打开 PowerShell 执行：

```powershell
corepack enable
corepack prepare pnpm@10.20.0 --activate
pnpm -v
```

作用：

- `corepack enable`：打开 Node.js 自带的包管理器管理工具。
- `corepack prepare pnpm@10.20.0 --activate`：安装并启用 pnpm。
- `pnpm -v`：确认安装成功。

成功后你应该看到 `10.20.0` 或更高版本。

## 推荐启动方式：双击脚本

在项目根目录双击：

```text
start_windows.bat
```

它会自动做这些事：

1. 检查 Java。
2. 检查 Gradle Wrapper。
3. 检查 Node.js 和 pnpm。
4. 检查 `front\node_modules` 是否存在。
5. 准备 `db`、`data`、`output`、`logs`、`target\cache` 等目录。
6. 启动后端。
7. 启动前端。
8. 简单检查 8888 和 6866 端口。

启动成功后打开：

```text
http://localhost:6866
```

后端健康检查地址：

```text
http://localhost:8888/api/health
```

如果健康检查成功，你会看到类似：

```json
{"status":"UP","service":"GetJobs"}
```

## 第一次启动前安装前端依赖

如果脚本提示 `front 目录还没有安装依赖`，请在项目根目录执行：

```powershell
cd front
pnpm install
cd ..
```

作用：

- 进入前端目录。
- 下载前端依赖。
- 回到项目根目录。

成功后，`front` 目录里会出现 `node_modules` 文件夹。这个文件夹很大，是本地依赖，不会提交到 Git。

## 手动启动后端

如果你需要手动启动后端，请在项目根目录执行：

```powershell
.\gradlew.bat bootRun
```

作用：

- 用项目自带的 Gradle 启动 Spring Boot 后端。

成功后你应该看到后端启动日志，并且可以打开：

```text
http://localhost:8888/api/health
```

## 手动启动前端

另开一个 PowerShell 窗口，进入前端目录：

```powershell
cd C:\Users\10578\Documents\New project 3\AI-JobPilot\front
pnpm dev
```

作用：

- 启动 Next.js 前端开发服务。

成功后你应该看到前端监听 `127.0.0.1:6866`，然后打开：

```text
http://localhost:6866
```

## Chrome 扩展加载

Boss 和智联建议使用 Chrome Bridge。

步骤：

1. 打开 Chrome。
2. 地址栏输入 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择：

```text
C:\Users\10578\Documents\New project 3\AI-JobPilot\chrome-extension
```

6. 回到 `http://localhost:6866` 并刷新页面。

成功后，Boss 或智联页面会显示扩展连接状态正常。

## `.env` 怎么用

Windows 本机普通使用不一定需要 `.env`。

建议：

- 先用 `start_windows.bat` 启动。
- 再在网页端填写环境配置和 AI 配置。
- 只有需要自定义数据库、日志、浏览器目录时，再复制 `.env.example` 为 `.env`。

不要提交真实 `.env`。里面可能包含 API Key、路径、账号相关信息。

## 常见报错

### Java 版本低

现象：

```text
当前 Java 版本低于 21
```

原因：电脑安装的 Java 太旧。

解决：安装 Java 21，重新打开 PowerShell，再执行：

```powershell
java -version
```

成功后应看到 `21` 或更高版本。

### pnpm 不存在

现象：

```text
没有找到 pnpm
```

解决：

```powershell
corepack enable
corepack prepare pnpm@10.20.0 --activate
pnpm -v
```

### 前端依赖不存在

现象：

```text
front 目录还没有安装依赖
```

解决：

```powershell
cd front
pnpm install
cd ..
```

### 端口被占用

现象：6866 或 8888 启动失败。

解决，在项目根目录执行：

```powershell
.\bin\kill-services.bat
```

作用：结束占用前端和后端端口的本机进程，并清理 Next.js 开发锁。

### PowerShell 禁止运行脚本

可以直接双击：

```text
start_windows.bat
```

它会用安全的临时方式运行 PowerShell 脚本。

如果必须手动执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start_windows.ps1
```

### 中文路径或乱码

项目启动脚本会设置 UTF-8。建议：

- 使用 `start_windows.bat`。
- 不要把项目放到没有权限的系统目录。
- 优先放在 `Documents` 这类用户目录。

### Chrome Bridge 无响应

检查：

- 扩展是否已加载。
- 前端地址是否是 `http://localhost:6866` 或 `http://127.0.0.1:6866`。
- 是否刷新过前端页面。
- 招聘平台页面是否已登录。

## 如何验证部署成功

按顺序检查：

1. 打开 `http://localhost:6866`，能看到投递牛马页面。
2. 打开 `http://localhost:8888/api/health`，能看到 `UP`。
3. 首页或侧边栏后端连接状态正常。
4. AI 配置页可以保存配置。
5. Chrome 扩展加载后，Boss 或智联页面扩展连接状态正常。
6. 运行 `.\gradlew.bat test` 可以通过。
7. 在 `front` 目录运行 `pnpm lint` 没有 error。

## 停止项目

在项目根目录执行：

```powershell
.\bin\kill-services.bat
```

作用：停止常用前后端端口上的服务。
