@echo off
REM ============================================================
REM  Forensic Analyst — Backend self-update (Windows)
REM
REM  Pulls the latest code from git; if new commits arrived it
REM  reinstalls dependencies and restarts the running launcher so
REM  the new version runs. No-op when already up to date.
REM
REM  Run manually (double-click) whenever you want the latest code.
REM ============================================================

setlocal enabledelayedexpansion

cd /d "%~dp0.."

set "NAME=ForensicAnalystBackend"

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

REM Close the running launcher window (it is titled by the installer shim) and
REM start it again on the new code.
echo [self-update] Restarting '%NAME%'...
taskkill /FI "WINDOWTITLE eq %NAME%*" /T /F >nul 2>&1
start "%NAME%" /min cmd /c "%~dp0start-windows.bat"
echo [self-update] Done.

endlocal
