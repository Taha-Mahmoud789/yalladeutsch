@echo off
cd /d %~dp0
if not exist node_modules\.bin\next.cmd call npm ci
if errorlevel 1 goto done
call npm run dev
:done
pause
