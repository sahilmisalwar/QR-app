@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules" call npm ci
echo Opening rehearsal with sample teams at http://127.0.0.1:5174
start "" "http://127.0.0.1:5174"
call npm run dev:demo
pause
