@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js 18 or newer, then run this file again.
  pause
  exit /b 1
)
if "%TOKEN_SECRET%"=="" set TOKEN_SECRET=CHANGE_ME_BEFORE_PUBLIC_DEPLOYMENT_EduSend_V1
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server.js
pause
