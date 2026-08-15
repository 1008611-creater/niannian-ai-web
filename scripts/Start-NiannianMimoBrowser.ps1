[CmdletBinding()]
param(
  [string]$ProjectDirectory = ""
)

$ErrorActionPreference = "Stop"
$ProjectDirectory = if ([string]::IsNullOrWhiteSpace($ProjectDirectory)) { Split-Path -Parent $PSScriptRoot } else { $ProjectDirectory }
$project = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$endpoint = "http://127.0.0.1:9226"
$profile = if ([string]::IsNullOrWhiteSpace($env:NIANNIAN_MIMO_BROWSER_PROFILE)) { Join-Path $env:ProgramData "Niannian\MimoBrowserProfile" } else { $env:NIANNIAN_MIMO_BROWSER_PROFILE }
$mimoBase = if ([string]::IsNullOrWhiteSpace($env:MIMO_BASE_URL)) { "https://fd.aancn.cn" } else { ([uri]$env:MIMO_BASE_URL).GetLeftPart([System.UriPartial]::Authority) }

function Test-CdpReady {
  try {
    $version = Invoke-RestMethod -Uri "$endpoint/json/version" -TimeoutSec 2
    return -not [string]::IsNullOrWhiteSpace($version.webSocketDebuggerUrl)
  } catch { return $false }
}

if (Test-CdpReady) { exit 0 }
$edgeCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe")
)
$browser = $edgeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($browser)) { throw "MIMO_BROWSER_BINARY_MISSING" }
New-Item -ItemType Directory -Path $profile -Force | Out-Null
$arguments = @(
  "--headless=new",
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=9226",
  "--user-data-dir=$profile",
  "--no-first-run",
  "--no-default-browser-check",
  $mimoBase
)
Start-Process -FilePath $browser -ArgumentList $arguments -WindowStyle Hidden | Out-Null
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  if (Test-CdpReady) { exit 0 }
  Start-Sleep -Milliseconds 500
}
throw "MIMO_CDP_START_TIMEOUT"
