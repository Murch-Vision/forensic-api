@echo off
setlocal DisableDelayedExpansion
REM Windows PowerShell is built into Windows 11; VBScript is not required.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-runtime.ps1" -Action UninstallStartup
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
