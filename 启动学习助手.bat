@echo off
chcp 65001 >nul
title 为了明日 · 考研学习终端
cd /d "%~dp0"

rem 已在运行则直接打开网页，不重复启动
curl -s -o nul --max-time 2 http://localhost:5175/ 2>nul
if not errorlevel 1 (
  echo 为了明日 已经在运行，正在打开网页...
  start "" http://localhost:5175
  ping -n 3 127.0.0.1 >nul
  exit
)

if not exist node_modules (
  echo 首次运行，正在安装依赖，大约需要 1 分钟...
  call npm install --no-audit --no-fund
)

set NODE_NO_WARNINGS=1
set OPEN_BROWSER=1
echo.
echo   ================================================
echo     为了明日 . 考研学习终端
echo     浏览器会自动打开；关掉本窗口 = 停止程序
echo   ================================================
echo.
node server.js
echo.
echo  程序已停止运行。
pause
