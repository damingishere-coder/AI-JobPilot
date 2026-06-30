@echo off
setlocal
chcp 65001 >nul

set SCRIPT_DIR=%~dp0

echo ===============================================
echo 投递牛马 Windows 本地启动器
echo ===============================================
echo.
echo 将检查 Java、Node.js、pnpm、前端依赖，并启动后端和前端。
echo 如果 PowerShell 禁止运行脚本，本 bat 会自动使用 ExecutionPolicy Bypass。
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start_windows.ps1"
set EXIT_CODE=%ERRORLEVEL%

echo.
if not "%EXIT_CODE%"=="0" (
  echo 启动检查未通过，请根据上面的中文提示处理后再试。
) else (
  echo 启动命令已执行。后端和前端日志在 logs 目录中。
)
echo.
pause
exit /b %EXIT_CODE%
