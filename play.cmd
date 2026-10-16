@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 or newer from https://nodejs.org/en/download
  echo Then double-click play.cmd again.
  pause
  exit /b 1
)
node scripts/launch.mjs play
if errorlevel 1 (
  echo Launch failed. See the message above.
  pause
  exit /b 1
)
