param(
    [ValidateSet('Start', 'Prepare', 'InstallStartup', 'UninstallStartup', 'UpdateAll')]
    [string]$Action = 'Start'
)

# Windows PowerShell 5.1 compatible. No VBScript engine or administrator needed.
$ErrorActionPreference = 'Stop'
$script:ProjectDir = Split-Path $PSScriptRoot -Parent
$script:LogFile = Join-Path $script:ProjectDir 'logs\startup.log'
$script:Runner = $PSCommandPath
$script:PowerShellExe = Join-Path $PSHOME 'powershell.exe'

function Write-Log([string]$Message) {
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Host $line
    Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8
}

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments, [int[]]$AllowedExitCodes = @(0))
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "Command not found: $Command"
    }
    Write-Log ('> {0} {1}' -f ([IO.Path]::GetFileName($Command)), ($Arguments -join ' '))
    # Windows PowerShell wraps native stderr in ErrorRecord objects. Log it
    # without treating a successful program's stderr as a terminating error.
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $global:LASTEXITCODE = $null
        & $Command @Arguments 2>&1 | ForEach-Object { Write-Log ([string]$_) }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    if ($code -notin $AllowedExitCodes) {
        throw ('{0} failed (exit {1}). See {2}' -f ([IO.Path]::GetFileName($Command)), $code, $script:LogFile)
    }
    return $code
}

function Find-Pnpm {
    $command = Get-Command pnpm.cmd, pnpm.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    $locations = @(
        "$env:PNPM_HOME\pnpm.exe", "$env:PNPM_HOME\pnpm.cmd",
        "$env:APPDATA\npm\pnpm.cmd", "$env:LOCALAPPDATA\pnpm\pnpm.exe",
        "$env:ProgramFiles\nodejs\pnpm.cmd", "$env:LOCALAPPDATA\Programs\nodejs\pnpm.cmd"
    )
    foreach ($location in $locations) { if (Test-Path -LiteralPath $location) { return $location } }
    throw 'pnpm not found. Install Node.js x64, then run: npm.cmd install -g pnpm@10.34.7'
}

function Initialize-Runtime {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $node) {
        throw 'Node.js not found. Install Node.js 22 LTS (22.12+) or 24 LTS x64, then sign out and back in.'
    }
    $script:Node = $node.Source
    $env:PATH = (Split-Path $script:Node -Parent) + ';' + $env:PATH
    $null = Invoke-Checked $script:Node @('scripts/check-runtime.cjs')
    $script:Pnpm = Find-Pnpm
    $version = & $script:Pnpm --version
    if ($LASTEXITCODE -ne 0 -or "$version".Trim() -notmatch '^10\.') {
        throw 'Use pnpm 10: npm.cmd install -g pnpm@10.34.7'
    }
    Write-Log "pnpm $version"
    $env:FAW_PNPM = $script:Pnpm
    $env:PATH = (Split-Path $script:Pnpm -Parent) + ';' + $env:PATH
    $env:CI = 'true'
    # NODE_ENV=production must not omit tsx, TypeScript or Vite during setup.
    $env:FAW_MANAGED = '1'
}

function Get-ProjectKind {
    $package = Get-Content -LiteralPath (Join-Path $script:ProjectDir 'package.json') -Raw | ConvertFrom-Json
    if ($package.name -eq 'forensic-analyst-backend') { return 'Backend' }
    if ($package.name -eq 'forensic-analyst-frontend') { return 'Frontend' }
    throw 'This launcher only supports forensic-api and forensic-frontend.'
}

function Get-Commit {
    $commit = & git -c "safe.directory=$script:ProjectDir" rev-parse HEAD 2>$null
    if ($LASTEXITCODE -eq 0) { return "$commit".Trim() }
    throw 'Cannot read the Git commit. Install Git for Windows and use a Git checkout.'
}

function Prepare-Project([string]$Kind, [switch]$ForceBuild) {
    $null = Invoke-Checked $script:Pnpm @('install', '--frozen-lockfile', '--prod=false')
    if ($Kind -eq 'Backend') {
        $null = Invoke-Checked $script:Node @('scripts/check-runtime.cjs', '--native')
        # Never start on a failed migration: the new API needs the new schema.
        $null = Invoke-Checked $script:Pnpm @('run', 'migrate')
        if ($ForceBuild) { $null = Invoke-Checked $script:Pnpm @('run', 'build') }
    } else {
        $commit = Get-Commit
        $marker = Join-Path $script:ProjectDir 'dist\.commit'
        $builtCommit = ''
        if (Test-Path -LiteralPath $marker) { $builtCommit = (Get-Content -LiteralPath $marker -Raw).Trim() }
        if ($ForceBuild -or $builtCommit -ne $commit -or -not (Test-Path -LiteralPath 'dist\index.html')) {
            $null = Invoke-Checked $script:Pnpm @('run', 'build')
            Set-Content -LiteralPath $marker -Value $commit -Encoding ASCII
        }
    }
}

function Start-Hidden([string]$RunnerPath) {
    # ArgumentList becomes one Windows command line; explicitly quote the path
    # so spaces, Cyrillic folder names and parentheses remain part of one arg.
    $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Action Start' -f $RunnerPath
    Start-Process -FilePath $script:PowerShellExe -ArgumentList $arguments -WindowStyle Hidden | Out-Null
}

function Install-Startup([string]$Kind) {
    # Validate/install/build in this visible console before registering startup.
    $helper = Join-Path $script:ProjectDir 'scripts\project-process-windows.ps1'
    $null = Invoke-Checked $script:PowerShellExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $helper, '-ProjectDir', $script:ProjectDir, '-Action', 'Stop')
    Prepare-Project $Kind -ForceBuild
    $name = 'ForensicAnalyst' + $Kind
    $startup = [Environment]::GetFolderPath('Startup')
    if (-not $startup) { throw 'Windows Startup folder was not found.' }
    $shortcutPath = Join-Path $startup ($name + '.lnk')
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $script:PowerShellExe
    $shortcut.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Action Start' -f $script:Runner
    $shortcut.WorkingDirectory = $script:ProjectDir
    $shortcut.WindowStyle = 7
    $shortcut.Save()
    # WScript.Shell COM can create .lnk files even when VBScript is disabled.
    foreach ($extension in @('.bat', '.vbs')) {
        $legacy = Join-Path $startup ($name + $extension)
        if (Test-Path -LiteralPath $legacy) { Remove-Item -LiteralPath $legacy -Force }
    }
    try { & schtasks.exe /Delete /TN $name /F *> $null } catch { <# Optional legacy task may not exist. #> }
    Write-Log "Startup shortcut installed: $shortcutPath"
    Start-Hidden $script:Runner
    Write-Log 'Start requested. Check logs/startup.log for the server result.'
}

function Uninstall-Startup([string]$Kind) {
    $name = 'ForensicAnalyst' + $Kind
    $startup = [Environment]::GetFolderPath('Startup')
    foreach ($extension in @('.lnk', '.bat', '.vbs')) {
        $entry = Join-Path $startup ($name + $extension)
        if (Test-Path -LiteralPath $entry) { Remove-Item -LiteralPath $entry -Force }
    }
    try { & schtasks.exe /Delete /TN $name /F *> $null } catch { <# Optional legacy task may not exist. #> }
    Write-Log 'Autostart removed. An already running instance is left running.'
}

function Update-All {
    $root = Split-Path $script:ProjectDir -Parent
    $failed = $false
    foreach ($name in @('forensic-frontend', 'forensic-api')) {
        $directory = Join-Path $root $name
        if (-not (Test-Path -LiteralPath (Join-Path $directory '.git'))) {
            Write-Log "Skipped $name (no sibling Git checkout)."
            continue
        }
        try {
            Push-Location -LiteralPath $directory
            $gitArgs = @('-c', "safe.directory=$directory")
            $null = Invoke-Checked 'git' ($gitArgs + @('rev-parse', '--is-inside-work-tree'))
            $hasUpstream = $false
            try {
                & git @gitArgs rev-parse --abbrev-ref --symbolic-full-name '@{u}' *> $null
                $hasUpstream = $LASTEXITCODE -eq 0
            } catch { <# No upstream: use origin and the checked-out branch. #> }
            if ($hasUpstream) {
                $null = Invoke-Checked 'git' ($gitArgs + @('pull', '--ff-only'))
            } else {
                $branch = & git @gitArgs rev-parse --abbrev-ref HEAD
                if ($LASTEXITCODE -ne 0 -or $branch -eq 'HEAD') { throw 'Check out a branch before updating.' }
                $null = Invoke-Checked 'git' ($gitArgs + @('pull', '--ff-only', 'origin', "$branch"))
            }
            $helper = Join-Path $directory 'scripts\project-process-windows.ps1'
            & $script:PowerShellExe -NoProfile -ExecutionPolicy Bypass -File $helper -ProjectDir $directory -Action Test
            $wasRunning = $LASTEXITCODE -eq 0
            if ($wasRunning) {
                # Native .node DLLs are locked on Windows. Stop this checkout
                # before pnpm can replace them, never every node.exe on the PC.
                $null = Invoke-Checked $script:PowerShellExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $helper, '-ProjectDir', $directory, '-Action', 'Stop')
            }
            $runner = Join-Path $directory 'scripts\windows-runtime.ps1'
            $null = Invoke-Checked $script:PowerShellExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $runner, '-Action', 'Prepare')
            if ($wasRunning) { Start-Hidden $runner }
            Write-Log "$name updated successfully."
        } catch {
            $failed = $true
            Write-Log "FAILED updating ${name}: $($_.Exception.Message)"
        } finally { Pop-Location }
    }
    if ($failed) { throw 'Update failed. Fix the logged error, then run update-all.bat again.' }
}

function Invoke-Launcher {
    New-Item -ItemType Directory -Path (Join-Path $script:ProjectDir 'logs') -Force | Out-Null
    Set-Location -LiteralPath $script:ProjectDir
    $mutex = $null
    $locked = $false
    try {
        $kind = Get-ProjectKind
        if ($Action -eq 'Start') {
            $hash = [Security.Cryptography.SHA256]::Create()
            try { $key = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($script:ProjectDir.ToLowerInvariant()))).Replace('-', '') }
            finally { $hash.Dispose() }
            $mutex = New-Object Threading.Mutex($false, "Local\Forensic-$key")
            try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
            if (-not $locked) { Write-Log 'This checkout is already running.'; return 0 }
        }
        Write-Log "$kind / $Action"
        if ($Action -eq 'UninstallStartup') { Uninstall-Startup $kind; return 0 }
        Initialize-Runtime
        switch ($Action) {
            'Prepare' { Prepare-Project $kind -ForceBuild }
            'InstallStartup' { Install-Startup $kind }
            'UpdateAll' { Update-All }
            'Start' {
                do {
                    Prepare-Project $kind
                    $code = Invoke-Checked $script:Pnpm @('run', 'start') -AllowedExitCodes @(0, 42)
                } while ($kind -eq 'Backend' -and $code -eq 42)
            }
        }
        return 0
    } catch {
        Write-Log "FAILED: $($_.Exception.Message)"
        return 1
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        if ($mutex) { $mutex.Dispose() }
    }
}

# Dot-sourcing loads functions for regression tests without starting a service.
if ($MyInvocation.InvocationName -ne '.') { exit (Invoke-Launcher) }
