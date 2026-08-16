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

REM pnpm has no TTY here and ABORTS on any confirmation prompt.
set "CI=true"

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

REM Windows git refuses a repo owned by another account ("dubious
REM ownership"). Carry the exception on the command line so it applies to
REM whoever double-clicked this, not to whoever once typed a git config.
set "GIT=git -c safe.directory=%DIR%"

for /f "delims=" %%i in ('!GIT! rev-parse --short HEAD 2^>nul') do set "BEFORE=%%i"

REM A deployment clone often has no upstream branch, and a bare `git pull`
REM then fails with "no tracking information". Name origin + the current
REM branch when that is the case.
!GIT! rev-parse --abbrev-ref --symbolic-full-name @{u} >nul 2>&1
if errorlevel 1 (
    for /f "delims=" %%b in ('!GIT! rev-parse --abbrev-ref HEAD') do set "BR=%%b"
    echo   pulling origin !BR! ^(no upstream configured^)
    !GIT! pull --ff-only origin !BR!
) else (
    echo   pulling...
    !GIT! pull --ff-only
)
if errorlevel 1 (
    echo   FAILED to pull. Local changes? Try: git status
    set "FAILED=!FAILED! %NAME%"
    popd
    goto :eof
)

for /f "delims=" %%i in ('!GIT! rev-parse --short HEAD 2^>nul') do set "AFTER=%%i"

if "!BEFORE!"=="!AFTER!" (
    echo   already at !AFTER! — no new code
) else (
    echo   !BEFORE! -^> !AFTER!
    set "CHANGED=!CHANGED! %NAME%"
)

echo   installing dependencies...
call pnpm install
if errorlevel 1 (
    echo   FAILED: pnpm install
    set "FAILED=!FAILED! %NAME%"
    popd
    goto :eof
)

echo   building...
call pnpm run build
if errorlevel 1 (
    echo   FAILED: build
    set "FAILED=!FAILED! %NAME%"
    popd
    goto :eof
)

REM Record the commit this build was made from. The Settings page compares the
REM marker against the checked-out commit to say whether the screen is current;
REM without it a fresh build still reports as stale forever. Only the frontend
REM has a dist\ — the backend builds to nothing (tsc --noEmit).
if exist "dist" (
    for /f "delims=" %%i in ('!GIT! rev-parse HEAD 2^>nul') do >"dist\.commit" echo %%i
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
