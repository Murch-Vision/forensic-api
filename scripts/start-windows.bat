@echo off
REM ============================================================
REM  Forensic Analyst — Backend launcher (Windows)
REM  Started automatically at boot by the registered Scheduled
REM  Task (see install-startup-windows.ps1). Can also be run
REM  manually by double-clicking.
REM
REM  Runs as a restart loop: the in-app "Update" button pulls new
REM  code and exits with code 42, which reinstalls deps, re-runs
REM  migrations and relaunches the new version automatically.
REM ============================================================

setlocal enabledelayedexpansion

REM Move to the project root (this script lives in <root>\scripts).
cd /d "%~dp0.."

REM Tell the server it is running under this managed loop, so selfUpdate is
REM allowed to exit-42 for an automatic restart.
set "FAW_MANAGED=1"

REM Also pull the sibling frontend repo on "Update", if present. Adjust the
REM path if your frontend checkout lives elsewhere.
if exist "..\forensic-frontend\.git" set "FAW_UPDATE_REPOS=%CD%\..\forensic-frontend"

REM Locate pnpm; fall back to "corepack pnpm" if not on PATH.
where pnpm >nul 2>&1
if %errorlevel%==0 (
    set "PNPM=pnpm"
) else (
    set "PNPM=corepack pnpm"
)

:loop
REM Install dependencies on first run / after an update pulled new packages.
if not exist "node_modules" (
    echo [start-windows] Installing dependencies...
    call %PNPM% install --frozen-lockfile
)

REM Apply any pending database migrations before serving.
echo [start-windows] Running database migrations...
call %PNPM% migrate

echo [start-windows] Starting backend...
call %PNPM% start

REM Exit code 42 == "update pulled, restart me". Reinstall deps (in case
REM package.json changed) and loop; any other exit code ends the launcher.
if !errorlevel! equ 42 (
    echo [start-windows] Update applied — reinstalling and restarting...
    call %PNPM% install --frozen-lockfile
    goto loop
)

endlocal
