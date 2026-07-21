@echo off
REM ============================================================
REM  Forensic Analyst — Backend launcher (Windows / cmd)
REM  Started automatically at boot by the registered Scheduled
REM  Task (see install-startup-windows.bat). Can also be run
REM  manually by double-clicking.
REM
REM  Uses npm (not pnpm) so it works from the SYSTEM account at
REM  boot. Runs as a restart loop: the in-app "Update" button
REM  pulls new code and exits with code 42, which reinstalls
REM  deps, re-runs migrations and relaunches the new version.
REM ============================================================

setlocal enabledelayedexpansion

REM Move to the project root (this script lives in <root>\scripts).
cd /d "%~dp0.."

REM Tell the server it is running under this managed loop, so selfUpdate is
REM allowed to exit-42 for an automatic restart.
set "FAW_MANAGED=1"

REM Also pull the sibling frontend repo on "Update", if present.
if exist "..\forensic-frontend\.git" set "FAW_UPDATE_REPOS=%CD%\..\forensic-frontend"

:loop
REM Install dependencies on first run / after an update pulled new packages.
if not exist "node_modules" (
    echo [start-windows] Installing dependencies...
    call npm install
)

REM Apply any pending database migrations before serving.
echo [start-windows] Running database migrations...
call npm run migrate

echo [start-windows] Starting backend...
call npm run start

REM Exit code 42 == "update pulled, restart me". Reinstall deps (in case
REM package.json changed) and loop; any other exit code ends the launcher.
if !errorlevel! equ 42 (
    echo [start-windows] Update applied — reinstalling and restarting...
    call npm install
    goto loop
)

endlocal
