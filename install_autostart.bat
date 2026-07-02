@echo off
title SERENOVA - Register Auto-Start
echo This will register SERENOVA to start automatically at Windows login.
echo You may need to run this as Administrator.
echo.

set TASK_NAME=SERENOVAAIAssistant
set SCRIPT_PATH=d:\AI Assisstant\SERENOVA-ai-assistant\start.bat

:: Delete old task if exists
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: Create new task - runs at user login, hidden, with a 10-second delay
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "cmd /c \"%SCRIPT_PATH%\"" ^
  /sc onlogon ^
  /delay 0000:10 ^
  /ru "%USERNAME%" ^
  /rl limited ^
  /f

if %errorlevel% == 0 (
    echo.
    echo [SUCCESS] SERENOVA will now start automatically at every login.
    echo Task: "%TASK_NAME%"
    echo Script: "%SCRIPT_PATH%"
) else (
    echo.
    echo [FAILED] Could not register the task. Try running as Administrator:
    echo   Right-click "install_autostart.bat" - Run as administrator
)

echo.
pause
