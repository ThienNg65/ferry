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

!macro BackupFile REL_PATH
  ${If} ${FileExists} "$INSTDIR\${REL_PATH}"
    ${If} ${FileExists} "$INSTDIR\_ferry_upgrade_backup\${REL_PATH}"
      ; Preserve pre-existing backup from an interrupted run; remove only the partial file in $INSTDIR.
      ClearErrors
      Delete "$INSTDIR\${REL_PATH}"
      ${If} ${Errors}
        Goto rollback_install
      ${EndIf}
    ${Else}
      ClearErrors
      Rename "$INSTDIR\${REL_PATH}" "$INSTDIR\_ferry_upgrade_backup\${REL_PATH}"
      ${If} ${Errors}
        Goto rollback_install
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro BackupDir REL_PATH
  ${If} ${FileExists} "$INSTDIR\${REL_PATH}\*.*"
    ${If} ${FileExists} "$INSTDIR\_ferry_upgrade_backup\${REL_PATH}\*.*"
      ClearErrors
      RMDir /r "$INSTDIR\${REL_PATH}"
      ${If} ${Errors}
        Goto rollback_install
      ${EndIf}
    ${Else}
      ClearErrors
      Rename "$INSTDIR\${REL_PATH}" "$INSTDIR\_ferry_upgrade_backup\${REL_PATH}"
      ${If} ${Errors}
        Goto rollback_install
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro RestoreFile REL_PATH
  ${If} ${FileExists} "$INSTDIR\_ferry_upgrade_backup\${REL_PATH}"
    ${If} ${FileExists} "$INSTDIR\${REL_PATH}"
      ClearErrors
      Delete "$INSTDIR\${REL_PATH}"
      ${If} ${Errors}
        Goto rollback_failed
      ${EndIf}
    ${EndIf}
    ClearErrors
    Rename "$INSTDIR\_ferry_upgrade_backup\${REL_PATH}" "$INSTDIR\${REL_PATH}"
    ${If} ${Errors}
      Goto rollback_failed
    ${EndIf}
  ${EndIf}
!macroend

!macro RestoreDir REL_PATH
  ${If} ${FileExists} "$INSTDIR\_ferry_upgrade_backup\${REL_PATH}\*.*"
    ${If} ${FileExists} "$INSTDIR\${REL_PATH}\*.*"
      ClearErrors
      RMDir /r "$INSTDIR\${REL_PATH}"
      ${If} ${Errors}
        Goto rollback_failed
      ${EndIf}
    ${EndIf}
    ClearErrors
    Rename "$INSTDIR\_ferry_upgrade_backup\${REL_PATH}" "$INSTDIR\${REL_PATH}"
    ${If} ${Errors}
      Goto rollback_failed
    ${EndIf}
  ${EndIf}
!macroend

!macro CleanupInstdirProcesses PROC_FILTER WAIT_BEFORE_FORCE
  System::Call 'kernel32::SetEnvironmentVariable(t "FERRY_INSTDIR", t "$INSTDIR")'
  nsExec::Exec "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command $\"function norm([string]$$p) { try { return (Get-Item -LiteralPath $$p -Force -ErrorAction Stop).FullName.TrimEnd('\') } catch { return [IO.Path]::GetFullPath($$p).TrimEnd('\') } }; $$dir = (norm $$env:FERRY_INSTDIR) + '\'; $$max = if (${WAIT_BEFORE_FORCE} -eq 1) { 25 } else { 1 }; for ($$i = 0; $$i -lt $$max; $$i++) { $$procs = Get-CimInstance Win32_Process -Filter '${PROC_FILTER}' | Where-Object { $$_.ExecutablePath -and (norm $$_.ExecutablePath).StartsWith($$dir, [StringComparison]::OrdinalIgnoreCase) }; if (-not $$procs) { break }; if (${WAIT_BEFORE_FORCE} -eq 0 -or $$i -ge 15) { $$procs | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue } }; if (${WAIT_BEFORE_FORCE} -eq 1) { Start-Sleep -Milliseconds 200 } }$\""
  Pop $0
!macroend

Section "Ferry" SecMain
  CreateDirectory "$INSTDIR"
  SetOutPath "$INSTDIR"

  ; Preflight writeability check (catches protected per-machine Program Files installs when run without elevation).
  ClearErrors
  FileOpen $9 "$INSTDIR\.ferry-write-probe" w
  ${If} ${Errors}
    Abort "Cannot write to $INSTDIR. If Ferry was installed for all users, please re-run the installer as Administrator."
  ${EndIf}
  FileClose $9
  Delete "$INSTDIR\.ferry-write-probe"

  ; Wait for any running Ferry (Neutralino + sidecar) processes in $INSTDIR to exit; force-stop if still lingering.
  !insertmacro CleanupInstdirProcesses "Name=''ferry-win_x64.exe'' OR Name=''node.exe''" 1

  ; Crash-safe transactional backup: preserve any pre-existing _ferry_upgrade_backup from an interrupted run.
  CreateDirectory "$INSTDIR\_ferry_upgrade_backup"

  !insertmacro BackupFile "Uninstall.exe"
  !insertmacro BackupFile "ferry-win_x64.exe"
  !insertmacro BackupFile "resources.neu"
  !insertmacro BackupFile "LICENSE"
  !insertmacro BackupFile "PRIVACY.md"
  !insertmacro BackupFile "TERMS.md"
  !insertmacro BackupFile "THIRD_PARTY_LICENSES.txt"
  !insertmacro BackupDir "extensions"

  ClearErrors
  File /r "..\dist\ferry-neutralino-win_x64\*.*"
  ${If} ${Errors}
    Goto rollback_install
  ${EndIf}

  ; Post-copy validation before committing or discarding backup.
  ${IfNot} ${FileExists} "$INSTDIR\ferry-win_x64.exe"
  ${OrIfNot} ${FileExists} "$INSTDIR\resources.neu"
  ${OrIfNot} ${FileExists} "$INSTDIR\extensions\js.ferry.sidecar\node.exe"
  ${OrIfNot} ${FileExists} "$INSTDIR\extensions\js.ferry.sidecar\index.cjs"
    Goto rollback_install
  ${EndIf}

  nsExec::Exec '"$INSTDIR\extensions\js.ferry.sidecar\node.exe" --version'
  Pop $0
  ${If} $0 != 0
    Goto rollback_install
  ${EndIf}

  Goto commit_install

rollback_install:
  ; Preserve original files when a backup operation failed before Rename.
  !insertmacro RestoreFile "Uninstall.exe"
  !insertmacro RestoreFile "ferry-win_x64.exe"
  !insertmacro RestoreFile "resources.neu"
  !insertmacro RestoreFile "LICENSE"
  !insertmacro RestoreFile "PRIVACY.md"
  !insertmacro RestoreFile "TERMS.md"
  !insertmacro RestoreFile "THIRD_PARTY_LICENSES.txt"
  !insertmacro RestoreDir "extensions"
  ClearErrors
  RMDir /r "$INSTDIR\_ferry_upgrade_backup"
  ${If} ${Errors}
    Goto rollback_failed
  ${EndIf}
  SetErrorLevel 1
  Abort "Ferry upgrade failed. Previous installation was restored."

rollback_failed:
  ; On partial restoration failure the ONLY good copy may still be here.
  ; Never delete that directory; report its location for manual recovery.
  SetErrorLevel 1
  Abort "Ferry rollback failed. Original files remain in $INSTDIR\_ferry_upgrade_backup."

commit_install:
  ; Validate uninstaller/registry/shortcuts before discarding the snapshot.
  ClearErrors
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ${If} ${Errors}
    Goto rollback_install
  ${EndIf}

  ClearErrors
  WriteRegStr HKCU "Software\Ferry" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "DisplayName" "Ferry"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "DisplayIcon" "$INSTDIR\ferry-win_x64.exe,0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "Publisher" "ThienNg65"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "NoRepair" 1
  ${If} ${Errors}
    Goto rollback_install
  ${EndIf}

  ; Create canonical Neutralino shortcuts.
  Delete "$SMPROGRAMS\Ferry.lnk"
  Delete "$SMPROGRAMS\Ferry\Ferry.lnk"
  Delete "$DESKTOP\Ferry.lnk"
  CreateDirectory "$SMPROGRAMS\Ferry"
  CreateShortcut "$SMPROGRAMS\Ferry\Ferry.lnk" "$INSTDIR\ferry-win_x64.exe" "" "$INSTDIR\ferry-win_x64.exe" 0
  CreateShortcut "$DESKTOP\Ferry.lnk" "$INSTDIR\ferry-win_x64.exe" "" "$INSTDIR\ferry-win_x64.exe" 0
  ${If} ${Errors}
    Goto rollback_install
  ${EndIf}

  ; The new runtime, uninstaller, and shortcuts are installed; commit at last.
  RMDir /r "$INSTDIR\_ferry_upgrade_backup"

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
  !insertmacro CleanupInstdirProcesses "Name=''ferry-win_x64.exe'' OR Name=''node.exe''" 0

  Delete "$DESKTOP\Ferry.lnk"
  Delete "$SMPROGRAMS\Ferry.lnk"
  RMDir /r "$SMPROGRAMS\Ferry"
  Delete "$INSTDIR\ferry-win_x64.exe"
  Delete "$INSTDIR\resources.neu"
  Delete "$INSTDIR\neutralinojs.log"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\PRIVACY.md"
  Delete "$INSTDIR\TERMS.md"
  Delete "$INSTDIR\THIRD_PARTY_LICENSES.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR\extensions"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Ferry"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
SectionEnd
