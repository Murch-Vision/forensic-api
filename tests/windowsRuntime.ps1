$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
. (Join-Path $repo 'scripts/windows-runtime.ps1')
. (Join-Path $repo 'scripts/project-process-windows.ps1')

function Assert-True($Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Open-ExclusiveLog([string]$Path) {
    if ($env:OS -ne 'Windows_NT') {
        # Unix does not enforce Windows sharing flags. Make the path unwritable
        # instead, to exercise the same fallback with a real filesystem error.
        $backup = $Path + '.test-lock-backup'
        if (Test-Path -LiteralPath $Path) { Move-Item -LiteralPath $Path -Destination $backup }
        New-Item -ItemType Directory -Path $Path | Out-Null
        return [pscustomobject]@{IsDirectoryBlock=$true; Path=$Path; Backup=$backup}
    }
    # On Windows reproduce the actual exclusive lock in another process.
    # Wait for its readiness handshake and always reap it in the caller's finally.
    $escaped = $Path.Replace("'", "''")
    $code = "`$stream = [IO.File]::Open('$escaped', [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None); try { [Console]::Out.WriteLine('locked'); Start-Sleep -Seconds 60 } finally { `$stream.Dispose() }"
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $info.Arguments = '-NoProfile -NonInteractive -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    $null = $process.Start()
    if ($process.StandardOutput.ReadLine() -ne 'locked') {
        $errorText = $process.StandardError.ReadToEnd()
        Close-ExclusiveLog $process
        throw "Could not acquire test log lock: $errorText"
    }
    return $process
}

function Close-ExclusiveLog($Process) {
    if ($Process.PSObject.Properties['IsDirectoryBlock']) {
        Remove-Item -LiteralPath $Process.Path -Force
        if (Test-Path -LiteralPath $Process.Backup) { Move-Item -LiteralPath $Process.Backup -Destination $Process.Path }
        return
    }
    if (-not $Process.HasExited) { $Process.Kill() }
    $Process.WaitForExit()
    $Process.Dispose()
}

# No installs, actual database changes or termination of application processes.
# Lock helper children are reaped; the package manager is simulated.
$originalLocation = Get-Location
$fixture = Join-Path $repo ('logs/Windows test (space)-' + [char]0x041C + [guid]::NewGuid())
New-Item -ItemType Directory -Path $fixture -Force | Out-Null
$script:ProjectDir = $fixture
$script:LogFile = Join-Path $fixture 'startup.log'
$nativeNode = (Get-Command node -ErrorAction Stop).Source
$originalInvoker = ${function:Invoke-Checked}
$primaryLog = $script:LogFile
$heldLog = Open-ExclusiveLog $primaryLog
try {
    # Reproduce the screenshot: another process owns the main startup log.
    Write-Log 'locked log regression'
    $fallbackLog = Join-Path $fixture ("startup-$PID.log")
    Assert-True ($script:LogFile -eq $fallbackLog) 'Use a process-specific log while startup.log is exclusively locked.'
    Assert-True ((Get-Content -LiteralPath $fallbackLog -Raw) -match 'locked log regression') 'Preserve the diagnostic in the fallback log.'
    $nativeCode = & $originalInvoker $nativeNode @('-e', 'process.exit(0)')
    Assert-True ($nativeCode -eq 0) 'A locked startup.log must not abort successful commands.'
    $nativeFailure = $false
    try { & $originalInvoker $nativeNode @('-e', 'process.exit(7)') } catch {
        $nativeFailure = $_.Exception.Message -match 'failed \(exit 7\)'
    }
    Assert-True $nativeFailure 'Keep the real process error when the main log is locked.'

    $heldFallback = Open-ExclusiveLog $fallbackLog
    try {
        Write-Log 'both logs locked; console survives'
        Assert-True $script:LogDisabled 'Fall back to console if neither log can be written.'
        $nativeCode = & $originalInvoker $nativeNode @('-e', 'process.exit(0)')
        Assert-True ($nativeCode -eq 0) 'Even unavailable fallback logs must not stop the command.'
    } finally { Close-ExclusiveLog $heldFallback }
} finally {
    Close-ExclusiveLog $heldLog
    $script:LogFile = $primaryLog
    $script:LogDisabled = $false
}
Write-Log 'log available again'
Assert-True ((Get-Content -LiteralPath $primaryLog -Raw) -match 'log available again') 'Write normally after releasing the file.'
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

    $script:LogFile = $primaryLog
    $heldLog = Open-ExclusiveLog $primaryLog
    try {
        $script:Calls.Clear()
        Assert-True ((Invoke-Launcher) -eq 0) 'Start the service even when the first startup log line is locked.'
        Assert-True ($script:Calls.Contains('run start')) 'A diagnostic file lock must not prevent serving.'
        $script:FailAt = '^install '
        Assert-True ((Invoke-Launcher) -eq 1) 'Keep setup failure status without throwing again from the catch logger.'
    } finally {
        Close-ExclusiveLog $heldLog
        $script:LogFile = $primaryLog
        $script:FailAt = ''
    }

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
