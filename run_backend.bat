@echo off
chcp 65001 >nul
cd /d "%~dp0backend"

REM Keep this file ASCII-only (see run_frontend.bat for why).
REM
REM Guard against a second backend: two processes on port 8000 split the
REM in-memory job state, so a quote created on one is "not found" on the other.
netstat -ano | findstr /R /C:"LISTENING" | findstr /C:":8000 " >nul
if %errorlevel%==0 (
    echo.
    echo [Notice] Backend is already running at http://localhost:8000
    echo          Close the existing backend window first, then run this again.
    echo.
    pause
    exit /b
)

pip install -r requirements.txt --quiet
python -m playwright install chromium
python -m uvicorn app.main:app --reload
pause
