$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
. (Join-Path $repo 'scripts/windows-runtime.ps1')
. (Join-Path $repo 'scripts/project-process-windows.ps1')

function Assert-True($Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

# No installs, actual database changes, process termination or background jobs.
# Exercise the launcher control flow with a simulated package manager.
$originalLocation = Get-Location
$fixture = Join-Path $repo ('logs/Windows test (space)-' + [char]0x041C + [guid]::NewGuid())
New-Item -ItemType Directory -Path $fixture -Force | Out-Null
$script:ProjectDir = $fixture
$script:LogFile = Join-Path $fixture 'startup.log'
$nativeNode = (Get-Command node -ErrorAction Stop).Source
$originalInvoker = ${function:Invoke-Checked}
$nativeCode = & $originalInvoker $nativeNode @('-e', 'console.error("stderr can accompany success"); process.exit(0)')
Assert-True ($nativeCode -eq 0) 'Log stderr without rejecting successful native commands.'
$nativeFailure = $false
try { & $originalInvoker $nativeNode @('-e', 'process.exit(7)') } catch { $nativeFailure = $true }
Assert-True $nativeFailure 'Propagate native process exit codes.'
$missingFailure = $false
try { & $originalInvoker 'forensic-nonexistent-command' @() } catch { $missingFailure = $true }
Assert-True $missingFailure 'A missing executable must not inherit the last successful exit code.'
$script:Calls = [Collections.Generic.List[string]]::new()
$script:FailAt = ''
$script:RestartOnce = $false
$script:Commit = 'a' * 40
function Initialize-Runtime { $script:Node = 'node'; $script:Pnpm = 'pnpm' }
function Get-Commit { return $script:Commit }
function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments, [int[]]$AllowedExitCodes = @(0))
    $call = $Arguments -join ' '
    $script:Calls.Add($call)
    if ($script:FailAt -and $call -match $script:FailAt) { throw 'Simulated command failure' }
    if ($call -eq 'run start' -and $script:RestartOnce) {
        $script:RestartOnce = $false
        return 42
    }
    if ($call -eq 'run build') {
        New-Item -ItemType Directory -Path (Join-Path $fixture 'dist') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $fixture 'dist/index.html') -Value '<html></html>'
    }
    return 0
}

try {
    Set-Location -LiteralPath $fixture
    Set-Content -LiteralPath 'package.json' -Value '{"name":"forensic-analyst-backend"}'
    $Action = 'Start'
    $script:FailAt = '^install '
    Assert-True ((Invoke-Launcher) -eq 1) 'Install failure must fail startup.'
    Assert-True ($script:Calls.Count -eq 1) 'Do not migrate or serve after install fails.'

    $script:Calls.Clear(); $script:FailAt = '^run migrate$'
    Assert-True ((Invoke-Launcher) -eq 1) 'Migration failure must fail startup.'
    Assert-True (-not $script:Calls.Contains('run start')) 'Do not serve an incompatible database.'
    Assert-True ($script:Calls.Contains('scripts/check-runtime.cjs --native')) 'Check native SQLite/sharp before migration.'

    $script:Calls.Clear(); $script:FailAt = ''
    Assert-True ((Invoke-Launcher) -eq 0) 'Successful setup should start the API.'
    Assert-True ($script:Calls.Contains('run start')) 'Start the API after preparing it.'
    Assert-True ($script:Calls.Contains('install --frozen-lockfile --prod=false')) 'Use locked dependencies including startup tools.'

    $script:Calls.Clear(); $script:RestartOnce = $true
    Assert-True ((Invoke-Launcher) -eq 0) 'Restart after an in-app update exits with code 42.'
    $installCount = @($script:Calls | Where-Object { $_ -eq 'install --frozen-lockfile --prod=false' }).Count
    Assert-True ($installCount -eq 2) 'Reinstall and migrate on restart, not just relaunch stale code.'

    $script:Calls.Clear()
    Prepare-Project 'Frontend'
    Assert-True ($script:Calls.Contains('run build')) 'Build missing frontend output.'
    Assert-True ((Get-Content 'dist/.commit' -Raw).Trim() -eq $script:Commit) 'Stamp successful build.'
    $script:Calls.Clear()
    Prepare-Project 'Frontend'
    Assert-True (-not $script:Calls.Contains('run build')) 'Do not rebuild matching output at every login.'
    $script:Commit = 'b' * 40
    $script:FailAt = '^run build$'
    $failed = $false
    try { Prepare-Project 'Frontend' } catch { $failed = $true }
    Assert-True $failed 'A stale frontend build must fail when rebuilding fails.'
    Assert-True ((Get-Content 'dist/.commit' -Raw).Trim() -eq ('a' * 40)) 'Never stamp failed builds as current.'
    $script:FailAt = ''; $script:Calls.Clear()
    Prepare-Project 'Frontend'
    Assert-True ($script:Calls.Contains('run build')) 'Rebuild after a pull even if dist already exists.'

    # Windows path matching is tested without touching any real processes.
    $directory = [IO.Path]::GetFullPath('C:\Murch (test)\forensic-api')
    $pidForTest = $PID + 1000
    $process = @{Name='powershell.exe'; ProcessId=$pidForTest; CommandLine=('powershell.exe -File "' + $directory + '\scripts\windows-runtime.ps1" -Action Start')}
    Assert-True (Test-ProjectProcess $process $directory) 'Find hidden PowerShell launchers.'
    $process.CommandLine = $process.CommandLine.Replace('-Action Start', '-Action UpdateAll')
    Assert-True (-not (Test-ProjectProcess $process $directory)) 'Do not kill the updater itself.'
    $process = @{Name='node.exe'; ProcessId=$pidForTest; CommandLine=('node "' + $directory + '-other\node_modules\tsx\cli.js"')}
    Assert-True (-not (Test-ProjectProcess $process $directory)) 'Do not kill a similarly named checkout.'
    $process.CommandLine = $process.CommandLine.Replace('forensic-api-other', 'forensic-api')
    Assert-True (Test-ProjectProcess $process $directory) 'Find this checkout native Node processes.'

    # On a Windows runner exercise real .lnk creation/removal without launching
    # a service, changing the user's existing entries, or relying on VBScript.
    if ($env:OS -eq 'Windows_NT') {
        function Prepare-Project { param([string]$Kind, [switch]$ForceBuild) }
        function Start-Hidden { param([string]$RunnerPath) }
        $script:FailAt = ''
        $entryKind = 'Test-' + [guid]::NewGuid()
        $shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) ('ForensicAnalyst' + $entryKind + '.lnk')
        try {
            Install-Startup $entryKind
            Assert-True (Test-Path -LiteralPath $shortcut) 'Install a .lnk startup entry.'
            $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
            Assert-True ($link.TargetPath -like '*powershell.exe') 'Launch PowerShell directly.'
            Assert-True ($link.Arguments -match '-Action Start') 'Shortcut starts the managed runner.'
            Uninstall-Startup $entryKind
            Assert-True (-not (Test-Path -LiteralPath $shortcut)) 'Remove the .lnk startup entry.'
        } finally {
            if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut -Force }
        }
    }
    Write-Host 'Windows launcher regression checks: PASS'
} finally {
    Set-Location $originalLocation
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
