@echo off
REM ============================================================
REM  Forensic Analyst — Backend autostart installer (Windows)
REM
REM  Drops a launcher into your Startup folder. That is it.
REM
REM  Just double-click this file. No administrator, no Task
REM  Scheduler, no service.
REM
REM  Why the Startup folder and not a Scheduled Task: the task ran
REM  as SYSTEM at boot, which has its own PATH (no per-user Node),
REM  its own session, a battery policy that blocks it on laptops
REM  and a 3-day run limit. This runs as YOU, right after you log
REM  in, with your PATH — the same environment where it already
REM  works when you start it by hand.
REM
REM  Trade-off: it starts when you log in, not before. If nobody
REM  logs in, nothing runs.
REM ============================================================

setlocal

set "NAME=ForensicAnalystBackend"
set "LAUNCHER=%~dp0start-windows.bat"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "OLD_SHIM=%STARTUP%\%NAME%.bat"
set "SHIM=%STARTUP%\%NAME%.vbs"

if not exist "%LAUNCHER%" (
    echo FAILED: launcher not found at "%LAUNCHER%"
    pause
    exit /b 1
)

if not exist "%STARTUP%" (
    echo FAILED: Startup folder not found at
    echo   "%STARTUP%"
    pause
    exit /b 1
)

REM Clean up the old Scheduled Task, if a previous version installed one.
schtasks /Delete /TN "%NAME%" /F >nul 2>&1
if %errorlevel%==0 echo Removed the old scheduled task.

REM Remove the old cmd shim: /min still leaves a black taskbar window open.
if exist "%OLD_SHIM%" del /f /q "%OLD_SHIM%"

REM Write a windowless VBScript shim. WScript hosts it without a console and
REM the 0 window style keeps the long-running cmd/pnpm child fully hidden.
> "%SHIM%" echo Set shell = CreateObject("WScript.Shell"^)
>>"%SHIM%" echo shell.Run Chr(34^) ^& "%LAUNCHER%" ^& Chr(34^), 0, False

if not exist "%SHIM%" (
    echo FAILED: could not write "%SHIM%"
    pause
    exit /b 1
)

echo.
echo Installed. Windows will start the backend when you log in.
echo.
echo   Startup entry : %SHIM%
echo   Runs          : %LAUNCHER%
echo.
type "%SHIM%"
echo.
echo Starting it now so you can check it works...
wscript.exe "%SHIM%"
echo.
echo The backend is now running in the background with no cmd window.
echo If it is not, or the app is unreachable, read:
echo   %~dp0..\logs\startup.log
echo.
echo To remove autostart later: scripts\uninstall-startup-windows.bat
echo.
pause

endlocal
