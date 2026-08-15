[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^account-slot-\d{3}$')][string]$SlotId,
  [ValidatePattern('^https://')][string]$LoginUrl = "https://accounts.google.com/",
  [string]$ProjectDirectory = ""
)

$ErrorActionPreference = "Stop"
$ProjectDirectory = if ([string]::IsNullOrWhiteSpace($ProjectDirectory)) { Split-Path -Parent $PSScriptRoot } else { $ProjectDirectory }
$project = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$manager = Join-Path $project "scripts\niannian-windows-browser-slot-manager.mjs"
if (-not (Test-Path -LiteralPath $manager -PathType Leaf)) { throw "BROWSER_SLOT_MANAGER_MISSING" }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$taskName = "Niannian Browser Slot $SlotId"
$arguments = "`"$manager`" activate --slot $SlotId --url $LoginUrl"
$action = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $project
$identity = (whoami).Trim()
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Playwright-managed isolated browser account slot" -Force | Out-Null
[pscustomobject]@{ TaskName = $taskName; State = (Get-ScheduledTask -TaskName $taskName).State.ToString(); SlotId = $SlotId; LoginUrl = $LoginUrl } | ConvertTo-Json -Compress
