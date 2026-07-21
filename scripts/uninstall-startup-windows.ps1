<#
    Forensic Analyst — Backend boot autostart uninstaller (Windows)

    Removes the Scheduled Task created by install-startup-windows.ps1. Run from
    an elevated PowerShell prompt:

        powershell -ExecutionPolicy Bypass -File scripts\uninstall-startup-windows.ps1
#>

param(
    [string]$TaskName = "ForensicAnalystBackend"
)

$ErrorActionPreference = "Stop"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'."
} else {
    Write-Host "No scheduled task named '$TaskName' found. Nothing to do."
}
