# Docker 一键本地开发说明

这个方式适合不想分别安装 Java、Node.js、pnpm 的本地开发场景。你只需要安装 Docker Desktop，然后用一键脚本启动项目。

启动成功后，只需要记住一个前台页面地址：

```text
http://localhost:6866
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
http://localhost:6866
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
保存文件后，刷新 http://localhost:6866 即可看到。
```

后端 Java 代码，例如 `src/main/java/**`：

```text
容器会自动连续编译并触发 Spring Boot DevTools 重启。
等待几秒后刷新 http://localhost:6866 查看。
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
5. 选择项目里的 `chrome-extension` 文件夹。
6. 打开 `http://localhost:6866`，刷新页面。

扩展会通过 `http://localhost:6866/api/...` 回写结果，由前端开发服务代理到后端容器。

## 端口说明

你日常只需要打开：

```text
http://localhost:6866
```

Docker 仍会在本机保留后端端口：

```text
http://localhost:8888
```

这个端口主要用于排查问题和兼容老流程；普通使用不需要打开它。

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

如果还是不行，修改 `.env`：

```env
FRONTEND_PORT=6867
```

然后重新执行：

```bash
docker compose up -d --build
```

### 页面打开但后端连接失败

处理：

```bash
docker compose logs -f backend
```

如果是首次启动，请再等一会儿。后端第一次下载 Gradle 依赖会比较慢。

### 修改代码后页面没有变化

前端代码：确认保存文件后刷新 `http://localhost:6866`。

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
