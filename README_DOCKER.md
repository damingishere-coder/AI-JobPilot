# Docker 一键本地开发说明

本文是进阶 Docker 开发路径。Windows 日常使用优先阅读 [统一服务启动指南](WINDOWS_SETUP.md)。Docker Compose 保留前端 6866、后端 8888 的分离模式，不能与 Windows 统一服务同时占用 6866。

容器镜像提供 Java、Node.js、pnpm。当前 Docker 路径尚未完成 v1.5 真实运行验收：Dockerfile 沿用 Playwright 1.51.0 的 Node 基础镜像，完整测试依赖已要求更新的 Node（CI 使用 24）。本指南不把 Docker 视为已验证的免环境安装器；遇到运行时版本问题应先核验容器环境。文件识别所需的 Python、Docling 和模型也未由 Dockerfile 自动安装，基础使用请粘贴简历文本。

启动成功后，只需要记住一个前台页面地址：

```text
http://127.0.0.1:6866
```

前端页面、Chrome 扩展回调、前端 API 请求都走这个地址。Docker 内部会自动把 `/api` 请求转发到后端服务。

## 需要先安装什么

1. Docker Desktop
2. Chrome 浏览器
3. Git，只有第一次下载项目时需要

不需要手动安装 Java、Node.js、pnpm。它们会在 Docker 镜像里准备好。

## Windows 一键启动

在项目根目录双击：

```text
start_docker.bat
```

它会自动执行：

```powershell
docker compose up -d --build
```

第一次启动会下载 Docker 镜像和前端依赖，时间可能比较久。启动完成后脚本会打开：

```text
http://127.0.0.1:6866
```

## macOS / Linux 一键启动

在项目根目录执行：

```bash
./start_docker.sh
```

如果提示没有执行权限，执行一次：

```bash
chmod +x start_docker.sh
./start_docker.sh
```

## 修改代码后怎么查看

前端代码，例如 `front/app/**`、`front/components/**`：

```text
保存文件后，刷新 http://127.0.0.1:6866 即可看到。
```

后端 Java 代码，例如 `src/main/java/**`：

```text
容器会自动连续编译并触发 Spring Boot DevTools 重启。
等待几秒后刷新 http://127.0.0.1:6866 查看。
```

如果后端变化较大，自动重启没有生效，可以手动执行：

```bash
docker compose restart backend
```

如果改了依赖、Dockerfile 或 `docker-compose.yml`：

```bash
docker compose up -d --build
```

## 常用命令

查看全部日志：

```bash
docker compose logs -f
```

只看后端日志：

```bash
docker compose logs -f backend
```

只看前端日志：

```bash
docker compose logs -f frontend
```

停止项目：

```bash
docker compose down
```

彻底清理容器依赖缓存后重新启动：

```bash
docker compose down -v
docker compose up -d --build
```

## Chrome Extension 加载

1. 打开 Chrome。
2. 地址栏输入 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择项目里的 `chrome-extension` 文件夹；v1.5 配套版本为 1.8.0，更新后重新加载扩展。
6. 打开 `http://127.0.0.1:6866`，刷新页面。

扩展会通过 `http://127.0.0.1:6866/api/...` 回写结果，由前端开发服务代理到后端容器。

## 端口说明

你日常只需要打开：

```text
http://127.0.0.1:6866
```

Docker 仍会在本机保留后端端口：

```text
http://127.0.0.1:8888
```

这是 Docker 后端映射到本机的端口，普通浏览器使用无需直接访问；容器内的前端通过 `backend:8888` 转发 API 请求。

## 常见问题

### Docker 未启动

现象：脚本提示 Docker 没有正常运行。

处理：打开 Docker Desktop，等它显示 Docker Engine running 后再双击 `start_docker.bat`。

### 6866 端口被占用

现象：前端启动失败，日志里提示端口占用。

处理：先停止旧服务：

```bash
docker compose down
```

如果仍然冲突，先确认端口归属，并在原管理器中停止对应的旧服务。不要随意改成 6867：Chrome Bridge 的工作台来源仅允许 6866，启动脚本的检查地址也不会自动同步。

### 页面打开但后端连接失败

处理：

```bash
docker compose logs -f backend
```

如果是首次启动，请再等一会儿。后端第一次下载 Gradle 依赖会比较慢。

### 修改代码后页面没有变化

前端代码：确认保存文件后刷新 `http://127.0.0.1:6866`。

后端代码：等待后端自动重启；如果仍不生效，执行：

```bash
docker compose restart backend
```

### 需要重新安装依赖

执行：

```bash
docker compose down -v
docker compose up -d --build
```

这会清理 Docker 的依赖缓存卷，然后重新安装。
