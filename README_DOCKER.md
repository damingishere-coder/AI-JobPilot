# Docker 本地开发启动说明

这个项目是 **Spring Boot + Next.js + Playwright Java**。当前 `docker-compose.yml` 默认按本地开发模式运行：

- `backend`：挂载当前项目目录，运行 `./gradlew bootRun`
- `frontend`：挂载当前项目目录，运行 `next dev`
- 数据库、日志、输出文件都直接使用宿主机项目目录

这样改前端代码后刷新页面即可看到变化；改后端 Java 代码后重启 `backend` 服务即可用当前源码重新编译运行。

## 启动

```bash
cd "/Users/hyunl/Get job/get_jobs-1.0.0"
docker compose up -d --build
```

访问地址：

- 前端页面：`http://localhost:6866`
- 后端健康检查：`http://localhost:8888/api/health`
- 后端 API：`http://localhost:8888`

首次启动会下载前端依赖，比较慢；后端会复用宿主机的 `~/.gradle` 缓存，避免容器每次重新下载 Gradle。

## 修改代码后的更新方式

前端代码，例如 `front/app/**`：

```bash
# 一般不需要命令，保存文件后刷新浏览器即可
```

后端代码，例如 `src/main/java/**`：

```bash
docker compose restart backend
```

依赖、Dockerfile、Compose 配置变更：

```bash
docker compose up -d --build
```

只执行 `docker compose restart` 不会重新构建镜像。之前页面不更新，就是因为旧配置把代码打包进 jar/静态文件，重启仍然跑旧镜像里的内容。

## 常用命令

查看日志：

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

停止：

```bash
docker compose down
```

清理依赖缓存 volume 后重新启动：

```bash
docker compose down -v
docker compose up -d --build
```

## 环境变量

可以复制模板：

```bash
cp .env.example .env
```

默认值：

- `BACKEND_PORT=8888`
- `FRONTEND_PORT=6866`
- `SPRING_DATASOURCE_URL=jdbc:sqlite:/workspace/db/getjobs.db`
- `LOGGING_FILE_NAME=/workspace/logs/get-jobs.log`
- `APP_AUTO_OPEN_BROWSER=false`

如果容器内要访问宿主机 Ollama，使用：

```env
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

## 挂载与缓存

Compose 会挂载整个项目：

```text
.:/workspace
```

所以容器看到的就是你本机最新代码。同时复用/缓存依赖：

- `${HOME}/.gradle:/root/.gradle`
- `pnpm-store`
- `front-node-modules`
- `front-next-cache`

这些缓存不会污染宿主机项目目录里的源码，也避免每次启动重新安装依赖。

## 生产镜像

`Dockerfile` 仍保留生产构建阶段，会把前端静态资源和后端 jar 打包到镜像里。这个模式适合发布，但不适合边改代码边刷新。

本地开发请优先使用当前 `docker compose up -d --build`。
