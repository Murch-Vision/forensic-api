@echo off
REM ============================================================
REM  Forensic Analyst — Backend boot autostart installer (cmd)
REM
REM  Registers a Scheduled Task that runs scripts\start-windows.bat
REM  at system boot. Run this from an ELEVATED Command Prompt
REM  (Right-click -> "Run as administrator"):
REM
REM      scripts\install-startup-windows.bat
REM
REM  Refuses to run without admin rights, and verifies the task
REM  afterwards instead of assuming it took.
REM ============================================================

setlocal

set "TASK=ForensicAnalystBackend"
set "LAUNCHER=%~dp0start-windows.bat"

REM --- Must be elevated. Without this schtasks /RU SYSTEM fails with a
REM --- misleading "access denied" that is easy to miss in the scrollback.
net session >nul 2>&1
if not %errorlevel%==0 (
    echo.
    echo   NOT RUNNING AS ADMINISTRATOR.
    echo   Close this window, right-click Command Prompt, choose
    echo   "Run as administrator", then run this script again.
    echo.
    pause
    exit /b 1
)

if not exist "%LAUNCHER%" (
    echo FAILED: launcher not found at "%LAUNCHER%"
    pause
    exit /b 1
)

REM --- Node must be visible to SYSTEM, not just to you. A per-user Node
REM --- install is THE common reason boot autostart silently does nothing.
if not exist "%ProgramFiles%\nodejs\npm.cmd" (
  if not exist "%ProgramFiles(x86)%\nodejs\npm.cmd" (
    if not exist "%ProgramData%\chocolatey\bin\npm.cmd" (
      echo.
      echo   WARNING: no machine-wide Node install found.
      echo   Node looks installed for your user only, so the SYSTEM account
      echo   that runs the boot task will not find npm and nothing will start
      echo   after a restart. Install Node for ALL USERS from nodejs.org.
      echo.
    )
  )
)

echo Registering scheduled task "%TASK%"
echo   -^> %LAUNCHER%

REM /RU SYSTEM runs at boot before any user logs in; /RL HIGHEST = elevated.
REM /DELAY gives disks, network and any database service time to come up
REM first — starting the instant the kernel is up is a common cause of a
REM task that "ran" at boot and immediately died.
schtasks /Create /TN "%TASK%" ^
  /TR "cmd /c \"%LAUNCHER%\"" ^
  /SC ONSTART /DELAY 0000:30 /RU SYSTEM /RL HIGHEST /F

if not %errorlevel%==0 (
    echo FAILED to register the task.
    pause
    exit /b 1
)

REM --- Verify it actually exists rather than trusting the exit code.
echo.
echo Verifying...
schtasks /Query /TN "%TASK%" /FO LIST | findstr /C:"TaskName" /C:"Status" /C:"Next Run Time"
if not %errorlevel%==0 (
    echo FAILED: task was not found after creation.
    pause
    exit /b 1
)

echo.
echo Done. "%TASK%" will start the backend 30s after boot.
echo.
echo   Test it NOW without restarting:   schtasks /Run /TN "%TASK%"
echo   Then check it is alive:           schtasks /Query /TN "%TASK%" /V /FO LIST
echo   If it is not, read the log:       type "%~dp0..\logs\startup.log"
echo.
pause

endlocal
