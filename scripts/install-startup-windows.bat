@echo off
REM ============================================================
REM  Forensic Analyst — Backend boot autostart installer (cmd)
REM
REM  Registers a Scheduled Task that runs scripts\start-windows.bat
REM  at system boot, using the Command Prompt (no PowerShell, no
REM  pnpm). Run this from an ELEVATED Command Prompt
REM  (Right-click -> "Run as administrator"):
REM
REM      scripts\install-startup-windows.bat
REM ============================================================

setlocal

set "TASK=ForensicAnalystBackend"
set "LAUNCHER=%~dp0start-windows.bat"

echo Registering scheduled task "%TASK%"
echo   -> %LAUNCHER%

REM /RU SYSTEM runs at boot before any user logs in; /RL HIGHEST = elevated.
schtasks /Create /TN "%TASK%" ^
  /TR "cmd /c \"%LAUNCHER%\"" ^
  /SC ONSTART /RU SYSTEM /RL HIGHEST /F

if %errorlevel%==0 (
    echo Done. "%TASK%" will start the backend at boot.
    echo Start it now with:  schtasks /Run /TN "%TASK%"
) else (
    echo FAILED to register the task. Are you running as administrator?
)

endlocal
