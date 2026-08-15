[CmdletBinding()]
param([string]$CredentialDirectory = "")

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$CredentialDirectory = if ([string]::IsNullOrWhiteSpace($CredentialDirectory)) { Join-Path $env:ProgramData "Niannian\browser-slot-credentials" } else { $CredentialDirectory }
New-Item -ItemType Directory -Force -Path $CredentialDirectory | Out-Null
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$imported = 0

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $payload = $line | ConvertFrom-Json
  $slotId = [string]$payload.slotId
  if ($slotId -notmatch '^account-slot-\d{3}$') { throw "BROWSER_SLOT_ID_INVALID" }
  if ([string]$payload.accountFingerprint -notmatch '^[a-f0-9]{64}$') { throw "BROWSER_SLOT_ACCOUNT_FINGERPRINT_INVALID" }
  if ([string]::IsNullOrWhiteSpace($payload.username) -or [string]::IsNullOrWhiteSpace($payload.password)) { throw "BROWSER_SLOT_CREDENTIAL_INVALID" }
  $plainBytes = [Text.Encoding]::UTF8.GetBytes((@{ slotId = $slotId; enrollmentSid = $identity.User.Value; accountFingerprint = [string]$payload.accountFingerprint; username = [string]$payload.username; password = [string]$payload.password } | ConvertTo-Json -Compress))
  try {
    $encryptedBytes = [System.Security.Cryptography.ProtectedData]::Protect($plainBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    $target = Join-Path $CredentialDirectory "$slotId.bin"
    $temporary = Join-Path $CredentialDirectory ".$slotId.$PID.tmp"
    $backup = Join-Path $CredentialDirectory ".$slotId.$PID.bak"
    [IO.File]::WriteAllBytes($temporary, $encryptedBytes)
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetOwner($identity.User)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($identity.User, "FullControl", "Allow")))
    Set-Acl -LiteralPath $temporary -AclObject $acl
    if (Test-Path -LiteralPath $target) { [IO.File]::Replace($temporary, $target, $backup) } else { [IO.File]::Move($temporary, $target) }
    $imported += 1
  } finally {
    if ($null -ne $plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
    if ($null -ne $encryptedBytes) { [Array]::Clear($encryptedBytes, 0, $encryptedBytes.Length) }
    if ($null -ne $temporary -and (Test-Path -LiteralPath $temporary)) { Remove-Item -LiteralPath $temporary -Force }
    if ($null -ne $backup -and (Test-Path -LiteralPath $backup)) { Remove-Item -LiteralPath $backup -Force }
    $payload = $null
    $line = $null
  }
}

[pscustomobject]@{ Imported = $imported; Protection = "Windows DPAPI CurrentUser with restricted ACL"; CredentialValuesLogged = $false } | ConvertTo-Json -Compress
