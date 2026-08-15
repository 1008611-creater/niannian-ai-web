[CmdletBinding()]
param(
  [string]$ProjectDirectory = "",
  [string]$Origin = "https://sd2.cauai.fun"
)

$ErrorActionPreference = "Stop"
$ProjectDirectory = if ([string]::IsNullOrWhiteSpace($ProjectDirectory)) { Split-Path -Parent $PSScriptRoot } else { $ProjectDirectory }
$project = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$environmentFile = Join-Path $project ".env.local"
$agentScript = Join-Path $project "scripts\niannian-windows-dola-agent.mjs"
$logDirectory = Join-Path $project "logs"
$stdoutLog = Join-Path $logDirectory "dola-windows-agent.out.log"
$stderrLog = Join-Path $logDirectory "dola-windows-agent.err.log"

if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) { throw "DOLA_ENV_FILE_MISSING" }
if (-not (Test-Path -LiteralPath $agentScript -PathType Leaf)) { throw "DOLA_AGENT_SCRIPT_MISSING" }

foreach ($line in Get-Content -LiteralPath $environmentFile) {
  if ($line -notmatch '^\s*([^#=\s]+)\s*=\s*(.*)\s*$') { continue }
  $name = $matches[1]
  $value = $matches[2].Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  [Environment]::SetEnvironmentVariable($name, $value, "Process")
}

if ([string]::IsNullOrWhiteSpace($env:NIANNIAN_DOLA_AGENT_TOKEN) -or $env:NIANNIAN_DOLA_AGENT_TOKEN.Length -lt 24) {
  throw "NIANNIAN_DOLA_AGENT_TOKEN_REQUIRED"
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$ffprobe = (Get-Command ffprobe.exe -ErrorAction Stop).Source
$env:NIANNIAN_ORIGIN = $Origin
$env:NIANNIAN_FFPROBE_BIN = $ffprobe

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$mutex = [Threading.Mutex]::new($false, "Local\NiannianDolaWindowsAgent")
if (-not $mutex.WaitOne(0)) { exit 0 }

try {
  Push-Location $project
  try {
    & $node $agentScript run-loop 1>> $stdoutLog 2>> $stderrLog
    exit $LASTEXITCODE
  } finally {
    Pop-Location
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
