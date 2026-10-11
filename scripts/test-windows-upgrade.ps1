$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true') { throw 'CI-only installer upgrade test' }
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$installer = (Resolve-Path "dist/lampa-x64-$version.exe").Path
$installDir = Join-Path $env:RUNNER_TEMP 'LampaInstallerSmoke'
$appExe = Join-Path $installDir 'Lampa.exe'
if (!(Test-Path $appExe)) { throw "Missing installed executable: $appExe" }

$config = Join-Path $env:APPDATA 'Lampa/config.json'
New-Item -ItemType Directory -Path (Split-Path $config -Parent) -Force | Out-Null
$previous = if (Test-Path $config) { [IO.File]::ReadAllBytes($config) } else { $null }
$launched = $null
try {
    '{"lampaUrl":"http://lampa.mx/","autoUpdate":false,"tsAutoStart":false}' |
      Set-Content -LiteralPath $config -Encoding utf8
    # This deliberately reproduces the user's condition: reinstall while
    # the old Lampa process is alive, possibly with its BrowserWindow hidden.
    $launched = Start-Process -FilePath $appExe -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 4
    $launched.Refresh()
    if ($launched.HasExited) {
        throw "Old Lampa executable quit before the upgrade test, exit $($launched.ExitCode)."
    }
    Write-Host "Old Lampa process running: PID=$($launched.Id); reinstalling silently"
    $upgrade = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -PassThru
    if (-not $upgrade.WaitForExit(90000)) {
        Stop-Process -Id $upgrade.Id -Force -ErrorAction SilentlyContinue
        throw 'NSIS upgrade could not close the existing Lampa process within 90 seconds.'
    }
    if ($upgrade.ExitCode -ne 0) {
        throw "NSIS upgrade failed to close running Lampa; exit $($upgrade.ExitCode)."
    }
    $launched.Refresh()
    if (-not $launched.HasExited) {
        throw 'NSIS reported success but old Lampa process is still running.'
    }
    if (!(Test-Path $appExe)) { throw 'Installed EXE missing after in-place upgrade.' }
    Write-Host 'PASS: installer upgraded Lampa while the previous EXE was running.'
}
finally {
    if ($null -ne $launched) {
        Stop-Process -Id $launched.Id -Force -ErrorAction SilentlyContinue
    }
    if ($null -eq $previous) {
        Remove-Item -LiteralPath $config -Force -ErrorAction SilentlyContinue
    } else {
        [IO.File]::WriteAllBytes($config, $previous)
    }
}
