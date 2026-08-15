[CmdletBinding()]
param(
  [string]$ProjectDirectory = ""
)

$ErrorActionPreference = "Stop"
$project = if ([string]::IsNullOrWhiteSpace($ProjectDirectory)) { Split-Path -Parent $PSScriptRoot } else { $ProjectDirectory }
$starter = Join-Path $project "scripts\Start-NiannianMimoAgent.ps1"
if (-not (Test-Path -LiteralPath $starter -PathType Leaf)) { throw "MIMO_AGENT_STARTER_MISSING" }

& $starter -ProjectDirectory $project -AgentCommand "recover-local-delivery" -AgentArguments @(
  "--task-id", "D-yKHX6ezMuac97DZyp7Cm0w",
  "--duration", "4",
  "--aspect-ratio", "9:16"
)
exit $LASTEXITCODE
