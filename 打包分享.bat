@echo off
chcp 65001 >nul
title 为了明日 · 打包分享
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0share.ps1"
pause
