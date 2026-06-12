@echo off
setlocal
chcp 65001 >nul

set SCRIPT_DIR=%~dp0

echo ===============================================
echo 投递牛马 Docker 一键启动器
echo ===============================================
echo.
echo 启动成功后，只需要打开这个前台页面：
echo http://localhost:6866
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start_docker.ps1"
set EXIT_CODE=%ERRORLEVEL%

echo.
if not "%EXIT_CODE%"=="0" (
  echo Docker 启动失败，请根据上面的中文提示处理后再试。
) else (
  echo Docker 启动流程已完成。
)
echo.
pause
exit /b %EXIT_CODE%
