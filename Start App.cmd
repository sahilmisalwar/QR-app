@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer, then open this launcher again.
  pause
  exit /b 1
)
if not exist "node_modules" (
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Opening Rising India Hackathon at http://127.0.0.1:5173
echo Keep this window open while using the app. Press Ctrl+C to stop.
start "" "http://127.0.0.1:5173"
call npm run dev -- --port 5173 --strictPort
pause
