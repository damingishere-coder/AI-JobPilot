[CmdletBinding()]
param(
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VenvPath = Join-Path $ProjectRoot ".venv"
$VenvPython = Join-Path $VenvPath "Scripts\python.exe"
$Requirements = Join-Path $PSScriptRoot "requirements.txt"
$PrepareScript = Join-Path $PSScriptRoot "prepare_models.py"
$DoclingTools = Join-Path $VenvPath "Scripts\docling-tools.exe"
$ModelDirectory = Join-Path $ProjectRoot ".resume-models"

if (-not (Test-Path -LiteralPath $VenvPython)) {
    & $Python -m venv $VenvPath
}

& $VenvPython -m pip install --disable-pip-version-check --requirement $Requirements
if (-not (Test-Path -LiteralPath $DoclingTools)) {
    throw "docling-tools 未安装，无法准备离线模型。"
}

New-Item -ItemType Directory -Force -Path $ModelDirectory | Out-Null
& $DoclingTools models download `
    --output-dir $ModelDirectory `
    --rapidocr-backend-lang "onnxruntime:ch" `
    layout tableformer rapidocr
& $VenvPython $PrepareScript

Write-Host "Docling + RapidOCR 本地识别环境准备完成。"
