$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$runner = Join-Path $repo 'scripts\windows-runtime.ps1'
$helper = Join-Path $repo 'scripts\project-process-windows.ps1'
$powershell = Join-Path $PSHOME 'powershell.exe'
$package = Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
$api = $package.name -eq 'forensic-analyst-backend'
$url = if ($api) { "http://localhost:$env:PORT/health" } else { 'http://localhost:5173/login' }
$process = $null
try {
    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Action Start' -f $runner
    $process = Start-Process $powershell -ArgumentList $arguments -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        if ($process.HasExited) { throw "Launcher exited with $($process.ExitCode)" }
        try {
            $response = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { <# Wait for installation and listener. #> }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw "Preview failed to become ready: $url" }
    if ($api) {
        $result = Invoke-RestMethod "http://localhost:$env:PORT/" -Method Post -ContentType 'application/json' -Body '{"query":"{__typename}"}'
        if ($result.data.__typename -ne 'Query') { throw 'GraphQL smoke test failed.' }
    } elseif ($response.Content -notmatch '<div id="root">') {
        throw 'Built frontend HTML was not served.'
    }
    Write-Host 'Native Windows startup and HTTP smoke: PASS'
} finally {
    & $powershell -NoProfile -ExecutionPolicy Bypass -File $helper -ProjectDir $repo -Action Stop
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    if (Test-Path (Join-Path $repo 'logs\startup.log')) { Get-Content (Join-Path $repo 'logs\startup.log') -Tail 80 }
}
