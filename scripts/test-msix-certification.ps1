# Run on a disposable Windows machine from an elevated interactive user session.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PackagePath,
    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'

function Test-FerryStartup($installed, [string]$applicationId) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IFerryMsixActivationManager
{
    [PreserveSig]
    int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
                            [MarshalAs(UnmanagedType.LPWStr)] string arguments,
                            uint options, out uint processId);
}

public static class FerryMsixActivation
{
    public static uint Start(string appId)
    {
        var clsid = new Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c");
        var manager = (IFerryMsixActivationManager)Activator.CreateInstance(Type.GetTypeFromCLSID(clsid));
        try
        {
            uint processId;
            Marshal.ThrowExceptionForHR(manager.ActivateApplication(appId, "--ferry-msix-smoke", 0, out processId));
            return processId;
        }
        finally
        {
            Marshal.ReleaseComObject(manager);
        }
    }
}
'@

    $hostPath = Join-Path $installed.InstallLocation 'ferry-win_x64.exe'
    $launcherPid = [FerryMsixActivation]::Start("$($installed.PackageFamilyName)!$applicationId")
    Write-Host "Activated $($installed.PackageFullName) (launcher PID $launcherPid)."

    $foundHost = $false
    $foundWindow = $false
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt 40) {
        $hostProcess = Get-CimInstance Win32_Process -Filter "Name = 'ferry-win_x64.exe' AND ParentProcessId = $launcherPid" |
            Where-Object ExecutablePath -EQ $hostPath | Select-Object -First 1
        if ($hostProcess) {
            $foundHost = $true
            $hostWindow = Get-Process -Id $hostProcess.ProcessId -ErrorAction SilentlyContinue
            if ($hostWindow -and $hostWindow.MainWindowHandle -ne [IntPtr]::Zero) {
                $foundWindow = $true
                switch -CaseSensitive ($hostWindow.MainWindowTitle) {
                    'Ferry MSIX smoke: sites ready' {
                        Write-Host 'The installed Ferry renderer completed the sites:list request.'
                        return
                    }
                    'Ferry MSIX smoke: sites failed' { throw 'The installed Ferry renderer could not complete sites:list.' }
                }
            }
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Ferry MSIX startup did not complete sites:list (host observed: $foundHost, window observed: $foundWindow)."
}

function Remove-FerryTestPackage([string]$packageName) {
    $testInstall = Get-AppxPackage -Name $packageName
    if ($testInstall) {
        # The disposable install may still be running when the startup check completes.
        $installPrefix = $testInstall.InstallLocation + '\'
        $running = @(Get-CimInstance Win32_Process -Filter "Name = 'PsfLauncher64.exe' OR Name = 'ferry-win_x64.exe' OR Name = 'node.exe'" |
            Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase) })
        foreach ($process in $running) {
            Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
            Wait-Process -Id $process.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
        }
        Remove-AppxPackage -Package $testInstall.PackageFullName
    }
}

$package = (Get-Item -LiteralPath $PackagePath).FullName
$kit = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
if ([System.Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) {
    throw 'Run the MSIX startup test from an active Windows user session.'
}
if ($ReportPath) {
    $report = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ReportPath)
    $appcert = Join-Path $kit 'App Certification Kit\appcert.exe'
    if (-not (Test-Path -LiteralPath $appcert -PathType Leaf)) {
        throw 'Install the Windows App Certification Kit component of the Windows SDK to run certification.'
    }
    if (Test-Path -LiteralPath $report) {
        throw "Choose a fresh report path. The file already exists: $report"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $report) -Force | Out-Null
}

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

$packageName = [string]$manifest.Package.Identity.Name
$applicationId = [string]$manifest.Package.Applications.Application.Id
if ((-not $packageName) -or (-not $applicationId)) { throw 'Missing package identity or application ID.' }
if (Get-AppxPackage -Name $packageName) {
    throw "Use a disposable Windows environment that does not already have $packageName installed."
}

$temp = New-Item -ItemType Directory -Path (Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid()))
$certificate = $null
try {
    # Test a separately signed copy so the Store upload retains its original SHA-256.
    $testPackage = Join-Path $temp.FullName (Split-Path -Leaf $package)
    Copy-Item -LiteralPath $package -Destination $testPackage
    $certificate = New-SelfSignedCertificate -Subject $manifest.Package.Identity.Publisher `
        -Type CodeSigningCert -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
        -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddDays(1)
    $certPath = Join-Path $temp.FullName 'test.cer'
    Export-Certificate -Cert $certificate -FilePath $certPath | Out-Null
    Import-Certificate -FilePath $certPath -CertStoreLocation 'Cert:\CurrentUser\TrustedPeople' | Out-Null
    & $signTool sign /fd SHA256 /sha1 $certificate.Thumbprint $testPackage
    if ($LASTEXITCODE -ne 0) { throw "SignTool failed with exit code $LASTEXITCODE." }

    Add-AppxPackage -Path $testPackage
    $installed = Get-AppxPackage -Name $packageName
    if (-not $installed) { throw 'The test package was not registered for the current user.' }
    Test-FerryStartup $installed $applicationId
    Remove-FerryTestPackage $packageName

    if ($ReportPath) {
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
    }
} finally {
    try {
        Remove-FerryTestPackage $packageName
    } finally {
        if ($certificate) {
            foreach ($store in @('Cert:\CurrentUser\TrustedPeople', 'Cert:\CurrentUser\My')) {
                $entry = Join-Path $store $certificate.Thumbprint
                if (Test-Path -LiteralPath $entry) { Remove-Item -LiteralPath $entry }
            }
        }
        Remove-Item -LiteralPath $temp.FullName -Recurse -Force
    }
}
