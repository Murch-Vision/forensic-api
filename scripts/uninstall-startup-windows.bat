@echo off
REM ============================================================
REM  Forensic Analyst — Backend autostart uninstaller (Windows)
REM
REM  Removes the Startup-folder entry. Just double-click it.
REM  Also clears the old Scheduled Task if one is still around.
REM ============================================================

setlocal

set "NAME=ForensicAnalystBackend"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHIM=%STARTUP%\%NAME%.vbs"
set "OLD_SHIM=%STARTUP%\%NAME%.bat"

if exist "%SHIM%" (
    del /f /q "%SHIM%"
    echo Removed autostart entry.
) else (
    echo No autostart entry found.
)
if exist "%OLD_SHIM%" del /f /q "%OLD_SHIM%"

REM Legacy Scheduled Task from older versions (needs admin; ignore failure).
schtasks /End /TN "%NAME%" >nul 2>&1
schtasks /Delete /TN "%NAME%" /F >nul 2>&1

echo.
echo Note: this does not stop a hidden running instance. Reboot to stop it.
echo.
pause

endlocal
