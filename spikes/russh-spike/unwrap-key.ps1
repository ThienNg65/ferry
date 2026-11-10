# Spike Task 2: DPAPI-unwraps Chromium's os_crypt key from <userDataDir>\Local State and
# writes it base64 to stdout for decrypt-legacy.mjs. Pipe it; never redirect it to a file.
param([Parameter(Mandatory)][string]$Dir)
Add-Type -AssemblyName System.Security
$state = Get-Content -Raw -LiteralPath (Join-Path $Dir 'Local State') | ConvertFrom-Json
$wrapped = [Convert]::FromBase64String($state.os_crypt.encrypted_key)
if ([Text.Encoding]::ASCII.GetString($wrapped, 0, 5) -ne 'DPAPI') { throw 'encrypted_key lacks DPAPI prefix' }
$blob = $wrapped[5..($wrapped.Length - 1)]
$key = [Security.Cryptography.ProtectedData]::Unprotect($blob, $null, 'CurrentUser')
[Convert]::ToBase64String($key)
