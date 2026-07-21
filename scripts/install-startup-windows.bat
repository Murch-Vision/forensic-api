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
REM  The task is defined from XML rather than the schtasks command
REM  line, because the command-line defaults are what break boot
REM  autostart on real machines:
REM
REM    * DisallowStartIfOnBatteries defaults to TRUE — on a laptop
REM      that is not on mains power the task silently never runs.
REM    * ExecutionTimeLimit defaults to 3 days — a server is meant
REM      to run forever, and gets killed.
REM    * No restart-on-failure, so one early crash is permanent.
REM
REM  NOTE: the Windows "Startup" folder is NOT an alternative — it
REM  only runs after a user logs in, as that user. This task runs
REM  at boot with no login at all.
REM ============================================================

setlocal

set "TASK=ForensicAnalystBackend"
set "LAUNCHER=%~dp0start-windows.bat"
set "ROOT=%~dp0.."
set "XML=%TEMP%\%TASK%.xml"

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
set "NODEOK="
if exist "%ProgramFiles%\nodejs\npm.cmd" set "NODEOK=1"
if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" set "NODEOK=1"
if exist "%ProgramData%\chocolatey\bin\npm.cmd" set "NODEOK=1"
if not defined NODEOK (
    echo.
    echo   WARNING: no machine-wide Node install found.
    echo   Node looks installed for your user only, so the SYSTEM account
    echo   that runs the boot task will not find npm and nothing will start
    echo   after a restart. Install Node for ALL USERS from nodejs.org.
    echo.
)

echo Registering scheduled task "%TASK%"
echo   -^> %LAUNCHER%

REM --- Build the task definition. S-1-5-18 is the SYSTEM account SID.
> "%XML%" echo ^<?xml version="1.0"?^>
>>"%XML%" echo ^<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"^>
>>"%XML%" echo   ^<RegistrationInfo^>^<Description^>Forensic Analyst backend, started at boot.^</Description^>^</RegistrationInfo^>
>>"%XML%" echo   ^<Triggers^>^<BootTrigger^>^<Enabled^>true^</Enabled^>^<Delay^>PT30S^</Delay^>^</BootTrigger^>^</Triggers^>
>>"%XML%" echo   ^<Principals^>^<Principal id="Author"^>^<UserId^>S-1-5-18^</UserId^>^<RunLevel^>HighestAvailable^</RunLevel^>^</Principal^>^</Principals^>
>>"%XML%" echo   ^<Settings^>
>>"%XML%" echo     ^<MultipleInstancesPolicy^>IgnoreNew^</MultipleInstancesPolicy^>
>>"%XML%" echo     ^<DisallowStartIfOnBatteries^>false^</DisallowStartIfOnBatteries^>
>>"%XML%" echo     ^<StopIfGoingOnBatteries^>false^</StopIfGoingOnBatteries^>
>>"%XML%" echo     ^<AllowHardTerminate^>true^</AllowHardTerminate^>
>>"%XML%" echo     ^<StartWhenAvailable^>true^</StartWhenAvailable^>
>>"%XML%" echo     ^<RunOnlyIfNetworkAvailable^>false^</RunOnlyIfNetworkAvailable^>
>>"%XML%" echo     ^<IdleSettings^>^<StopOnIdleEnd^>false^</StopOnIdleEnd^>^<RestartOnIdle^>false^</RestartOnIdle^>^</IdleSettings^>
>>"%XML%" echo     ^<AllowStartOnDemand^>true^</AllowStartOnDemand^>
>>"%XML%" echo     ^<Enabled^>true^</Enabled^>
>>"%XML%" echo     ^<Hidden^>false^</Hidden^>
>>"%XML%" echo     ^<RunOnlyIfIdle^>false^</RunOnlyIfIdle^>
>>"%XML%" echo     ^<WakeToRun^>false^</WakeToRun^>
>>"%XML%" echo     ^<ExecutionTimeLimit^>PT0S^</ExecutionTimeLimit^>
>>"%XML%" echo     ^<Priority^>7^</Priority^>
>>"%XML%" echo     ^<RestartOnFailure^>^<Interval^>PT1M^</Interval^>^<Count^>3^</Count^>^</RestartOnFailure^>
>>"%XML%" echo   ^</Settings^>
>>"%XML%" echo   ^<Actions Context="Author"^>^<Exec^>
>>"%XML%" echo     ^<Command^>cmd.exe^</Command^>
>>"%XML%" echo     ^<Arguments^>/c "%LAUNCHER%"^</Arguments^>
>>"%XML%" echo     ^<WorkingDirectory^>%ROOT%^</WorkingDirectory^>
>>"%XML%" echo   ^</Exec^>^</Actions^>
>>"%XML%" echo ^</Task^>

schtasks /Create /TN "%TASK%" /XML "%XML%" /F
if not %errorlevel%==0 (
    echo.
    echo XML registration failed - falling back to the plain command line.
    echo (Battery and run-time-limit defaults will apply; if this is a laptop,
    echo  open Task Scheduler and untick "Start the task only if the computer
    echo  is on AC power".)
    schtasks /Create /TN "%TASK%" ^
      /TR "cmd /c \"%LAUNCHER%\"" ^
      /SC ONSTART /DELAY 0000:30 /RU SYSTEM /RL HIGHEST /F
    if not %errorlevel%==0 (
        echo FAILED to register the task.
        pause
        exit /b 1
    )
)
del "%XML%" >nul 2>&1

REM --- Verify it actually exists rather than trusting the exit code.
echo.
echo Verifying...
schtasks /Query /TN "%TASK%" /FO LIST | findstr /C:"TaskName" /C:"Status" /C:"Next Run Time"

echo.
echo Done. "%TASK%" will start the backend 30s after boot.
echo.
echo   Test it NOW without restarting:   schtasks /Run /TN "%TASK%"
echo   Wait 20s, then check it is alive: schtasks /Query /TN "%TASK%" /V /FO LIST
echo   "Last Result" 0 = running, 267009 = still running, anything else = failed.
echo   Whatever it says, the detail is in:
echo       type "%ROOT%\logs\startup.log"
echo.
pause

endlocal
