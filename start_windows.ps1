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
    param(
        [string]$Message,
        [string]$Fix
    )

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
    $versionText = (& cmd.exe /d /c "java -version 2>&1" | Out-String)
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

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        $connected = $async.AsyncWaitHandle.WaitOne(1000, $false)
        if (-not $connected) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Test-HttpEndpoint {
    param([string]$Url)

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Wait-ForHttpEndpoint {
    param(
        [string]$Url,
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (Test-HttpEndpoint -Url $Url) {
            return $true
        }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)

    return $false
}

function Get-PortOwner {
    param([int]$Port)

    try {
        $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
            Select-Object -First 1
        if ($null -eq $connection) {
            return $null
        }
        return Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction Stop
    } catch {
        return $null
    }
}

function Get-PortOwnerDescription {
    param([int]$Port)

    $process = Get-PortOwner -Port $Port
    if ($null -eq $process) {
        return "无法读取占用进程信息"
    }
    return "PID $($process.ProcessId)，进程 $($process.Name)，命令 $($process.CommandLine)"
}

function Test-PortOwnedByProject {
    param(
        [int]$Port,
        [string]$ProjectRoot,
        [string]$ExpectedProcessPattern
    )

    $process = Get-PortOwner -Port $Port
    if ($null -eq $process) {
        return $false
    }
    return $process.Name -match $ExpectedProcessPattern -and
        $process.CommandLine -like "*$ProjectRoot*"
}

function ConvertTo-PowerShellLiteral {
    param([string]$Value)

    return "'" + $Value.Replace("'", "''") + "'"
}

function Start-BackgroundPowerShell {
    param([string]$Command)

    $encodedCommand = [Convert]::ToBase64String(
        [System.Text.Encoding]::Unicode.GetBytes($Command)
    )
    return Start-Process `
        -FilePath "powershell.exe" `
        -WindowStyle Hidden `
        -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-EncodedCommand", $encodedCommand
        ) `
        -PassThru
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
    Fail-WithHelp `
        "没有找到 Java。" `
        "请安装 Java 21，重新打开 PowerShell 后执行 java -version，确认显示 21 或更高版本。"
}
$javaMajor = Get-JavaMajorVersion
if ($javaMajor -lt 21) {
    Fail-WithHelp `
        "当前 Java 主版本为 $javaMajor，项目要求 Java 21 或更高版本。" `
        "请安装 Java 21，重新打开 PowerShell 后执行 java -version 进行确认。"
}
Write-Host "Java 检查通过：主版本 $javaMajor"

Write-Section "2. 检查 Gradle Wrapper"
$GradlewBat = Join-Path $ProjectRoot "gradlew.bat"
if (-not (Test-Path -LiteralPath $GradlewBat)) {
    Fail-WithHelp `
        "没有找到 gradlew.bat。" `
        "请确认当前目录是完整的项目根目录。"
}
Push-Location $ProjectRoot
try {
    & $GradlewBat --version *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail-WithHelp `
            "gradlew.bat 无法正常执行。" `
            "请确认 Java 21 已正确安装，且项目目录没有被安全软件拦截。"
    }
} finally {
    Pop-Location
}
Write-Host "Gradle Wrapper 检查通过：$GradlewBat"

Write-Section "3. 检查 Node.js 与 pnpm"
if (-not (Test-CommandExists "node")) {
    Fail-WithHelp `
        "没有找到 Node.js。" `
        "请安装 Node.js LTS，重新打开 PowerShell 后执行 node -v 进行确认。"
}
Write-Host "Node.js 检查通过：$(& node -v)"

if (-not (Test-CommandExists "pnpm")) {
    Fail-WithHelp `
        "没有找到 pnpm。" `
        "请执行 corepack enable，再执行 corepack prepare pnpm@10.20.0 --activate，最后用 pnpm -v 验证。"
}
Write-Host "pnpm 检查通过：$(& pnpm -v)"

if (-not (Test-Path -LiteralPath $FrontDir)) {
    Fail-WithHelp `
        "没有找到 front 目录。" `
        "请确认项目下载完整，项目根目录下应包含 front 文件夹。"
}
$FrontNodeModules = Join-Path $FrontDir "node_modules"
if (-not (Test-Path -LiteralPath $FrontNodeModules)) {
    Fail-WithHelp `
        "前端依赖尚未安装。" `
        "请在 $FrontDir 目录执行 pnpm install，成功后应看到 node_modules 文件夹。"
}
Write-Host "前端依赖检查通过：$FrontNodeModules"

Write-Section "4. 准备运行目录"
foreach ($dir in @(
    $LogDir,
    $TargetLogDir,
    $DbDir,
    $DataDir,
    $OutputDir,
    $CacheDir,
    $ChromeProfileDir
)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
Write-Host "运行目录已准备完成。"

if (-not $env:SPRING_DATASOURCE_URL) {
    $env:SPRING_DATASOURCE_URL = "jdbc:sqlite:$(Join-Path $DbDir 'getjobs.db')"
}
if (-not $env:LOGGING_FILE_NAME) {
    $env:LOGGING_FILE_NAME = Join-Path $TargetLogDir "get-jobs.log"
}
if (-not $env:APP_BROWSER_USER_DATA_DIR) {
    $env:APP_BROWSER_USER_DATA_DIR = $ChromeProfileDir
}
if (-not $env:APP_AUTO_OPEN_BROWSER) {
    $env:APP_AUTO_OPEN_BROWSER = "false"
}
if (-not $env:APP_BROWSER_INITIALIZE_ON_STARTUP) {
    $env:APP_BROWSER_INITIALIZE_ON_STARTUP = "false"
}
if (-not $env:APP_STATIC_SERVER_ENABLED) {
    $env:APP_STATIC_SERVER_ENABLED = "false"
}
$env:JAVA_TOOL_OPTIONS = "-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8"

$BackendLog = Join-Path $LogDir "windows-backend.log"
$FrontendLog = Join-Path $LogDir "windows-frontend.log"

$backendLogLiteral = ConvertTo-PowerShellLiteral $BackendLog
$frontendLogLiteral = ConvertTo-PowerShellLiteral $FrontendLog
$backendScriptLiteral = ConvertTo-PowerShellLiteral (Join-Path $ProjectRoot "scripts\run_backend.ps1")
$frontendScriptLiteral = ConvertTo-PowerShellLiteral (Join-Path $ProjectRoot "scripts\run_frontend.ps1")
$FrontendUrl = "http://127.0.0.1:6866/"
$BackendHealthUrl = "http://127.0.0.1:8888/api/health"

Write-Section "5. 启动前端"
if ((Test-HttpEndpoint -Url $FrontendUrl) -and
    (Test-PortOwnedByProject -Port 6866 -ProjectRoot $ProjectRoot -ExpectedProcessPattern '^node(\.exe)?$')) {
    Write-Host "当前项目的前端已经正常运行，跳过重复启动。" -ForegroundColor Green
} elseif (Test-PortOpen -Port 6866) {
    $owner = Get-PortOwnerDescription -Port 6866
    Fail-WithHelp `
        "前端端口 6866 已被占用，但不是当前项目可复用的健康前端：$owner" `
        "请先停止占用 6866 的旧进程，再重新运行本启动器。"
} else {
    $FrontendCommand = @"
& $frontendScriptLiteral *>> $frontendLogLiteral
exit `$LASTEXITCODE
"@
    $frontendProcess = Start-BackgroundPowerShell -Command $FrontendCommand
    Write-Host "前端启动进程：$($frontendProcess.Id)"
    Write-Host "前端日志：$FrontendLog"

    if (-not (Wait-ForHttpEndpoint -Url $FrontendUrl -TimeoutSeconds 60)) {
        Fail-WithHelp `
            "前端在 60 秒内未能通过 HTTP 健康检查。" `
            "请查看日志：$FrontendLog"
    }
    Write-Host "前端 HTTP 服务已就绪。" -ForegroundColor Green
}

Write-Section "6. 启动后端"
if ((Test-HttpEndpoint -Url $BackendHealthUrl) -and
    (Test-PortOwnedByProject -Port 8888 -ProjectRoot $ProjectRoot -ExpectedProcessPattern '^java(\.exe)?$')) {
    Write-Host "当前项目的后端已经正常运行，跳过重复启动。" -ForegroundColor Green
} elseif (Test-PortOpen -Port 8888) {
    $owner = Get-PortOwnerDescription -Port 8888
    Fail-WithHelp `
        "后端端口 8888 已被占用，但不是当前项目可复用的健康后端：$owner" `
        "请先停止占用 8888 的旧进程，再重新运行本启动器。"
} else {
    $BackendCommand = @"
& $backendScriptLiteral *>> $backendLogLiteral
exit `$LASTEXITCODE
"@
    $backendProcess = Start-BackgroundPowerShell -Command $BackendCommand
    Write-Host "后端启动进程：$($backendProcess.Id)"
    Write-Host "后端日志：$BackendLog"

    if (-not (Wait-ForHttpEndpoint -Url $BackendHealthUrl -TimeoutSeconds 120)) {
        Fail-WithHelp `
            "后端在 120 秒内未能通过健康检查。" `
            "请查看日志：$BackendLog"
    }
    Write-Host "后端健康检查已通过。" -ForegroundColor Green
}

Write-Section "7. 启动完成"
Write-Host "前端：http://localhost:6866"
Write-Host "环境配置：http://localhost:6866/env-config"
Write-Host "后端健康检查：http://localhost:8888/api/health"
Write-Host ""
Write-Host "如果页面没有自动刷新，请在浏览器中按 Ctrl+R。"
exit 0
