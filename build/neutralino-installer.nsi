!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
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

!macro BackupIfExists REL_PATH
  IfFileExists "$INSTDIR\${REL_PATH}" 0 +2
    Rename "$INSTDIR\${REL_PATH}" "$INSTDIR\_ferry_upgrade_backup\${REL_PATH}"
!macroend

!macro RestoreIfExists REL_PATH
  IfFileExists "$INSTDIR\_ferry_upgrade_backup\${REL_PATH}" 0 +3
    Delete "$INSTDIR\${REL_PATH}"
    Rename "$INSTDIR\_ferry_upgrade_backup\${REL_PATH}" "$INSTDIR\${REL_PATH}"
!macroend

!macro RestoreDirIfExists REL_PATH
  IfFileExists "$INSTDIR\_ferry_upgrade_backup\${REL_PATH}\*.*" 0 +3
    RMDir /r "$INSTDIR\${REL_PATH}"
    Rename "$INSTDIR\_ferry_upgrade_backup\${REL_PATH}" "$INSTDIR\${REL_PATH}"
!macroend

Function .onInit
  ; Discover custom or per-machine legacy Electron InstallLocation when no explicit /D= or Software\Ferry\InstallDir is present.
  ReadRegStr $0 HKCU "Software\Ferry" "InstallDir"
  ${If} $0 == ""
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\Programs\Ferry"
    ; Check electron-builder's appId UUID key (com.ferry.app -> 0e7a35ae-8c4b-54d6-9132-a1274e415706) in HKCU then HKLM.
    ReadRegStr $4 HKCU "Software\0e7a35ae-8c4b-54d6-9132-a1274e415706" "InstallLocation"
    ${If} $4 != ""
    ${AndIf} ${FileExists} "$4\Ferry.exe"
      StrCpy $INSTDIR $4
    ${Else}
      ReadRegStr $4 HKLM "Software\0e7a35ae-8c4b-54d6-9132-a1274e415706" "InstallLocation"
      ${If} $4 != ""
      ${AndIf} ${FileExists} "$4\Ferry.exe"
        StrCpy $INSTDIR $4
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ; Fallback: scan HKCU Uninstall entries for UninstallString containing "\Uninstall Ferry.exe".
  ${If} $0 == ""
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\Programs\Ferry"
    StrCpy $1 0
    ${Do}
      EnumRegKey $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $1
      ${If} $2 == ""
        ${Break}
      ${EndIf}
      ReadRegStr $3 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$2" "UninstallString"
      ${If} $3 != ""
        ${WordFind} $3 "\Uninstall Ferry.exe" "+1{" $4
        ${If} $4 != $3
          ; Strip optional leading quote from UninstallString
          StrCpy $5 $4 1
          ${If} $5 == '"'
            StrCpy $4 $4 "" 1
          ${EndIf}
          ${If} $4 != ""
          ${AndIf} ${FileExists} "$4\Ferry.exe"
            StrCpy $INSTDIR $4
            ${Break}
          ${EndIf}
        ${EndIf}
      ${EndIf}
      IntOp $1 $1 + 1
    ${Loop}
  ${EndIf}
FunctionEnd

Section "Ferry" SecMain
  SetOutPath "$INSTDIR"

  ; Wait for any running Ferry (Electron or Neutralino + sidecar) processes in $INSTDIR to exit; force-stop if still lingering.
  System::Call 'kernel32::SetEnvironmentVariable(t "FERRY_INSTDIR", t "$INSTDIR")'
  nsExec::Exec "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command $\"$$dir = [IO.Path]::GetFullPath($$env:FERRY_INSTDIR).TrimEnd('\'); for ($$i = 0; $$i -lt 25; $$i++) { $$procs = Get-CimInstance Win32_Process -Filter 'Name=''Ferry.exe'' OR Name=''ferry-win_x64.exe'' OR Name=''node.exe''' | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$dir, [StringComparison]::OrdinalIgnoreCase) }; if (-not $$procs) { break }; if ($$i -ge 15) { $$procs | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue } }; Start-Sleep -Milliseconds 200 }$\""
  Pop $0

  ; Transactional backup: stage existing Electron/Neutralino runtime files before copying new files, preserving %APPDATA%\Ferry.
  RMDir /r "$INSTDIR\_ferry_upgrade_backup"
  CreateDirectory "$INSTDIR\_ferry_upgrade_backup"

  !insertmacro BackupIfExists "Ferry.exe"
  !insertmacro BackupIfExists "Uninstall Ferry.exe"
  !insertmacro BackupIfExists "ferry-win_x64.exe"
  !insertmacro BackupIfExists "resources.neu"
  !insertmacro BackupIfExists "chrome_100_percent.pak"
  !insertmacro BackupIfExists "chrome_200_percent.pak"
  !insertmacro BackupIfExists "resources.pak"
  !insertmacro BackupIfExists "icudtl.dat"
  !insertmacro BackupIfExists "snapshot_blob.bin"
  !insertmacro BackupIfExists "v8_context_snapshot.bin"
  !insertmacro BackupIfExists "ffmpeg.dll"
  !insertmacro BackupIfExists "libEGL.dll"
  !insertmacro BackupIfExists "libGLESv2.dll"
  !insertmacro BackupIfExists "vk_swiftshader.dll"
  !insertmacro BackupIfExists "vk_swiftshader_icd.json"
  !insertmacro BackupIfExists "vulkan-1.dll"
  !insertmacro BackupIfExists "d3dcompiler_47.dll"
  !insertmacro BackupIfExists "LICENSES.chromium.html"
  !insertmacro BackupIfExists "LICENSE.electron.txt"
  IfFileExists "$INSTDIR\locales\*.*" 0 +2
    Rename "$INSTDIR\locales" "$INSTDIR\_ferry_upgrade_backup\locales"
  IfFileExists "$INSTDIR\resources\*.*" 0 +2
    Rename "$INSTDIR\resources" "$INSTDIR\_ferry_upgrade_backup\resources"
  IfFileExists "$INSTDIR\extensions\*.*" 0 +2
    Rename "$INSTDIR\extensions" "$INSTDIR\_ferry_upgrade_backup\extensions"

  ClearErrors
  File /r "..\dist\ferry-neutralino-win_x64\*.*"
  ${If} ${Errors}
    ; Rollback partial install and restore previous runnable installation.
    Delete "$INSTDIR\ferry-win_x64.exe"
    Delete "$INSTDIR\resources.neu"
    RMDir /r "$INSTDIR\extensions"

    !insertmacro RestoreIfExists "Ferry.exe"
    !insertmacro RestoreIfExists "Uninstall Ferry.exe"
    !insertmacro RestoreIfExists "ferry-win_x64.exe"
    !insertmacro RestoreIfExists "resources.neu"
    !insertmacro RestoreIfExists "chrome_100_percent.pak"
    !insertmacro RestoreIfExists "chrome_200_percent.pak"
    !insertmacro RestoreIfExists "resources.pak"
    !insertmacro RestoreIfExists "icudtl.dat"
    !insertmacro RestoreIfExists "snapshot_blob.bin"
    !insertmacro RestoreIfExists "v8_context_snapshot.bin"
    !insertmacro RestoreIfExists "ffmpeg.dll"
    !insertmacro RestoreIfExists "libEGL.dll"
    !insertmacro RestoreIfExists "libGLESv2.dll"
    !insertmacro RestoreIfExists "vk_swiftshader.dll"
    !insertmacro RestoreIfExists "vk_swiftshader_icd.json"
    !insertmacro RestoreIfExists "vulkan-1.dll"
    !insertmacro RestoreIfExists "d3dcompiler_47.dll"
    !insertmacro RestoreIfExists "LICENSES.chromium.html"
    !insertmacro RestoreIfExists "LICENSE.electron.txt"
    !insertmacro RestoreDirIfExists "locales"
    !insertmacro RestoreDirIfExists "resources"
    !insertmacro RestoreDirIfExists "extensions"
    RMDir /r "$INSTDIR\_ferry_upgrade_backup"
    Abort "Ferry installation failed; previous installation was restored and user data was preserved."
  ${EndIf}

  ; Commit phase: only update registry/shortcuts and discard backup after new files are safely written.
  RMDir /r "$INSTDIR\_ferry_upgrade_backup"

  ; Remove legacy Electron Uninstall registry entries (keyed by electron-builder UUID/appId) so Installed Apps has one Ferry entry.
  StrCpy $0 0
  ${Do}
    EnumRegKey $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $0
    ${If} $1 == ""
      ${Break}
    ${EndIf}
    ${If} $1 != "Ferry"
      ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
      ${If} $2 != ""
        ${WordFind} $2 "$INSTDIR\Uninstall Ferry.exe" "+1{" $3
        ${If} $3 != $2
          DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1"
          ${Continue}
        ${EndIf}
      ${EndIf}
    ${EndIf}
    IntOp $0 $0 + 1
  ${Loop}
  DeleteRegKey HKCU "Software\0e7a35ae-8c4b-54d6-9132-a1274e415706"

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
