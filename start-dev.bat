@echo off
REM Batch script to start both API server and frontend
REM Run this script from the pumpfun directory

echo.
echo 🚀 Starting Pumpfun Token Bundler Development Servers...
echo.

cd /d "%~dp0"

REM Start API server in a new window
echo 📡 Starting API server on port 3001...
start "API Server (Port 3001)" cmd /k "cd api-server && npm start"

REM Wait a bit for API server to start
timeout /t 3 /nobreak >nul

REM Start frontend in a new window
echo 🌐 Starting frontend on port 3000...
start "Frontend (Port 3000)" cmd /k "cd frontend && npm start"

echo.
echo ✅ Both servers are starting in separate windows!
echo.
echo 📍 API Server: http://localhost:3001
echo 📍 Frontend:   http://localhost:3000
echo.
echo 💡 Close the command windows to stop the servers
echo.
pause

