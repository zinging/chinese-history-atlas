@echo off
chcp 65001 >nul
cd /d %~dp0
title Chinese History Atlas - 本地服务（关闭此窗口即停止服务）
echo 正在启动本地服务...
start "" "http://127.0.0.1:5173/web/"
node web\serve.mjs
pause
