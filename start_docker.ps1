$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host "==============================================="
    Write-Host $Text
    Write-Host "==============================================="
}

function Fail-WithHelp {
    param([string]$Message, [string]$Fix)
    Write-Host ""
    Write-Host "错误：$Message" -ForegroundColor Red
    Write-Host "解决办法：$Fix" -ForegroundColor Yellow
    exit 1
}

function Test-CommandExists {
    param([string]$CommandName)
    return $null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Test-PortOpen {
    param([int]$Port)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        $ok = $async.AsyncWaitHandle.WaitOne(1000, $false)
        if ($ok) {
            $client.EndConnect($async)
        }
        $client.Close()
        return $ok
    } catch {
        return $false
    }
}

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendUrl = "http://localhost:6866"

Write-Section "投递牛马 Docker 一键启动器"
Write-Host "项目目录：$ProjectRoot"
Write-Host "唯一前台页面：$FrontendUrl"

Write-Section "1. 检查 Docker"
if (-not (Test-CommandExists "docker")) {
    Fail-WithHelp "没有找到 docker 命令。" "请先安装并启动 Docker Desktop。安装成功后重新打开 PowerShell，执行 docker --version 应看到版本号。"
}

try {
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail-WithHelp "Docker 没有正常运行。" "请打开 Docker Desktop，等左下角显示 Docker Engine running 后再双击 start_docker.bat。"
    }
} catch {
    Fail-WithHelp "Docker 没有正常运行。" "请打开 Docker Desktop，等它启动完成后再试。"
}

try {
    docker compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail-WithHelp "Docker Compose 不可用。" "请升级 Docker Desktop。新版 Docker Desktop 会自带 docker compose。"
    }
} catch {
    Fail-WithHelp "Docker Compose 不可用。" "请升级 Docker Desktop 后再试。"
}
Write-Host "Docker 检查通过。"

Write-Section "2. 启动容器"
Push-Location $ProjectRoot
try {
    Write-Host "正在执行：docker compose up -d --build"
    Write-Host "第一次启动会下载镜像和依赖，可能需要几分钟。"
    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) {
        Fail-WithHelp "docker compose up -d --build 执行失败。" "请查看上方 Docker 报错。常见原因是网络下载失败、端口被占用或 Docker Desktop 未完全启动。"
    }
} finally {
    Pop-Location
}

Write-Section "3. 等待前台页面"
$ready = $false
for ($i = 1; $i -le 60; $i++) {
    if (Test-PortOpen 6866) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 2
    Write-Host "等待前端启动中... $i/60"
}

if (-not $ready) {
    Write-Host "前端端口 6866 暂未监听，容器可能还在安装依赖。" -ForegroundColor Yellow
    Write-Host "你可以稍等后打开：$FrontendUrl"
    Write-Host "查看日志命令：docker compose logs -f frontend"
} else {
    Write-Host "前台页面已就绪：$FrontendUrl" -ForegroundColor Green
    Start-Process $FrontendUrl
}

Write-Section "4. 后续怎么用"
Write-Host "以后查看项目，只打开：$FrontendUrl"
Write-Host "修改前端代码后，刷新这个页面即可看到。"
Write-Host "修改后端 Java 代码后，容器会自动编译并触发后端重启，稍等片刻再刷新页面。"
Write-Host "查看全部日志：docker compose logs -f"
Write-Host "停止项目：docker compose down"

exit 0
