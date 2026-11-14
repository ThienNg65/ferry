!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "0.24.0"
!endif

Name "Ferry ${VERSION}"
OutFile "..\dist\Ferry-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Ferry"
InstallDirRegKey HKCU "Software\Ferry" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_ICON "..\resources\icon.ico"
!define MUI_UNICON "..\resources\icon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\ferry-win_x64.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Ferry"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Ferry" SecMain
  SetOutPath "$INSTDIR"

  ; Wait for any running Ferry (Electron or Neutralino + sidecar) processes in $INSTDIR to exit; force-stop if still lingering.
  System::Call 'kernel32::SetEnvironmentVariable(t "FERRY_INSTDIR", t "$INSTDIR")'
  nsExec::Exec "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command $\"$$dir = [IO.Path]::GetFullPath($$env:FERRY_INSTDIR).TrimEnd('\'); for ($$i = 0; $$i -lt 25; $$i++) { $$procs = Get-CimInstance Win32_Process -Filter 'Name=''Ferry.exe'' OR Name=''ferry-win_x64.exe'' OR Name=''node.exe''' | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$dir, [StringComparison]::OrdinalIgnoreCase) }; if (-not $$procs) { break }; if ($$i -ge 15) { $$procs | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue } }; Start-Sleep -Milliseconds 200 }$\""
  Pop $0

  ; Remove legacy Electron runtime files when upgrading an existing Electron install, preserving %APPDATA%\Ferry.
  Delete "$INSTDIR\Ferry.exe"
  Delete "$INSTDIR\Uninstall Ferry.exe"
  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\libEGL.dll"
  Delete "$INSTDIR\libGLESv2.dll"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\vulkan-1.dll"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\LICENSE.electron.txt"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"

  ; Remove legacy Electron Uninstall registry entries (keyed by electron-builder UUID/appId) so Installed Apps has one Ferry entry.
  StrCpy $0 0
  ${Do}
    EnumRegKey $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $0
    ${If} $1 == ""
      ${Break}
    ${EndIf}
    ${If} $1 != "Ferry"
      ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
      ReadRegStr $3 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "InstallLocation"
      ${If} $2 == "Ferry"
        ${If} $3 == "$INSTDIR"
          DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1"
          ${Continue}
        ${EndIf}
      ${EndIf}
    ${EndIf}
    IntOp $0 $0 + 1
  ${Loop}

  File /r "..\dist\ferry-neutralino-win_x64\*.*"

  WriteRegStr HKCU "Software\Ferry" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "DisplayName" "Ferry"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "DisplayIcon" "$INSTDIR\ferry-win_x64.exe,0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "Publisher" "Ferry"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "NoRepair" 1
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Replace legacy Electron shortcuts and create canonical Neutralino shortcuts.
  Delete "$SMPROGRAMS\Ferry.lnk"
  Delete "$SMPROGRAMS\Ferry\Ferry.lnk"
  Delete "$DESKTOP\Ferry.lnk"
  CreateDirectory "$SMPROGRAMS\Ferry"
  CreateShortcut "$SMPROGRAMS\Ferry\Ferry.lnk" "$INSTDIR\ferry-win_x64.exe" "" "$INSTDIR\ferry-win_x64.exe" 0
  CreateShortcut "$DESKTOP\Ferry.lnk" "$INSTDIR\ferry-win_x64.exe" "" "$INSTDIR\ferry-win_x64.exe" 0

  ; Notify Explorer to refresh shortcut and icon caches.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
SectionEnd

Function .onInstSuccess
  ${If} ${Silent}
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "--force-run" $R1
    ${IfNot} ${Errors}
      Exec '"$INSTDIR\ferry-win_x64.exe"'
    ${EndIf}
  ${EndIf}
FunctionEnd

Section "Uninstall"
  System::Call 'kernel32::SetEnvironmentVariable(t "FERRY_INSTDIR", t "$INSTDIR")'
  nsExec::Exec "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command $\"$$dir = [IO.Path]::GetFullPath($$env:FERRY_INSTDIR).TrimEnd('\'); Get-CimInstance Win32_Process -Filter 'Name=''ferry-win_x64.exe'' OR Name=''node.exe''' | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$dir, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }$\""
  Pop $0

  Delete "$DESKTOP\Ferry.lnk"
  Delete "$SMPROGRAMS\Ferry.lnk"
  RMDir /r "$SMPROGRAMS\Ferry"
  Delete "$INSTDIR\ferry-win_x64.exe"
  Delete "$INSTDIR\resources.neu"
  Delete "$INSTDIR\neutralinojs.log"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR\extensions"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Ferry"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
SectionEnd
