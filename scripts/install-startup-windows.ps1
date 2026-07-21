<#
    Forensic Analyst — Backend boot autostart installer (Windows)

    Registers a Scheduled Task that runs scripts\start-windows.bat when the
    computer boots. Run once from an elevated PowerShell prompt:

        powershell -ExecutionPolicy Bypass -File scripts\install-startup-windows.ps1

    Re-running updates the existing task. Use -AtLogon to start at user logon
    instead of at system boot. Remove it with uninstall-startup-windows.ps1.
#>

param(
    [string]$TaskName = "ForensicAnalystBackend",
    [switch]$AtLogon
)

$ErrorActionPreference = "Stop"

# Resolve <root>\scripts\start-windows.bat regardless of where we are invoked.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$launcher  = Join-Path $scriptDir "start-windows.bat"

if (-not (Test-Path $launcher)) {
    throw "Launcher not found: $launcher"
}

Write-Host "Registering scheduled task '$TaskName' -> $launcher"

$action = New-ScheduledTaskAction -Execute "cmd.exe" `
    -Argument "/c `"$launcher`"" `
    -WorkingDirectory (Split-Path -Parent $scriptDir)

if ($AtLogon) {
    $trigger = New-ScheduledTaskTrigger -AtLogon
} else {
    $trigger = New-ScheduledTaskTrigger -AtStartup
}

# Run as SYSTEM so it works before any user logs in; survive on battery.
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Done. '$TaskName' will start the backend at $(if ($AtLogon) {'logon'} else {'boot'})."
Write-Host "Start it now with:  Start-ScheduledTask -TaskName $TaskName"
