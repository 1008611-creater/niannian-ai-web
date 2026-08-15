[CmdletBinding()]
param(
  [string]$ChromePath = "",
  [int]$DebugPort = 9236,
  [string]$ProfileDirectory = ""
)

$ErrorActionPreference = "Stop"
if ($DebugPort -lt 1024 -or $DebugPort -gt 65535) { throw "ASTORIE_CDP_PORT_INVALID" }
if ([string]::IsNullOrWhiteSpace($ChromePath)) {
  $ChromePath = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:LocalAppData\Microsoft\Edge\Application\msedge.exe"
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if ([string]::IsNullOrWhiteSpace($ChromePath) -or -not (Test-Path -LiteralPath $ChromePath -PathType Leaf)) { throw "CHROMIUM_BROWSER_NOT_FOUND" }
if ([string]::IsNullOrWhiteSpace($ProfileDirectory)) { $ProfileDirectory = Join-Path $env:LOCALAPPDATA "NiannianAStorieBrowser" }
New-Item -ItemType Directory -Force -Path $ProfileDirectory | Out-Null
$arguments = @(
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=$DebugPort",
  "--user-data-dir=$ProfileDirectory",
  "--no-first-run",
  "--no-default-browser-check",
  "https://astorie.ai/zh-CN/projects/"
)
Start-Process -FilePath $ChromePath -ArgumentList $arguments | Out-Null
[pscustomobject]@{ BrowserPath = $ChromePath; DebugEndpoint = "http://127.0.0.1:$DebugPort"; ProfileDirectory = $ProfileDirectory; LoginUrl = "https://astorie.ai/zh-CN/projects/" } | ConvertTo-Json -Compress
