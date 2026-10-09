# Builds the signed release APK (or the Play bundle) with the signing key kept OFFLINE.
# Restore kapevault-release.jks to a folder for the build; this script asks for that folder and for the
# two passwords (never shown, never written to disk), writes a keystore.properties holding ONLY storeFile
# and keyAlias into that folder, hands the passwords to the build through environment variables of this
# process only, and removes the properties file and the variables when it ends, however it ends.
#
# Run from the mobile folder (the one with package.json), after `npm ci`:
#   pwsh -File scripts/apk-release-prompt.ps1            # npm run apk:release
#   pwsh -File scripts/apk-release-prompt.ps1 -Bundle    # also npm run aab:release
param([switch]$Bundle)

$ErrorActionPreference = 'Stop'

function ConvertTo-PlainText([securestring]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$folder = (Read-Host 'Folder holding kapevault-release.jks').Trim().Trim('"')
$jks = Join-Path $folder 'kapevault-release.jks'
if (-not (Test-Path -LiteralPath $jks -PathType Leaf)) { throw "No kapevault-release.jks in $folder." }
$storeSecure = Read-Host 'Keystore password' -AsSecureString
$keySecure = Read-Host 'Key password' -AsSecureString

$properties = Join-Path $folder 'keystore.properties'
$previousSigning = $env:KAPEVAULT_SIGNING
try {
  Set-Content -LiteralPath $properties -Value @('storeFile=kapevault-release.jks', 'keyAlias=kapevault') -Encoding ascii
  $env:KAPEVAULT_SIGNING = $properties
  $env:KAPEVAULT_STORE_PASSWORD = ConvertTo-PlainText $storeSecure
  $env:KAPEVAULT_KEY_PASSWORD = ConvertTo-PlainText $keySecure

  npm run apk:release
  if ($LASTEXITCODE -ne 0) { throw "npm run apk:release failed ($LASTEXITCODE)." }
  if ($Bundle) {
    npm run aab:release
    if ($LASTEXITCODE -ne 0) { throw "npm run aab:release failed ($LASTEXITCODE)." }
  }
}
finally {
  Remove-Item -LiteralPath $properties -Force -ErrorAction SilentlyContinue
  Remove-Item Env:KAPEVAULT_STORE_PASSWORD, Env:KAPEVAULT_KEY_PASSWORD -ErrorAction SilentlyContinue
  if ($null -eq $previousSigning) { Remove-Item Env:KAPEVAULT_SIGNING -ErrorAction SilentlyContinue } else { $env:KAPEVAULT_SIGNING = $previousSigning }
}
