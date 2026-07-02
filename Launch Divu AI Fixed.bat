@echo off
echo ============================================
echo  DIVU AI - STARTUP SEQUENCE
echo ============================================

echo [1/3] Checking MongoDB connection...
cd backend-node
node -e "require('dotenv').config(); const mongoose = require('mongoose'); mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 }).then(() => { console.log('MongoDB OK'); process.exit(0); }).catch(e => { console.error('MongoDB FAILED:', e.message); console.error('Check MONGO_URI in backend-node/.env'); process.exit(1); });"
if errorlevel 1 (
  echo MongoDB connection failed. Fix MONGO_URI in backend-node/.env
  pause
  exit /b 1
)
cd ..

echo [2/3] Starting Node.js backend on port 3000...
start "Node Backend" cmd /k "cd /d %~dp0backend-node && node server.js"

echo [3/3] Starting Python FastAPI on port 8000...
start "Python Backend" cmd /k "cd /d %~dp0backend && venv\Scripts\activate && uvicorn main:app --reload --port 8000"

echo [4/4] Starting React frontend on port 5173...
timeout /t 3 /nobreak > nul
start "React Frontend" cmd /k "cd /d %~dp0frontend-react && npm run dev"

echo ============================================
echo  All services starting...
echo  Frontend:        http://localhost:5173
echo  Node backend:    http://localhost:3000/api/health
echo  Python backend:  http://localhost:8000/health
echo ============================================
pause
