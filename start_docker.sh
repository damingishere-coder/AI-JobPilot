#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_URL="http://localhost:6866"

echo "==============================================="
echo "投递牛马 Docker 一键启动器"
echo "==============================================="
echo "项目目录：$ROOT"
echo "唯一前台页面：$FRONTEND_URL"
echo

if ! command -v docker >/dev/null 2>&1; then
  echo "错误：没有找到 docker 命令。"
  echo "解决办法：请先安装并启动 Docker Desktop。"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "错误：Docker 没有正常运行。"
  echo "解决办法：请打开 Docker Desktop，等 Docker Engine running 后再试。"
  exit 1
fi

cd "$ROOT"
echo "正在执行：docker compose up -d --build"
echo "第一次启动会下载镜像和依赖，可能需要几分钟。"
docker compose up -d --build

echo
echo "启动命令已执行。以后只需要打开：$FRONTEND_URL"
echo "修改前端代码后刷新页面即可看到；修改后端 Java 代码后稍等自动重启，再刷新页面。"
echo "查看日志：docker compose logs -f"
echo "停止项目：docker compose down"

if command -v open >/dev/null 2>&1; then
  open "$FRONTEND_URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$FRONTEND_URL" >/dev/null 2>&1 || true
fi
