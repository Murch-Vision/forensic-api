@echo off
REM ============================================================
REM  Forensic Analyst — Backend autostart uninstaller (Windows)
REM
REM  Removes the Startup-folder entry. Just double-click it.
REM  Also clears the old Scheduled Task if one is still around.
REM ============================================================

setlocal

set "NAME=ForensicAnalystBackend"
set "SHIM=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\%NAME%.bat"

if exist "%SHIM%" (
    del /f /q "%SHIM%"
    echo Removed autostart entry.
) else (
    echo No autostart entry found.
)

REM Legacy Scheduled Task from older versions (needs admin; ignore failure).
schtasks /End /TN "%NAME%" >nul 2>&1
schtasks /Delete /TN "%NAME%" /F >nul 2>&1

echo.
echo Note: this does not stop a running instance. Close the
echo "%NAME%" window, or reboot.
echo.
pause

endlocal
