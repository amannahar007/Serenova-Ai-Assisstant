@echo off
title SERENOVA
set BACKEND_DIR=%~dp0backend-node
set NODE_EXE=%BACKEND_DIR%\node_bin\node.exe
set FRONTEND=%~dp0frontend-web\index.html

:: â”€â”€ 1. Start MongoDB if not running â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
tasklist /fi "imagename eq mongod.exe" 2>nul | find /i "mongod.exe" >nul
if %errorlevel% neq 0 (
    net start MongoDB >nul 2>&1
    if %errorlevel% neq 0 (
        start /min "MongoDB" "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe" --dbpath "C:\data\db" --logpath "C:\data\log\mongod.log" --logappend
    )
)

:: â”€â”€ 2. Start Ollama if not running â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
tasklist /fi "imagename eq ollama.exe" 2>nul | find /i "ollama.exe" >nul
if %errorlevel% neq 0 (
    start /min "Ollama" ollama serve
)

:: â”€â”€ 3. Start Node.js backend if not already running on port 3000 â”€â”€â”€â”€â”€â”€â”€â”€â”€
netstat -ano | find "LISTENING" | find ":3000" >nul 2>&1
if %errorlevel% neq 0 (
    start /min "SERENOVA Backend" "%NODE_EXE%" "%BACKEND_DIR%\server.js"
)

:: ── 3.5. Start Python FastAPI backend if not already running on port 8000 ──
netstat -ano | find "LISTENING" | find ":8000" >nul 2>&1
if %errorlevel% neq 0 (
    set PYTHON_DIR=%~dp0backend
    start /min "FastAPI Backend" cmd /c "cd /d "%PYTHON_DIR%" && call venv\Scripts\activate && uvicorn main:app --host 0.0.0.0 --port 8000"
)

:: â”€â”€ 4. Start React Frontend â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
netstat -ano | find "LISTENING" | find ":5173" >nul 2>&1
if %errorlevel% neq 0 (
    set FRONTEND_DIR=%~dp0frontend-react
    if exist "%~dp0backend-node\node_bin\node_modules\npm\bin\npm-cli.js" (
        start /min "React Frontend" cmd /c "set PATH=%~dp0backend-node\node_bin;%%PATH%% && cd /d "%FRONTEND_DIR%" && "%~dp0backend-node\node_bin\npm.cmd" run dev --host"
    ) else (
        start /min "React Frontend" cmd /c "cd /d "%FRONTEND_DIR%" && npm run dev --host"
    )
)

timeout /t 2 /nobreak >nul
:: â”€â”€ 5. Open the frontend in default browser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
start "" "%FRONTEND%"

exit
