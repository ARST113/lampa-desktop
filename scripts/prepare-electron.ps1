$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'build/electron-runtime.json') -Raw | ConvertFrom-Json
$cache = Join-Path $projectRoot '.cache'
$archive = Join-Path $cache 'electron-runtime.zip'
$runtime = Join-Path $cache 'electron-ac3-eac3'
New-Item -ItemType Directory -Path $cache -Force | Out-Null

if (!(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $manifest.sha256) {
    $url = "https://github.com/$($manifest.repository)/releases/download/$($manifest.tag)/$($manifest.asset)"
    Invoke-WebRequest -Uri $url -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $manifest.sha256) {
    throw 'Custom Electron ZIP checksum does not match the pinned build.'
}

Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
$version = (Get-Content -LiteralPath (Join-Path $runtime 'version') -Raw).Trim()
if ($version -ne $manifest.version) {
    throw "Expected Electron $($manifest.version), got $version"
}
node (Join-Path $PSScriptRoot 'verify-electron.cjs') (Join-Path $runtime 'electron.exe') (Join-Path $runtime 'ffmpeg.dll')
if ($LASTEXITCODE -ne 0) { throw 'Custom Electron runtime verification failed.' }
