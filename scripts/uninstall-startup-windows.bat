@echo off
REM ============================================================
REM  Forensic Analyst — Backend boot autostart uninstaller (cmd)
REM
REM  Removes the Scheduled Task created by
REM  install-startup-windows.bat. Run from an ELEVATED Command
REM  Prompt:
REM
REM      scripts\uninstall-startup-windows.bat
REM ============================================================

setlocal
set "TASK=ForensicAnalystBackend"
schtasks /End /TN "%TASK%" >nul 2>&1
schtasks /Delete /TN "%TASK%" /F
endlocal
