[CmdletBinding()]
param(
  [string]$CredentialPath = "",
  [switch]$FromStdin
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$CredentialPath = if ([string]::IsNullOrWhiteSpace($CredentialPath)) { Join-Path $env:ProgramData "Niannian\mimo-credential.bin" } else { $CredentialPath }
$targetDirectory = Split-Path -Parent $CredentialPath
New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null

$credential = if ($FromStdin) {
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace($payload.username) -or [string]::IsNullOrWhiteSpace($payload.password)) {
    throw "MIMO_CREDENTIAL_STDIN_INVALID"
  }
  $securePassword = ConvertTo-SecureString -String $payload.password -AsPlainText -Force
  New-Object System.Management.Automation.PSCredential($payload.username, $securePassword)
} else {
  Get-Credential -Message "Mimo account for the background Windows worker"
}
if ($null -eq $credential -or [string]::IsNullOrWhiteSpace($credential.UserName)) { throw "MIMO_CREDENTIAL_ENROLLMENT_CANCELLED" }
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $json = @{ username = $credential.UserName; password = $password } | ConvertTo-Json -Compress
  $plainBytes = [Text.Encoding]::UTF8.GetBytes($json)
  $encryptedBytes = [System.Security.Cryptography.ProtectedData]::Protect($plainBytes, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
  [IO.File]::WriteAllBytes($CredentialPath, $encryptedBytes)
} finally {
  if ($null -ne $pointer) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $password = $null
  $json = $null
  $plainBytes = $null
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetOwner($identity.User)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity.User, "FullControl", "Allow")
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $CredentialPath -AclObject $acl

[pscustomobject]@{
  CredentialPath = $CredentialPath
  UsernameStored = $true
  PasswordStored = $true
  Protection = "Windows DPAPI LocalMachine with restricted ACL"
} | ConvertTo-Json -Compress
