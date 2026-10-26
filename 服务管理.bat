@echo off
chcp 65001 >nul
cd /d %~dp0
title Chinese History Atlas - Local Service (close this window to stop)

echo ============================================================
echo    Chinese History Atlas - local service
echo ============================================================
echo.

REM ---- probe: service may already be started by MCP (session_start) ----
netstat -ano | findstr :5173 | findstr LISTENING >nul 2>&1
if %errorlevel%==0 (
    echo [status] Port 5173 is already in use ^(most likely started by the MCP connector^).
    echo.
    choice /c YN /m "Start another one anyway? It will fail with port-in-use"
    if errorlevel 2 goto :eof
    echo.
)

echo [start] node web\serve.mjs
echo.
echo Site: http://127.0.0.1:5173/web/
echo.
echo Notes:
echo   - This window runs the service in the foreground. Close it to stop.
echo   - Service output is printed here, which helps with troubleshooting.
echo   - No browser is opened automatically. Open the URL above yourself
echo     ^(DSH users: open it in the right-hand built-in browser^).
echo   - If the port is taken, the message above tells you how to change it:
echo     node web\serve.mjs 8080
echo.
echo ------------------------------------------------------------
echo.

node web\serve.mjs

echo.
echo [exit] Service stopped. Press any key to close this window.
pause >nul
