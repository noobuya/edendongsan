@echo off
chcp 65001 >nul
REM Opens the public address for phones (Samsung Internet etc).
REM Needs run_backend.bat and run_frontend.bat (or start.bat) to be running first.
REM NOTE: the free ngrok account has ONE fixed domain. If another program (for example
REM another ngrok on this PC) uses the same account, it takes this domain away and the
REM app shows "server not connected". Run only one ngrok at a time.

netstat -ano | findstr /R /C:"LISTENING" | findstr /C:":8000 " >nul
if not %errorlevel%==0 (
    echo [Error] Backend is not running on port 8000. Start run_backend.bat first.
    pause
    exit /b
)

echo Public address: https://circulate-blissful-traction.ngrok-free.dev
echo Open it in Samsung Internet. On the first visit tap "Visit Site" once.
ngrok http 8000 --url=circulate-blissful-traction.ngrok-free.dev
pause
