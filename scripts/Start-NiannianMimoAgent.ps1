[CmdletBinding()]
param(
  [string]$ProjectDirectory = "",
  [string]$AgentCommand = "run-loop",
  [string[]]$AgentArguments = @()
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$ProjectDirectory = if ([string]::IsNullOrWhiteSpace($ProjectDirectory)) { Split-Path -Parent $PSScriptRoot } else { $ProjectDirectory }
$project = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if ([string]::IsNullOrWhiteSpace($node)) {
  $node = Join-Path ${env:ProgramFiles} "nodejs\node.exe"
}
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw "NODE_RUNTIME_MISSING" }
$agent = Join-Path $project "scripts\niannian-windows-mimo-agent.mjs"
$browser = Join-Path $project "scripts\Start-NiannianMimoBrowser.ps1"
$credentialPath = if ([string]::IsNullOrWhiteSpace($env:NIANNIAN_MIMO_CREDENTIAL_PATH)) { Join-Path $env:ProgramData "Niannian\mimo-credential.bin" } else { $env:NIANNIAN_MIMO_CREDENTIAL_PATH }

if (-not (Test-Path -LiteralPath $agent -PathType Leaf)) { throw "MIMO_AGENT_SCRIPT_MISSING" }
if (-not (Test-Path -LiteralPath $browser -PathType Leaf)) { throw "MIMO_BROWSER_RUNNER_MISSING" }
if ([string]::IsNullOrWhiteSpace($env:NIANNIAN_ORIGIN)) { throw "NIANNIAN_ORIGIN_REQUIRED" }
if ([string]::IsNullOrWhiteSpace($env:MIMO_WINDOWS_AGENT_TOKEN)) { throw "MIMO_WINDOWS_AGENT_TOKEN_REQUIRED" }

& $browser -ProjectDirectory $project
if ($LASTEXITCODE -ne 0) { throw "MIMO_BROWSER_START_FAILED" }

if (Test-Path -LiteralPath $credentialPath -PathType Leaf) {
  $encryptedBytes = [IO.File]::ReadAllBytes($credentialPath)
  $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($encryptedBytes, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
  try {
    $credential = [Text.Encoding]::UTF8.GetString($plainBytes) | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($credential.username) -or [string]::IsNullOrWhiteSpace($credential.password)) { throw "MIMO_CREDENTIAL_STORE_INVALID" }
    $env:NIANNIAN_MIMO_USERNAME = $credential.username
    $env:NIANNIAN_MIMO_PASSWORD = $credential.password
  } finally {
    if ($null -ne $plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
    $credential = $null
  }
}

& $node $agent $AgentCommand @AgentArguments
$env:NIANNIAN_MIMO_USERNAME = $null
$env:NIANNIAN_MIMO_PASSWORD = $null
exit $LASTEXITCODE
