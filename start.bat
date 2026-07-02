@echo off
title SERENOVA - Startup
color 0A

echo ===============================================
echo   SERENOVA - Starting Services...
echo ===============================================
echo.

:: â”€â”€ Step 1: Start MongoDB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
echo [1/5] Starting MongoDB...

:: Check if MongoDB is already running
tasklist /fi "imagename eq mongod.exe" 2>nul | find /i "mongod.exe" >nul
if %errorlevel% == 0 (
    echo       MongoDB is already running.
) else (
    sc query MongoDB >nul 2>&1
    if %errorlevel% == 0 (
        net start MongoDB >nul 2>&1
    )
    
    :: Check again after trying to start the service
    tasklist /fi "imagename eq mongod.exe" 2>nul | find /i "mongod.exe" >nul
    if %errorlevel% neq 0 (
        echo       Starting mongod.exe manually...
        start /min "MongoDB" "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe" --dbpath "C:\data\db" --logpath "C:\data\log\mongod.log" --logappend
        timeout /t 3 /nobreak >nul
    ) else (
        echo       MongoDB service started successfully.
    )
)

echo.

:: â”€â”€ Step 2: Start Ollama â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
echo [2/5] Starting Ollama...
tasklist /fi "imagename eq ollama.exe" 2>nul | find /i "ollama.exe" >nul
if %errorlevel% neq 0 (
    start /min "Ollama" ollama serve
    timeout /t 4 /nobreak >nul
    echo       Ollama started.
) else (
    echo       Ollama is already running.
)

echo.

:: â”€â”€ Step 3: Start Node.js Backend â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
echo [3/5] Starting Node.js backend...
set BACKEND_DIR=%~dp0backend-node
set NODE_EXE=%BACKEND_DIR%\node_bin\node.exe

:: Always prefer bundled node.exe (avoids PATH issues)
if exist "%NODE_EXE%" (
    start "SERENOVA Backend" "%NODE_EXE%" "%BACKEND_DIR%\server.js"
) else (
    :: Fall back to system node
    where node >nul 2>&1
    if %errorlevel% == 0 (
        start "SERENOVA Backend" cmd /k "cd /d "%BACKEND_DIR%" && node server.js"
    ) else (
        echo [ERROR] Node.js not found at %NODE_EXE% and not in PATH!
        echo         Install Node.js from https://nodejs.org
        pause
        exit /b 1
    )
)

timeout /t 2 /nobreak >nul
echo       Node.js backend started on http://localhost:3000
echo.

:: â”€â”€ Step 4: Start Python FastAPI Backend â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
echo [4/5] Starting Python FastAPI backend...
set PYTHON_DIR=%~dp0backend
start "FastAPI Backend" cmd /k "cd /d "%PYTHON_DIR%" && call venv\Scripts\activate && uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
timeout /t 3 /nobreak >nul
echo       FastAPI backend started on http://localhost:8000
echo.

:: â”€â”€ Step 5: Start React Frontend â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
echo [5/5] Starting React Frontend...
set FRONTEND_DIR=%~dp0frontend-react
set NODE_BIN=%~dp0backend-node\node_bin
set NPM_CMD=%NODE_BIN%\npm.cmd

if exist "%NODE_BIN%\node_modules\npm\bin\npm-cli.js" (
    start "React Frontend" cmd /k "set PATH=%NODE_BIN%;%%PATH%% && cd /d "%FRONTEND_DIR%" && "%NPM_CMD%" run dev --host"
) else (
    start "React Frontend" cmd /k "cd /d "%FRONTEND_DIR%" && npm run dev --host"
)
timeout /t 3 /nobreak >nul
echo       React Frontend started on http://localhost:5173
echo.

:: â”€â”€ Done â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
echo ===============================================
echo   All services started!
echo   Open: http://localhost:5173
echo ===============================================
echo.
echo The status badge will show "Connecting..." until ready, then "Online".
echo You can close this window now.
timeout /t 5 /nobreak >nul
exit /b 0
