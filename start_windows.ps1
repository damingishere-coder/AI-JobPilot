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

function Get-JavaMajorVersion {
    $versionText = (& java -version 2>&1 | Out-String)
    if ($versionText -match 'version "(\d+)') {
        return [int]$Matches[1]
    }
    if ($versionText -match 'openjdk (\d+)') {
        return [int]$Matches[1]
    }
    return 0
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
$FrontDir = Join-Path $ProjectRoot "front"
$LogDir = Join-Path $ProjectRoot "logs"
$TargetLogDir = Join-Path $ProjectRoot "target\logs"
$DbDir = Join-Path $ProjectRoot "db"
$DataDir = Join-Path $ProjectRoot "data"
$OutputDir = Join-Path $ProjectRoot "output"
$CacheDir = Join-Path $ProjectRoot "target\cache"
$ChromeProfileDir = Join-Path $ProjectRoot "chrome-profile"

Write-Section "投递牛马 Windows 本地启动器"
Write-Host "项目目录：$ProjectRoot"

Write-Section "1. 检查 Java"
if (-not (Test-CommandExists "java")) {
    Fail-WithHelp "没有找到 Java。" "请安装 Java 21，然后重新打开 PowerShell 或双击 start_windows.bat。验证命令：java -version"
}
$javaMajor = Get-JavaMajorVersion
if ($javaMajor -lt 21) {
    Fail-WithHelp "当前 Java 版本低于 21。" "请安装 Java 21。安装成功后执行 java -version，应看到 21 或更高版本。"
}
Write-Host "Java 检查通过：主版本 $javaMajor"

Write-Section "2. 检查 Gradle Wrapper"
$GradlewBat = Join-Path $ProjectRoot "gradlew.bat"
if (-not (Test-Path -LiteralPath $GradlewBat)) {
    Fail-WithHelp "没有找到 gradlew.bat。" "请确认你在完整项目目录中运行，本项目根目录应该包含 gradlew.bat。"
}
Push-Location $ProjectRoot
try {
    & $GradlewBat --version *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail-WithHelp "gradlew.bat 无法正常执行。" "请确认 Java 21 已正确安装，并且项目目录没有被安全软件拦截。"
    }
} finally {
    Pop-Location
}
Write-Host "Gradle Wrapper 检查通过：$GradlewBat"

Write-Section "3. 检查 Node.js 与 pnpm"
if (-not (Test-CommandExists "node")) {
    Fail-WithHelp "没有找到 Node.js。" "请安装 Node.js LTS。安装成功后执行 node -v，应看到版本号。"
}
Write-Host "Node.js 检查通过：$(& node -v)"

if (-not (Test-CommandExists "pnpm")) {
    Fail-WithHelp "没有找到 pnpm。" "请先安装 pnpm：在 PowerShell 中执行 corepack enable，然后执行 corepack prepare pnpm@10.20.0 --activate。验证命令：pnpm -v"
}
Write-Host "pnpm 检查通过：$(& pnpm -v)"

if (-not (Test-Path -LiteralPath $FrontDir)) {
    Fail-WithHelp "没有找到 front 目录。" "请确认项目下载完整，项目根目录应包含 front 文件夹。"
}
$FrontNodeModules = Join-Path $FrontDir "node_modules"
if (-not (Test-Path -LiteralPath $FrontNodeModules)) {
    Fail-WithHelp "front 目录还没有安装依赖。" "请在目录 $FrontDir 中执行 pnpm install。成功后应看到 node_modules 文件夹。"
}
Write-Host "前端依赖检查通过：$FrontNodeModules"

Write-Section "4. 准备运行目录"
foreach ($dir in @($LogDir, $TargetLogDir, $DbDir, $DataDir, $OutputDir, $CacheDir, $ChromeProfileDir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
Write-Host "运行目录已准备：db、data、output、logs、target\logs、target\cache、chrome-profile"

if (-not $env:SPRING_DATASOURCE_URL) {
    $env:SPRING_DATASOURCE_URL = "jdbc:sqlite:$(Join-Path $DbDir 'getjobs.db')"
}
if (-not $env:LOGGING_FILE_NAME) {
    $env:LOGGING_FILE_NAME = Join-Path $TargetLogDir "get-jobs.log"
}
if (-not $env:APP_BROWSER_USER_DATA_DIR) {
    $env:APP_BROWSER_USER_DATA_DIR = $ChromeProfileDir
}
$env:JAVA_TOOL_OPTIONS = "-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8"

Write-Section "5. 启动后端与前端"
$BackendLog = Join-Path $LogDir "windows-backend.log"
$FrontendLog = Join-Path $LogDir "windows-frontend.log"

$BackendCommand = @"
Set-Location -LiteralPath '$ProjectRoot'
`$env:JAVA_TOOL_OPTIONS = '$($env:JAVA_TOOL_OPTIONS)'
`$env:SPRING_DATASOURCE_URL = '$($env:SPRING_DATASOURCE_URL)'
`$env:LOGGING_FILE_NAME = '$($env:LOGGING_FILE_NAME)'
`$env:APP_BROWSER_USER_DATA_DIR = '$($env:APP_BROWSER_USER_DATA_DIR)'
.\gradlew.bat bootRun *> '$BackendLog'
"@

$FrontendCommand = @"
Set-Location -LiteralPath '$FrontDir'
pnpm dev *> '$FrontendLog'
"@

Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $BackendCommand)
Start-Sleep -Seconds 3
Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $FrontendCommand)

Write-Host "后端启动日志：$BackendLog"
Write-Host "前端启动日志：$FrontendLog"
Write-Host ""
Write-Host "访问地址："
Write-Host "前端：http://localhost:6866"
Write-Host "后端：http://localhost:8888"

Write-Section "6. 简单连通性检查"
Start-Sleep -Seconds 8
$backendReady = Test-PortOpen 8888
$frontendReady = Test-PortOpen 6866

if ($backendReady) {
    Write-Host "后端端口 8888 已监听。" -ForegroundColor Green
} else {
    Write-Host "后端端口 8888 暂未监听，请稍等或查看：$BackendLog" -ForegroundColor Yellow
}

if ($frontendReady) {
    Write-Host "前端端口 6866 已监听。" -ForegroundColor Green
} else {
    Write-Host "前端端口 6866 暂未监听，请稍等或查看：$FrontendLog" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "如需停止服务，可以运行：bin\kill-services.bat"
exit 0
