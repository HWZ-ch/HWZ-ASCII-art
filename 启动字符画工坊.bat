@echo off
title HWZ ASCII Studio
cd /d "%~dp0"

if not exist "server.exe" (
  echo.
  echo [ERROR] server.exe not found. Please extract the complete folder.
  echo.
  pause
  exit /b 1
)

echo.
echo  Starting HWZ ASCII Studio local server...
echo  The browser will open automatically.
echo  Close this window to stop the tool.
echo.
server.exe %*

if errorlevel 1 (
  echo.
  echo  The local server has stopped.
  pause
)
