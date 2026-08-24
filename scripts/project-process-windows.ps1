param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectDir,

    [ValidateSet("Test", "Stop")]
    [string]$Action = "Test"
)

$projectPath = [IO.Path]::GetFullPath($ProjectDir).TrimEnd('\')
$launcherPath = "$projectPath\scripts\start-windows.bat"
$comparison = [StringComparison]::OrdinalIgnoreCase

$processes = @(Get-CimInstance Win32_Process)
$matches = @($processes | Where-Object {
    $commandLine = [string]$_.CommandLine
    if (-not $commandLine) { return $false }

    $isProjectNode = $_.Name -ieq "node.exe" -and
        $commandLine.IndexOf($projectPath, $comparison) -ge 0
    $isManagedLauncher = $_.Name -ieq "cmd.exe" -and
        $commandLine.IndexOf($launcherPath, $comparison) -ge 0

    $isProjectNode -or $isManagedLauncher
})

if ($Action -eq "Test") {
    if ($matches.Count -gt 0) { exit 0 }
    exit 1
}

# Kill launcher roots first so taskkill /T also stops pnpm/node descendants.
# Then stop any directly-started project Node process that remains.
$ordered = @($matches | Sort-Object @{ Expression = { if ($_.Name -ieq "cmd.exe") { 0 } else { 1 } } })
foreach ($process in $ordered) {
    if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) {
        & taskkill.exe /PID $process.ProcessId /T /F *> $null
    }
}

exit 0
