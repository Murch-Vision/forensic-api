@echo off
setlocal DisableDelayedExpansion
REM Windows PowerShell is built into Windows 11; VBScript is not required.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-runtime.ps1" -Action Start
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
    echo Startup failed. Read the error above and logs\startup.log.
    pause
)
exit /b %RESULT%
