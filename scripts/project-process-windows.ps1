param(
    [string]$ProjectDir = (Split-Path $PSScriptRoot -Parent),

    [ValidateSet("Test", "Stop")]
    [string]$Action = "Test"
)

function Test-ProjectProcess($Process, [string]$Directory) {
    $projectPath = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
    $commandLine = [string]$Process.CommandLine
    if (-not $commandLine -or $Process.ProcessId -eq $PID) { return $false }
    $boundary = '(?=[\\/"\s]|$)'
    $project = [regex]::Escape($projectPath) + $boundary
    $launcher = [regex]::Escape("$projectPath\scripts\start-windows.bat") + '(?=["\s]|$)'
    $runner = [regex]::Escape("$projectPath\scripts\windows-runtime.ps1") + '(?=["\s]|$)'
    $isProjectNode = $Process.Name -ieq 'node.exe' -and $commandLine -imatch $project
    $isLegacyLauncher = $Process.Name -ieq 'cmd.exe' -and $commandLine -imatch $launcher
    $isManagedLauncher = $Process.Name -in @('powershell.exe', 'pwsh.exe') -and
        $commandLine -imatch $runner -and $commandLine -imatch '-Action\s+"?Start"?(?:\s|$)'
    return $isProjectNode -or $isLegacyLauncher -or $isManagedLauncher
}

if ($MyInvocation.InvocationName -eq '.') { return }
$ErrorActionPreference = 'Stop'
$processes = @(Get-CimInstance Win32_Process)
$matches = @($processes | Where-Object { Test-ProjectProcess $_ $ProjectDir })

if ($Action -eq "Test") {
    if ($matches.Count -gt 0) { exit 0 }
    exit 1
}

# Kill launcher roots first so taskkill /T also stops pnpm/node descendants.
# Then stop any directly-started project Node process that remains.
$ordered = @($matches | Sort-Object @{ Expression = { if ($_.Name -ieq 'node.exe') { 1 } else { 0 } } })
foreach ($process in $ordered) {
    if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) {
        & taskkill.exe /PID $process.ProcessId /T /F *> $null
        if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue)) {
            throw "Could not stop process $($process.ProcessId). Run as the same Windows user who started the app."
        }
    }
}

exit 0
