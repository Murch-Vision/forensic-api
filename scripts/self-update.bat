@echo off
REM ============================================================
REM  Forensic Analyst — Backend self-update (Windows)
REM
REM  Pulls the latest code from git; if new commits arrived it
REM  reinstalls dependencies and restarts the boot Scheduled Task
REM  so the new version runs. No-op when already up to date.
REM
REM  Run manually, or schedule it (e.g. hourly) with:
REM    schtasks /Create /TN "ForensicAnalystBackendUpdate" ^
REM      /TR "\"%~f0\"" /SC HOURLY /RU SYSTEM /RL HIGHEST
REM ============================================================

setlocal enabledelayedexpansion

cd /d "%~dp0.."

set "TASK=ForensicAnalystBackend"

REM Remember the current commit, pull, then compare.
for /f %%i in ('git rev-parse HEAD') do set "BEFORE=%%i"
echo [self-update] Pulling latest code...
git pull --ff-only
for /f %%i in ('git rev-parse HEAD') do set "AFTER=%%i"

if "!BEFORE!"=="!AFTER!" (
    echo [self-update] Already up to date — nothing to restart.
    goto :eof
)

echo [self-update] New version pulled (!BEFORE:~0,7! -^> !AFTER:~0,7!).
echo [self-update] Reinstalling dependencies...
call npm install

echo [self-update] Restarting scheduled task '%TASK%'...
schtasks /End /TN "%TASK%" >nul 2>&1
schtasks /Run /TN "%TASK%" >nul 2>&1
echo [self-update] Done.

endlocal
