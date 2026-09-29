@echo off
chcp 65001 >nul
cd /d "%~dp0estimator_app"

REM Guard: a second server on port 5050 would fail to bind.
netstat -ano | findstr /R /C:"LISTENING" | findstr /C:":5050 " >nul
if %errorlevel%==0 (
    echo [Notice] Estimator is already running. Opening the browser.
    start "" "http://localhost:5050"
    pause
    exit /b
)

pip install flask --quiet
start "" "http://localhost:5050"
python app.py
pause
