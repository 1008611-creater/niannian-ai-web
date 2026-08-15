[CmdletBinding()]
param(
  [string]$TaskName = "Niannian Dola Windows Agent",
  [string]$ProjectDirectory = ""
)

$ErrorActionPreference = "Stop"
$ProjectDirectory = if ([string]::IsNullOrWhiteSpace($ProjectDirectory)) { Split-Path -Parent $PSScriptRoot } else { $ProjectDirectory }
$project = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$runner = Join-Path $project "scripts\Start-NiannianDolaAgent.ps1"
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw "DOLA_AGENT_RUNNER_MISSING" }

$powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$escapedRunner = $runner.Replace('"', '\"')
$escapedProject = $project.Replace('"', '\"')
$arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$escapedRunner`" -ProjectDirectory `"$escapedProject`""
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Outbound-only Windows Dola Agent for sd2.cauai.fun" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$task = Get-ScheduledTask -TaskName $TaskName
[pscustomobject]@{
  TaskName = $task.TaskName
  State = $task.State.ToString()
  Execute = $task.Actions.Execute
  ArgumentsContainToken = $task.Actions.Arguments -match 'DOLA_CODEX_AGENT_TOKEN|NIANNIAN_DOLA_AGENT_TOKEN'
  Trigger = "AtLogOn"
} | ConvertTo-Json -Compress
