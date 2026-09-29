@echo off
chcp 65001 >nul
cd /d "%~dp0frontend"

REM Keep this file ASCII-only. cmd.exe loses its read position in a batch file
REM that mixes "chcp 65001" with non-ASCII text, and resumes mid-word.
REM
REM Guard against a second dev server: two "next dev" processes share the same
REM .next folder and delete each other's chunks, which makes every page 404.
netstat -ano | findstr /R /C:"LISTENING" | findstr /C:":3000 " >nul
if %errorlevel%==0 (
    echo.
    echo [Notice] Frontend is already running at http://localhost:3000
    echo          Close the existing frontend window first, then run this again.
    echo.
    pause
    exit /b
)

if not exist node_modules npm install
npm run dev
pause
