[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^account-slot-\d{3}$')][string]$SlotId,
  [string]$ProjectDirectory = "",
  [string]$CredentialDirectory = "",
  [string]$ResultPath = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$ProjectDirectory = if ([string]::IsNullOrWhiteSpace($ProjectDirectory)) { Split-Path -Parent $PSScriptRoot } else { $ProjectDirectory }
$project = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$CredentialDirectory = if ([string]::IsNullOrWhiteSpace($CredentialDirectory)) { Join-Path $env:ProgramData "Niannian\browser-slot-credentials" } else { $CredentialDirectory }
$credentialPath = Join-Path $CredentialDirectory "$SlotId.bin"
if (-not (Test-Path -LiteralPath $credentialPath -PathType Leaf)) { throw "BROWSER_SLOT_CREDENTIAL_NOT_ENROLLED" }
$login = Join-Path $project "scripts\niannian-windows-browser-slot-login.mjs"
if (-not (Test-Path -LiteralPath $login -PathType Leaf)) { throw "BROWSER_SLOT_LOGIN_SCRIPT_MISSING" }
$plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($credentialPath), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
  $credential = [Text.Encoding]::UTF8.GetString($plainBytes) | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace($credential.username) -or [string]::IsNullOrWhiteSpace($credential.password)) { throw "BROWSER_SLOT_CREDENTIAL_STORE_INVALID" }
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ([string]$credential.slotId -ne $SlotId) { throw "BROWSER_SLOT_CREDENTIAL_SLOT_MISMATCH" }
  if ([string]$credential.enrollmentSid -ne $currentSid) { throw "BROWSER_SLOT_CREDENTIAL_SID_MISMATCH" }
  if ([string]$credential.accountFingerprint -notmatch '^[a-f0-9]{64}$') { throw "BROWSER_SLOT_ACCOUNT_FINGERPRINT_INVALID" }
  $credentialJson = @{ accountFingerprint = [string]$credential.accountFingerprint; username = [string]$credential.username; password = [string]$credential.password } | ConvertTo-Json -Compress
  $nodeOutput = $credentialJson | & node.exe --max-old-space-size=192 $login --slot $SlotId
  $nodeExitCode = $LASTEXITCODE
} finally {
  $credentialJson = $null
  if ($null -ne $plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  $credential = $null
}
if (-not [string]::IsNullOrWhiteSpace($ResultPath)) {
  $resultDirectory = Split-Path -Parent $ResultPath
  New-Item -ItemType Directory -Force -Path $resultDirectory | Out-Null
  [IO.File]::WriteAllText($ResultPath, [string]$nodeOutput, [Text.Encoding]::UTF8)
}
exit $nodeExitCode
