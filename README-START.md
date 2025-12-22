# 🚀 How to Start the Development Servers

## Quick Start (Easiest Method)

### Option 1: Double-click the script
- **Windows**: Double-click `start-dev.bat`
- **PowerShell**: Right-click `start-dev.ps1` → "Run with PowerShell"

This will automatically start both servers in separate windows.

---

## Manual Start (Step by Step)

### Step 1: Start API Server

Open a terminal/command prompt and run:

```bash
cd api-server
npm start
```

The API server will start on **http://localhost:3001**

### Step 2: Start Frontend (in a NEW terminal)

Open a **second** terminal/command prompt and run:

```bash
cd frontend
npm start
```

The frontend will start on **http://localhost:3000** and automatically open in your browser.

---

## What Each Server Does

### API Server (Port 3001)
- Handles backend operations
- Manages token launches
- Processes image uploads
- Runs AI generation
- Executes gather/sell operations

### Frontend (Port 3000)
- User interface for token management
- Connects to API server automatically
- Hot reloads on code changes

---

## Troubleshooting

### Port Already in Use
If you get a "port already in use" error:

**Windows PowerShell:**
```powershell
# Kill all Node processes
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
```

**Windows CMD:**
```cmd
taskkill /F /IM node.exe
```

### Servers Won't Start
1. Make sure you've installed dependencies:
   ```bash
   cd api-server
   npm install
   
   cd ../frontend
   npm install
   ```

2. Check that ports 3000 and 3001 are not blocked by firewall

3. Make sure Node.js is installed: `node --version`

---

## Stopping the Servers

- **If using start-dev scripts**: Close the command windows
- **If running manually**: Press `Ctrl+C` in each terminal window

---

## Development Tips

- Keep both terminals visible so you can see logs from both servers
- API server logs show token launch progress
- Frontend logs show UI interactions
- Changes to frontend code auto-reload in the browser
- Changes to API server require restart (Ctrl+C then `npm start` again)

