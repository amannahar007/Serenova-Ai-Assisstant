@echo off
title SERENOVA - Clean Restart
color 0C

echo ===============================================
echo   SERENOVA - Force Restarting...
echo ===============================================
echo.

echo [1/3] Killing old processes (Node, Python)...
taskkill /F /IM node.exe /T 2>nul
taskkill /F /IM python.exe /T 2>nul
taskkill /F /IM uvicorn.exe /T 2>nul

echo.
echo [2/3] Clearing Vite Cache...
if exist "frontend-react\node_modules\.vite" (
    rmdir /S /Q "frontend-react\node_modules\.vite"
    echo       Vite cache cleared.
) else (
    echo       No Vite cache found.
)

echo.
echo [3/3] Launching original start.bat...
timeout /t 2 /nobreak >nul
start "" "%~dp0start.bat"

echo ===============================================
echo   Restart initiated! You can close this window.
echo ===============================================
timeout /t 3 /nobreak >nul
exit /b 0
