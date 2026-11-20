# WinGet distribution (GitHub installer)

Ferry's **WinGet community** package is a separate download channel from the Microsoft Store. The manifest points directly to the version-pinned NSIS installer in [ferry-release](https://github.com/ThienNg65/ferry-release/releases), not to the Store MSIX. WinGet's SHA-256 validation does **not** sign the installer or guarantee that Microsoft Defender SmartScreen will stop warning; signing is tracked in [#40](https://github.com/ThienNg65/ferry/issues/40).

## Initial submission: Ferry 1.2.2

The three proposed upstream files are staged at `packaging/winget/manifests/t/ThienNg65/Ferry/1.2.2/`. The installer is the NSIS `Ferry-Setup-1.2.2.exe` from `ferry-v1.2.2`, **not** the portable ZIP or Store MSIX. Its SHA-256 comes from the published GitHub Release asset metadata (`4C19AB4760FF71D0CB2EF44B9E6C5AABE52B1E5C9E3DAF24E54F0583229F3590`); check downloaded bytes before submitting to Microsoft.

On a Windows 10/11 x64 test machine (preferably Windows Sandbox or clean VM), from the Ferry repository root:

```powershell
$version = '1.2.2'
$expected = '4C19AB4760FF71D0CB2EF44B9E6C5AABE52B1E5C9E3DAF24E54F0583229F3590'
$url = "https://github.com/ThienNg65/ferry-release/releases/download/ferry-v$version/Ferry-Setup-$version.exe"
$installer = Join-Path $env:TEMP "Ferry-Setup-$version.exe"
Invoke-WebRequest -Uri $url -OutFile $installer
if ((Get-FileHash $installer -Algorithm SHA256).Hash -ne $expected) { throw 'Release installer hash mismatch' }
node scripts/generate-winget-manifest.mjs --version $version --installer $installer --expected-sha256 $expected
# Generated files are in dist/winget/manifests/t/ThienNg65/Ferry/1.2.2/
winget validate --manifest 'dist/winget/manifests/t/ThienNg65/Ferry/1.2.2'
```

The generated three files must match the staged three files. Do not use the mutable `releases/latest` URL, or hash a pre-signing artifact. Once signing is enabled, regenerate against the *final signed* EXE as released and published, and use a new version rather than changing a published asset. Avoid publishing manifests for tags whose assets may still be replaced.

## Required Windows behavior verification

Run only in an isolated Windows machine where Ferry is not needed for daily use. The NSIS source specifies `RequestExecutionLevel user`, `InstallDir $LOCALAPPDATA\Programs\Ferry`, and installer type `nullsoft`. Its Apps & Features registry entry should report `Ferry`, publisher `ThienNg65`, version `1.2.2`, and an uninstall command. No window should require user input during `/S` install, and the application must **not** auto-launch.

```powershell
# Enable local manifests from an elevated PowerShell once:
winget settings --enable LocalManifestFiles

# Then test from a regular user's PowerShell:
winget install --manifest 'dist/winget/manifests/t/ThienNg65/Ferry/1.2.2' --silent --accept-package-agreements
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry' |
  Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, UninstallString
Test-Path "$env:LOCALAPPDATA\Programs\Ferry\ferry-win_x64.exe"

# Verify no unintended elevation, application launch, or loss of connection settings.
# Test installed-version detection, then a real upgrade using a newer released version.
# Test silent uninstall **only in the disposable environment**:
& "$env:LOCALAPPDATA\Programs\Ferry\Uninstall.exe" /S
```

Test upgrading from an older unsigned GitHub installer and test a machine with a Store MSIX installation separately. Check that WinGet correlates installed package versions correctly and does not mistake a Store MSIX for the NSIS distribution. If the observed Apps & Features identifiers differ, adjust the manifest and rerun local tests before opening the upstream PR.

## Submit to Microsoft's catalog

1. Check `winget search Ferry` and search `microsoft/winget-pkgs` for an existing package/PR; keep the stable candidate ID `ThienNg65.Ferry` only if unique.
2. Fork `microsoft/winget-pkgs` into a GitHub account and create a branch. Copy **only the three YAML files** under `manifests/t/ThienNg65/Ferry/1.2.2/` into that fork. Do not include this documentation, the generator, or multiple versions in the upstream PR.
3. Run `winget validate --manifest <manifest-directory>` and `winget install --manifest <manifest-directory>` on Windows. Submit the fork PR with title `New package: ThienNg65.Ferry version 1.2.2` and monitor Microsoft's validation bot.
4. Complete Microsoft's Contributor License Agreement if requested. Microsoft may reject an installer with low URL reputation or security detections even if the YAML and SHA-256 are correct; investigate actual findings instead of disabling scans.
5. After acceptance and index propagation, verify `winget search Ferry`, `winget install --id ThienNg65.Ferry -e --source winget`, `winget upgrade --id ThienNg65.Ferry -e --source winget`, and `winget uninstall --id ThienNg65.Ferry -e` in disposable environments. **Only then** advertise the commands on the Ferry download page.

## Every future release

1. Wait until the new GitHub Release is publicly published and its installer bytes are final (including Authenticode signing, if configured).
2. Download its version-specific `Ferry-Setup-X.Y.Z.exe`, verify SHA-256 independently, and run `node scripts/generate-winget-manifest.mjs --version X.Y.Z --installer <local-final-exe> --expected-sha256 <verified-hash>`.
3. Validate and test. Submit only that version's three generated manifests as an update PR to `microsoft/winget-pkgs`. Never modify the hash on an existing published version to point to different bytes.

Microsoft's latest submission requirements: [Authoring](https://github.com/microsoft/winget-pkgs/blob/master/doc/Authoring.md), [First-time checklist](https://github.com/microsoft/winget-pkgs/blob/master/doc/FirstContribution.md), [Validation](https://github.com/microsoft/winget-pkgs/blob/master/doc/Validation.md), [Manifest schema](https://github.com/microsoft/winget-pkgs/tree/master/doc/manifest/schema/1.28.0).
