$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Fail-WithHelp {
    param(
        [string]$Message,
        [string]$Fix
    )

    Write-Host "错误：$Message" -ForegroundColor Red
    Write-Host "解决办法：$Fix" -ForegroundColor Yellow
    exit 1
}

function Get-PortOwnerDescription {
    param([int]$Port)

    try {
        $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
            Select-Object -First 1
        if ($null -eq $connection) {
            return $null
        }

        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction Stop
        return "PID $($process.ProcessId)，进程 $($process.Name)，命令 $($process.CommandLine)"
    } catch {
        return $null
    }
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

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$GradlewBat = Join-Path $ProjectRoot "gradlew.bat"
$DbDir = Join-Path $ProjectRoot "db"
$DataDir = Join-Path $ProjectRoot "data"
$OutputDir = Join-Path $ProjectRoot "output"
$CacheDir = Join-Path $ProjectRoot "target\cache"
$LogDir = Join-Path $ProjectRoot "target\logs"
$ChromeProfileDir = Join-Path $ProjectRoot "chrome-profile"

if ($null -eq (Get-Command "java" -ErrorAction SilentlyContinue)) {
    Fail-WithHelp "没有找到 Java。" "请安装 Java 21，重新打开 Alter 后再启动 Backend。"
}
$javaMajor = Get-JavaMajorVersion
if ($javaMajor -lt 21) {
    Fail-WithHelp "当前 Java 主版本为 $javaMajor，项目要求 Java 21 或更高版本。" "请安装 Java 21，重新打开 Alter 后再启动 Backend。"
}
if (-not (Test-Path -LiteralPath $GradlewBat)) {
    Fail-WithHelp "没有找到 $GradlewBat。" "请确认 Alter 的工作目录指向项目根目录。"
}

$portOwner = Get-PortOwnerDescription -Port 8888
if ($portOwner) {
    Fail-WithHelp "后端端口 8888 已被占用：$portOwner" "请先在 Alter 停止旧 Backend，确认端口释放后再启动。"
}

foreach ($dir in @($DbDir, $DataDir, $OutputDir, $CacheDir, $LogDir, $ChromeProfileDir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

if (-not $env:SPRING_DATASOURCE_URL) {
    $env:SPRING_DATASOURCE_URL = "jdbc:sqlite:$(Join-Path $DbDir 'getjobs.db')"
}
if (-not $env:APP_DATA_DIR) {
    $env:APP_DATA_DIR = $DataDir
}
if (-not $env:APP_OUTPUT_DIR) {
    $env:APP_OUTPUT_DIR = $OutputDir
}
if (-not $env:APP_CACHE_DIR) {
    $env:APP_CACHE_DIR = $CacheDir
}
if (-not $env:APP_LOG_DIR) {
    $env:APP_LOG_DIR = $LogDir
}
if (-not $env:LOGGING_FILE_NAME) {
    $env:LOGGING_FILE_NAME = Join-Path $LogDir "get-jobs.log"
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

$encodingOptions = "-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8"
if ([string]::IsNullOrWhiteSpace($env:JAVA_TOOL_OPTIONS)) {
    $env:JAVA_TOOL_OPTIONS = $encodingOptions
} elseif ($env:JAVA_TOOL_OPTIONS -notmatch "-Dfile\.encoding=") {
    $env:JAVA_TOOL_OPTIONS = "$($env:JAVA_TOOL_OPTIONS) $encodingOptions"
}

Write-Host "启动投递牛马后端：$ProjectRoot"
Write-Host "健康检查：http://127.0.0.1:8888/api/health"
Write-Host "启动阶段不会打开管理页或招聘网站；使用平台功能时浏览器会按需启动。"

Push-Location $ProjectRoot
try {
    & $GradlewBat --no-daemon bootRun
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

exit $exitCode
