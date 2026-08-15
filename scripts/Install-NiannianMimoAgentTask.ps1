[CmdletBinding()]
param(
  [string]$TaskName = "Niannian Windows Mimo CDP Agent",
  [string]$ProjectDirectory = ""
)

$ErrorActionPreference = "Stop"
$ProjectDirectory = if ([string]::IsNullOrWhiteSpace($ProjectDirectory)) { Split-Path -Parent $PSScriptRoot } else { $ProjectDirectory }
$project = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$runner = Join-Path $project "scripts\Start-NiannianMimoAgent.ps1"
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw "MIMO_AGENT_RUNNER_MISSING" }

$powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -ProjectDirectory `"$project`""
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $project
$principalUser = (whoami).Trim()
if ([string]::IsNullOrWhiteSpace($principalUser) -or $principalUser -notmatch "\\") { throw "WINDOWS_PRINCIPAL_IDENTITY_UNAVAILABLE" }
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $principalUser -LogonType S4U -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Outbound-only Windows Mimo CDP agent for sd2.cauai.fun" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$task = Get-ScheduledTask -TaskName $TaskName
[pscustomobject]@{
  TaskName = $task.TaskName
  State = $task.State.ToString()
  Execute = $task.Actions.Execute
  EnvironmentTokenPresent = -not [string]::IsNullOrWhiteSpace($env:MIMO_WINDOWS_AGENT_TOKEN)
  Trigger = "AtStartup"
  LogonType = "S4U"
  CdpEndpointPolicy = "loopback only"
} | ConvertTo-Json -Compress
