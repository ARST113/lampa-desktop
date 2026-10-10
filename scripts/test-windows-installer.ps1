$ErrorActionPreference = 'Stop'
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$installer = (Resolve-Path "dist/lampa-x64-$version.exe").Path
$installDir = Join-Path $env:RUNNER_TEMP 'LampaInstallerSmoke'
if (Test-Path -LiteralPath $installDir) {
  Remove-Item -LiteralPath $installDir -Recurse -Force
}

# NSIS silent installation with an explicitly isolated install directory.
# The /D= parameter must be last and must not be quoted within NSIS arguments.
Write-Host "Installing release candidate to $installDir"
$process = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -PassThru
if (-not $process.WaitForExit(120000)) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  throw 'NSIS installer did not terminate within 120 seconds.'
}
if ($process.ExitCode -ne 0) {
  throw "NSIS installer returned exit code $($process.ExitCode)."
}

$installedExe = Join-Path $installDir 'Lampa.exe'
$asar = Join-Path $installDir 'resources/app.asar'
$ffmpeg = Join-Path $installDir 'ffmpeg.dll'
foreach ($file in @($installedExe, $asar, $ffmpeg)) {
  if (!(Test-Path -LiteralPath $file)) {
    throw "Installer did not provide required file: $file"
  }
}

node test/installed-windows-smoke.cjs $installedExe
if ($LASTEXITCODE -ne 0) {
  throw "Installed app launch and renderer smoke test failed (exit $LASTEXITCODE)."
}

Write-Host 'PASS: NSIS installer installed, launched, and rendered a clean HTTP site.'
