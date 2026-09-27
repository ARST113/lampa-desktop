$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'build/subtitle-tools.json') -Raw | ConvertFrom-Json
$target = Join-Path $projectRoot '.cache/subtitle-tools'
New-Item -ItemType Directory -Path $target -Force | Out-Null
$baseUrl = "https://github.com/$($manifest.repository)/releases/download/$($manifest.tag)"
function Test-Checksum($FilePath, $Expected) {
    return (Test-Path -LiteralPath $FilePath) -and (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash -eq $Expected
}
function Prepare-Executable($Asset, $ArchiveHash, $FileName, $ExecutableHash) {
  $executable = Join-Path $target $FileName
  if (!(Test-Checksum $executable $ExecutableHash)) {
    $archive = Join-Path $projectRoot ".cache/$Asset"
    if (!(Test-Checksum $archive $ArchiveHash)) {
        Invoke-WebRequest -Uri "$baseUrl/$Asset" -OutFile $archive
    }
    if (!(Test-Checksum $archive $ArchiveHash)) { throw 'Subtitle tool archive checksum mismatch.' }
    $inputFile = [IO.File]::OpenRead($archive)
    $gzip = [IO.Compression.GZipStream]::new($inputFile, [IO.Compression.CompressionMode]::Decompress)
    $outputFile = [IO.File]::Create($executable)
    try { $gzip.CopyTo($outputFile) } finally { $outputFile.Dispose(); $gzip.Dispose(); $inputFile.Dispose() }
  }
  if (!(Test-Checksum $executable $ExecutableHash)) { throw 'Subtitle tool executable checksum mismatch.' }
}
Prepare-Executable $manifest.archive $manifest.archiveSha256 'ffmpeg.exe' $manifest.executableSha256
Prepare-Executable $manifest.probeArchive $manifest.probeArchiveSha256 'ffprobe.exe' $manifest.probeSha256
foreach ($notice in $manifest.notices) {
    $filePath = Join-Path $target $notice.file
    if (!(Test-Checksum $filePath $notice.sha256)) { Invoke-WebRequest -Uri "$baseUrl/$($notice.asset)" -OutFile $filePath }
    if (!(Test-Checksum $filePath $notice.sha256)) { throw "Subtitle tool notice checksum mismatch: $($notice.file)" }
}
Write-Output 'Subtitle extraction tool and upstream license/source notices verified.'
