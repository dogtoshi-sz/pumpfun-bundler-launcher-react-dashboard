# PowerShell script to start both API server and frontend
# Run this script from the pumpfun directory

Write-Host "🚀 Starting Pumpfun Token Bundler Development Servers..." -ForegroundColor Green
Write-Host ""

# Get the script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiServerDir = Join-Path $scriptDir "api-server"
$frontendDir = Join-Path $scriptDir "frontend"

# Check if directories exist
if (-not (Test-Path $apiServerDir)) {
    Write-Host "❌ API server directory not found: $apiServerDir" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $frontendDir)) {
    Write-Host "❌ Frontend directory not found: $frontendDir" -ForegroundColor Red
    exit 1
}

# Start API server in a new window
Write-Host "📡 Starting API server on port 3001..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$apiServerDir'; Write-Host 'API Server (Port 3001)' -ForegroundColor Green; npm start"

# Wait a bit for API server to start
Start-Sleep -Seconds 3

# Start frontend in a new window
Write-Host "🌐 Starting frontend on port 3000..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$frontendDir'; Write-Host 'Frontend (Port 3000)' -ForegroundColor Green; npm start"

Write-Host ""
Write-Host "✅ Both servers are starting in separate windows!" -ForegroundColor Green
Write-Host ""
Write-Host "📍 API Server: http://localhost:3001" -ForegroundColor Yellow
Write-Host "📍 Frontend:   http://localhost:3000" -ForegroundColor Yellow
Write-Host ""
Write-Host "💡 Close the PowerShell windows to stop the servers" -ForegroundColor Gray

