# Run on a disposable Windows machine from an elevated user session with the kit installed.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PackagePath,
    [Parameter(Mandatory)][string]$ReportPath
)

$ErrorActionPreference = 'Stop'

$package = (Get-Item -LiteralPath $PackagePath).FullName
$report = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ReportPath)
$kit = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
$appcert = Join-Path $kit 'App Certification Kit\appcert.exe'
if (-not (Test-Path -LiteralPath $appcert -PathType Leaf)) {
    throw 'Install the Windows App Certification Kit component of the Windows SDK to run this check.'
}
if ([System.Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) {
    throw 'Run the Windows App Certification Kit from an active Windows user session.'
}
if (Test-Path -LiteralPath $report) {
    throw "Choose a fresh report path. The file already exists: $report"
}
New-Item -ItemType Directory -Path (Split-Path -Parent $report) -Force | Out-Null

$signTool = Get-ChildItem -LiteralPath (Join-Path $kit 'bin') -Directory |
    Where-Object Name -Match '^\d+\.\d+\.\d+\.\d+$' |
    Sort-Object { [version]$_.Name } -Descending |
    ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
if (-not $signTool) { throw 'Windows SDK SignTool was not found.' }

$zip = [System.IO.Compression.ZipFile]::OpenRead($package)
try {
    $reader = [System.IO.StreamReader]::new($zip.GetEntry('AppxManifest.xml').Open())
    try { [xml]$manifest = $reader.ReadToEnd() }
    finally { $reader.Dispose() }
} finally {
    $zip.Dispose()
}

$temp = New-Item -ItemType Directory -Path (Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid()))
$certificate = $null
try {
    # Sign a disposable copy so WACK can install it using the package's real publisher.
    $testPackage = Join-Path $temp.FullName (Split-Path -Leaf $package)
    Copy-Item -LiteralPath $package -Destination $testPackage
    $certificate = New-SelfSignedCertificate -Subject $manifest.Package.Identity.Publisher `
        -Type CodeSigningCert -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
        -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddDays(1)
    $certPath = Join-Path $temp.FullName 'test.cer'
    Export-Certificate -Cert $certificate -FilePath $certPath | Out-Null
    Import-Certificate -FilePath $certPath -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
    & $signTool sign /fd SHA256 /sha1 $certificate.Thumbprint $testPackage
    if ($LASTEXITCODE -ne 0) { throw "SignTool failed with exit code $LASTEXITCODE." }

    $reset = Start-Process -FilePath $appcert -ArgumentList 'reset' -Wait -PassThru
    if ($reset.ExitCode -ne 0) { throw "App Certification Kit reset failed with exit code $($reset.ExitCode)." }
    $test = Start-Process -FilePath $appcert `
        -ArgumentList "test -appxpackagepath `"$testPackage`" -reportoutputpath `"$report`"" -Wait -PassThru
    if (-not (Test-Path -LiteralPath $report -PathType Leaf)) {
        throw "App Certification Kit produced no XML report (exit code $($test.ExitCode))."
    }
    [xml]$results = Get-Content -LiteralPath $report -Raw
    $result = $results.DocumentElement.GetAttribute('OVERALL_RESULT')
    if ($test.ExitCode -ne 0 -or $result -notin @('PASS', 'WARNING')) {
        throw "App Certification Kit result '$result' (exit code $($test.ExitCode)). Review $report."
    }
    Write-Host "App Certification Kit result: $result. Report: $report"
} finally {
    if ($certificate) {
        foreach ($store in @('Cert:\LocalMachine\TrustedPeople', 'Cert:\CurrentUser\My')) {
            $entry = Join-Path $store $certificate.Thumbprint
            if (Test-Path -LiteralPath $entry) { Remove-Item -LiteralPath $entry }
        }
    }
    Remove-Item -LiteralPath $temp.FullName -Recurse -Force
}
