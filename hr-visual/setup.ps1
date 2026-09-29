param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$envPath = Join-Path $root '.venv'
if (-not (Test-Path -LiteralPath (Join-Path $envPath 'Scripts\python.exe'))) {
    & $Python -m venv $envPath
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create the isolated visual worker environment' }
}
& (Join-Path $envPath 'Scripts\python.exe') -m pip install -r (Join-Path $root 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Failed to install visual worker dependencies' }
& (Join-Path $envPath 'Scripts\python.exe') (Join-Path $root 'worker.py') --health
if ($LASTEXITCODE -ne 0) { throw 'Visual worker health check failed' }
