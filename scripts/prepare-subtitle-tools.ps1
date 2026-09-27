$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'build/subtitle-tools.json') -Raw | ConvertFrom-Json
$target = Join-Path $projectRoot '.cache/subtitle-tools'
New-Item -ItemType Directory -Path $target -Force | Out-Null
$baseUrl = "https://github.com/$($manifest.repository)/releases/download/$($manifest.tag)"
function Test-Checksum($FilePath, $Expected) {
    return (Test-Path -LiteralPath $FilePath) -and (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash -eq $Expected
}
$executable = Join-Path $target 'ffmpeg.exe'
if (!(Test-Checksum $executable $manifest.executableSha256)) {
    $archive = Join-Path $projectRoot '.cache/subtitle-ffmpeg.gz'
    if (!(Test-Checksum $archive $manifest.archiveSha256)) {
        Invoke-WebRequest -Uri "$baseUrl/$($manifest.archive)" -OutFile $archive
    }
    if (!(Test-Checksum $archive $manifest.archiveSha256)) { throw 'Subtitle tool archive checksum mismatch.' }
    $inputFile = [IO.File]::OpenRead($archive)
    $gzip = [IO.Compression.GZipStream]::new($inputFile, [IO.Compression.CompressionMode]::Decompress)
    $outputFile = [IO.File]::Create($executable)
    try { $gzip.CopyTo($outputFile) } finally { $outputFile.Dispose(); $gzip.Dispose(); $inputFile.Dispose() }
}
if (!(Test-Checksum $executable $manifest.executableSha256)) { throw 'Subtitle tool executable checksum mismatch.' }
foreach ($notice in $manifest.notices) {
    $filePath = Join-Path $target $notice.file
    if (!(Test-Checksum $filePath $notice.sha256)) { Invoke-WebRequest -Uri "$baseUrl/$($notice.asset)" -OutFile $filePath }
    if (!(Test-Checksum $filePath $notice.sha256)) { throw "Subtitle tool notice checksum mismatch: $($notice.file)" }
}
Write-Output 'Subtitle extraction tool and upstream license/source notices verified.'
