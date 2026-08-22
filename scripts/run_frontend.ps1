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

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$FrontDir = Join-Path $ProjectRoot "front"
$StartScript = Join-Path $FrontDir "start-dev.mjs"
$NodeModules = Join-Path $FrontDir "node_modules"

if ($null -eq (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Fail-WithHelp "没有找到 Node.js。" "请安装 Node.js LTS，重新打开 Alter 后再启动 Frontend。"
}
if (-not (Test-Path -LiteralPath $StartScript)) {
    Fail-WithHelp "没有找到 $StartScript。" "请确认 Alter 的工作目录指向项目根目录。"
}
if (-not (Test-Path -LiteralPath $NodeModules)) {
    Fail-WithHelp "前端依赖尚未安装。" "请在 $FrontDir 执行 corepack pnpm install。"
}

$portOwner = Get-PortOwnerDescription -Port 6866
if ($portOwner) {
    Fail-WithHelp "前端端口 6866 已被占用：$portOwner" "请先在 Alter 停止旧 Frontend，确认端口释放后再启动。"
}

Write-Host "启动投递牛马前端：$FrontDir"
Write-Host "访问地址：http://127.0.0.1:6866"

Push-Location $FrontDir
try {
    & node $StartScript
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

exit $exitCode
