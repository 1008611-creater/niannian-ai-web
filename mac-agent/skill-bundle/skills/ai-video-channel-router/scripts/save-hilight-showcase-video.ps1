param(
    [Parameter(Mandatory = $true)]
    [string]$SourceUrl,

    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [string]$BaseName = "customer_video_01",
    [double]$TrimSeconds = 0.125,
    [long]$HistoryId = 0,
    [int]$CdpPort = 0,
    [string]$Ffmpeg = "ffmpeg",
    [string]$Ffprobe = "ffprobe"
)

$ErrorActionPreference = "Stop"

function Resolve-Executable {
    param([string]$NameOrPath)

    if (Test-Path -LiteralPath $NameOrPath) {
        return (Resolve-Path -LiteralPath $NameOrPath).Path
    }

    $cmd = Get-Command $NameOrPath -ErrorAction SilentlyContinue
    if ($null -eq $cmd) {
        throw "Executable not found: $NameOrPath"
    }
    return $cmd.Source
}

$ffmpegExe = Resolve-Executable $Ffmpeg
$ffprobeExe = Resolve-Executable $Ffprobe

$rawDir = Join-Path $OutputDir "_raw"
$qaDir = Join-Path $OutputDir "_qa"
$ledgerDir = Join-Path $OutputDir "_ledger"
foreach ($dir in @($OutputDir, $rawDir, $qaDir, $ledgerDir)) {
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$safeBase = $BaseName -replace '[\\/:*?"<>|]', '_'
$trimMs = [int][math]::Round($TrimSeconds * 1000)
$rawPath = Join-Path $rawDir "${safeBase}_raw_hilight_${stamp}.mp4"
$outputPath = Join-Path $OutputDir "${safeBase}_trim${trimMs}ms_${stamp}.mp4"
$qaStillPath = Join-Path $qaDir "${safeBase}_firstframe_${stamp}.jpg"
$manifestPath = Join-Path $ledgerDir "${safeBase}_manifest_${stamp}.json"

Invoke-WebRequest -Uri $SourceUrl -OutFile $rawPath

$rawProbeJson = & $ffprobeExe -v error -print_format json -show_streams -show_format $rawPath
$rawProbe = $rawProbeJson | ConvertFrom-Json
$rawDuration = [double]$rawProbe.format.duration

& $ffmpegExe -y -ss $TrimSeconds -i $rawPath -map 0:v:0 -map 0:a? -c:v libx264 -preset veryfast -crf 18 -c:a aac -b:a 192k -movflags +faststart $outputPath | Out-Null
& $ffmpegExe -y -i $outputPath -frames:v 1 -update 1 -q:v 2 $qaStillPath | Out-Null

$outProbeJson = & $ffprobeExe -v error -print_format json -show_streams -show_format $outputPath
$outProbe = $outProbeJson | ConvertFrom-Json
$outDuration = [double]$outProbe.format.duration
$durationDelta = $rawDuration - $outDuration
$videoStream = @($outProbe.streams | Where-Object { $_.codec_type -eq "video" })[0]
$audioStream = @($outProbe.streams | Where-Object { $_.codec_type -eq "audio" })[0]

$manifest = [ordered]@{
    source_url = $SourceUrl
    history_id = $HistoryId
    cdp_port = $CdpPort
    created_at = (Get-Date).ToString("s")
    trim_seconds = $TrimSeconds
    raw_path = $rawPath
    raw_size = (Get-Item -LiteralPath $rawPath).Length
    raw_duration = [math]::Round($rawDuration, 3)
    raw_sha256 = (Get-FileHash -LiteralPath $rawPath -Algorithm SHA256).Hash
    output_path = $outputPath
    output_size = (Get-Item -LiteralPath $outputPath).Length
    output_duration = [math]::Round($outDuration, 3)
    output_sha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash
    output_video = if ($videoStream) { "$($videoStream.width)x$($videoStream.height) $($videoStream.codec_name) $($videoStream.avg_frame_rate)" } else { $null }
    output_audio = if ($audioStream) { $audioStream.codec_name } else { $null }
    qa_still_path = $qaStillPath
    verified = [ordered]@{
        exists = (Test-Path -LiteralPath $outputPath)
        duration_trimmed = ($durationDelta -gt ($TrimSeconds - 0.2) -and $durationDelta -lt ($TrimSeconds + 0.2))
        has_video = ($null -ne $videoStream)
        has_audio = ($null -ne $audioStream)
        qa_still_exists = (Test-Path -LiteralPath $qaStillPath)
    }
}

$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$manifest | ConvertTo-Json -Depth 8
