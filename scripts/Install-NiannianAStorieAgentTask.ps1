[CmdletBinding()]
param(
  [string]$TaskName = "Niannian Windows AStorie CDP Agent",
  [string]$BrowserTaskName = "Niannian Windows AStorie Browser",
  [string]$ProjectDirectory = ""
)

$ErrorActionPreference = "Stop"
$ProjectDirectory = if ([string]::IsNullOrWhiteSpace($ProjectDirectory)) { Split-Path -Parent $PSScriptRoot } else { $ProjectDirectory }
$project = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$agent = Join-Path $project "scripts\niannian-windows-astorie-agent.mjs"
if (-not (Test-Path -LiteralPath $agent -PathType Leaf)) { throw "ASTORIE_AGENT_SCRIPT_MISSING" }
$browser = Join-Path $project "scripts\Start-NiannianAStorieBrowser.ps1"
if (-not (Test-Path -LiteralPath $browser -PathType Leaf)) { throw "ASTORIE_BROWSER_STARTER_MISSING" }
if ([string]::IsNullOrWhiteSpace($env:NIANNIAN_ORIGIN)) { throw "NIANNIAN_ORIGIN_REQUIRED" }
if ([string]::IsNullOrWhiteSpace($env:ASTORIE_WINDOWS_AGENT_TOKEN) -or $env:ASTORIE_WINDOWS_AGENT_TOKEN.Length -lt 24) { throw "ASTORIE_WINDOWS_AGENT_TOKEN_REQUIRED" }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$arguments = "`"$agent`" run-loop"
$action = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $project
$browserAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$browser`"" -WorkingDirectory $project
$identity = (whoami).Trim()
if ([string]::IsNullOrWhiteSpace($identity) -or $identity -notmatch "\\") { throw "WINDOWS_PRINCIPAL_IDENTITY_UNAVAILABLE" }
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Outbound-only Windows AStorie CDP agent for sd2.cauai.fun" -Force | Out-Null
Register-ScheduledTask -TaskName $BrowserTaskName -Action $browserAction -Trigger $trigger -Settings $settings -Principal $principal -Description "Interactive AStorie Edge CDP browser for sd2.cauai.fun" -Force | Out-Null
Start-ScheduledTask -TaskName $BrowserTaskName
Start-ScheduledTask -TaskName $TaskName
[pscustomobject]@{ TaskName = $TaskName; BrowserTaskName = $BrowserTaskName; State = (Get-ScheduledTask -TaskName $TaskName).State.ToString(); Trigger = "AtLogOn"; CdpEndpointPolicy = "loopback only"; CredentialAccess = "none" } | ConvertTo-Json -Compress
