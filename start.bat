@echo off
chcp 65001 >nul
title AI Auto Estimate Launcher

echo ============================================
echo   AI Auto Estimate Program - Starting
echo ============================================
echo.

start "Backend" "%~dp0run_backend.bat"
start "Frontend" "%~dp0run_frontend.bat"

echo Backend / Frontend windows have been opened.
echo Waiting about 10 seconds for the servers to start...
timeout /t 10 /nobreak >nul

start "" "http://localhost:3000"

echo.
echo If the browser does not open automatically, go to http://localhost:3000
echo You can close this window. To stop the servers, close the two other windows.
echo.
pause
