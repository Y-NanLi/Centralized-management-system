@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   集中管理系统启动中… 打开 http://localhost:8099
echo   关闭本窗口即停止服务
echo.
start "" http://localhost:8099
node server.js
pause
