@echo off
REM ============================================================
REM  Forensic Analyst — update BOTH checkouts (Windows)
REM
REM  Pulls, installs and builds forensic-api and forensic-frontend,
REM  then restarts whichever launchers are running.
REM
REM  Expects the two repos side by side, which is how they are
REM  cloned:
REM
REM      C:\Murch\forensic-api\
REM      C:\Murch\forensic-frontend\
REM
REM  Just double-click it. No administrator needed. This script is
REM  identical in both repos — run whichever copy you have.
REM ============================================================

setlocal enabledelayedexpansion

REM This script lives in <repo>\scripts, so two levels up holds both repos.
pushd "%~dp0..\.." || (
    echo FAILED: cannot reach the folder holding the repos.
    pause
    exit /b 1
)
set "ROOT=%CD%"
popd

echo ============================================================
echo  Updating from %ROOT%
echo ============================================================

set "FAILED="
set "CHANGED="

call :update "forensic-api"      "ForensicAnalystBackend"
call :update "forensic-frontend" "ForensicAnalystFrontend"

echo.
echo ============================================================
if defined FAILED (
    echo  FINISHED WITH ERRORS:!FAILED!
    echo  Scroll up for the failure. Nothing was restarted for those.
) else if defined CHANGED (
    echo  Updated:!CHANGED!
) else (
    echo  Already up to date — nothing to do.
)
echo ============================================================
echo.
pause
endlocal
exit /b 0


REM ---- :update <folder> <launcher window title> ---------------
:update
set "NAME=%~1"
set "TITLE=%~2"
set "DIR=%ROOT%\%NAME%"

echo.
echo --- %NAME% ------------------------------------------------

if not exist "%DIR%\.git" (
    echo   skipped — no git checkout at "%DIR%"
    goto :eof
)

pushd "%DIR%"

for /f "delims=" %%i in ('git rev-parse --short HEAD 2^>nul') do set "BEFORE=%%i"

REM A deployment clone often has no upstream branch, and a bare `git pull`
REM then fails with "no tracking information". Name origin + the current
REM branch when that is the case.
git rev-parse --abbrev-ref --symbolic-full-name @{u} >nul 2>&1
if errorlevel 1 (
    for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BR=%%b"
    echo   pulling origin !BR! ^(no upstream configured^)
    git pull --ff-only origin !BR!
) else (
    echo   pulling...
    git pull --ff-only
)
if errorlevel 1 (
    echo   FAILED to pull. Local changes? Try: git status
    set "FAILED=!FAILED! %NAME%"
    popd
    goto :eof
)

for /f "delims=" %%i in ('git rev-parse --short HEAD 2^>nul') do set "AFTER=%%i"

if "!BEFORE!"=="!AFTER!" (
    echo   already at !AFTER! — no new code
) else (
    echo   !BEFORE! -^> !AFTER!
    set "CHANGED=!CHANGED! %NAME%"
)

echo   installing dependencies...
call npm install
if errorlevel 1 (
    echo   FAILED: npm install
    set "FAILED=!FAILED! %NAME%"
    popd
    goto :eof
)

echo   building...
call npm run build
if errorlevel 1 (
    echo   FAILED: build
    set "FAILED=!FAILED! %NAME%"
    popd
    goto :eof
)

REM Restart the launcher only if it was already running — this script must not
REM start services on a machine where they were deliberately stopped.
tasklist /FI "WINDOWTITLE eq %TITLE%*" 2>nul | find /I "cmd.exe" >nul
if not errorlevel 1 (
    echo   restarting %TITLE%...
    taskkill /FI "WINDOWTITLE eq %TITLE%*" /T /F >nul 2>&1
    start "%TITLE%" /min cmd /c "%DIR%\scripts\start-windows.bat"
) else (
    echo   %TITLE% is not running — start it from the Start menu or
    echo   scripts\start-windows.bat
)

popd
goto :eof
