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

function Wait-ForPort {
    param(
        [int]$Port,
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (Test-PortOpen -Port $Port) {
            return $true
        }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)

    return $false
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
$env:JAVA_TOOL_OPTIONS = "-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8"

$BackendLog = Join-Path $LogDir "windows-backend.log"
$FrontendLog = Join-Path $LogDir "windows-frontend.log"

$projectRootLiteral = ConvertTo-PowerShellLiteral $ProjectRoot
$frontDirLiteral = ConvertTo-PowerShellLiteral $FrontDir
$backendLogLiteral = ConvertTo-PowerShellLiteral $BackendLog
$frontendLogLiteral = ConvertTo-PowerShellLiteral $FrontendLog
$javaToolOptionsLiteral = ConvertTo-PowerShellLiteral $env:JAVA_TOOL_OPTIONS
$datasourceUrlLiteral = ConvertTo-PowerShellLiteral $env:SPRING_DATASOURCE_URL
$loggingFileLiteral = ConvertTo-PowerShellLiteral $env:LOGGING_FILE_NAME
$chromeProfileLiteral = ConvertTo-PowerShellLiteral $env:APP_BROWSER_USER_DATA_DIR

Write-Section "5. 启动前端"
if (Test-PortOpen -Port 6866) {
    Write-Host "前端端口 6866 已在监听，跳过重复启动。" -ForegroundColor Green
} else {
    $FrontendCommand = @"
Set-Location -LiteralPath $frontDirLiteral
& pnpm dev *>> $frontendLogLiteral
"@
    $frontendProcess = Start-BackgroundPowerShell -Command $FrontendCommand
    Write-Host "前端启动进程：$($frontendProcess.Id)"
    Write-Host "前端日志：$FrontendLog"

    if (-not (Wait-ForPort -Port 6866 -TimeoutSeconds 60)) {
        Fail-WithHelp `
            "前端在 60 秒内未能监听 6866 端口。" `
            "请查看日志：$FrontendLog"
    }
    Write-Host "前端端口 6866 已就绪。" -ForegroundColor Green
}

Write-Section "6. 启动后端"
if (Test-PortOpen -Port 8888) {
    Write-Host "后端端口 8888 已在监听，跳过重复启动。" -ForegroundColor Green
} else {
    $BackendCommand = @"
Set-Location -LiteralPath $projectRootLiteral
`$env:JAVA_TOOL_OPTIONS = $javaToolOptionsLiteral
`$env:SPRING_DATASOURCE_URL = $datasourceUrlLiteral
`$env:LOGGING_FILE_NAME = $loggingFileLiteral
`$env:APP_BROWSER_USER_DATA_DIR = $chromeProfileLiteral
& (Join-Path $projectRootLiteral 'gradlew.bat') bootRun *>> $backendLogLiteral
"@
    $backendProcess = Start-BackgroundPowerShell -Command $BackendCommand
    Write-Host "后端启动进程：$($backendProcess.Id)"
    Write-Host "后端日志：$BackendLog"

    if (-not (Wait-ForPort -Port 8888 -TimeoutSeconds 90)) {
        Fail-WithHelp `
            "后端在 90 秒内未能监听 8888 端口。" `
            "请查看日志：$BackendLog"
    }
    Write-Host "后端端口 8888 已就绪。" -ForegroundColor Green
}

Write-Section "7. 启动完成"
Write-Host "前端：http://localhost:6866"
Write-Host "环境配置：http://localhost:6866/env-config"
Write-Host "后端健康检查：http://localhost:8888/api/health"
Write-Host ""
Write-Host "如果页面没有自动刷新，请在浏览器中按 Ctrl+R。"
exit 0
