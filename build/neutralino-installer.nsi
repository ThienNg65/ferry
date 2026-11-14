!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.22.0"
!endif

Name "Ferry ${VERSION}"
OutFile "..\dist\Ferry-Neutralino-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Ferry"
InstallDirRegKey HKCU "Software\Ferry" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_ICON "..\resources\icon.ico"
!define MUI_UNICON "..\resources\icon.ico"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Ferry" SecMain
  SetOutPath "$INSTDIR"

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

  File /r "..\dist\ferry-neutralino-win_x64\*.*"

  WriteRegStr HKCU "Software\Ferry" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "DisplayName" "Ferry"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "Publisher" "Ferry"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Ferry"
  CreateShortcut "$SMPROGRAMS\Ferry\Ferry.lnk" "$INSTDIR\ferry-win_x64.exe" "" "$INSTDIR\ferry-win_x64.exe" 0
  CreateShortcut "$DESKTOP\Ferry.lnk" "$INSTDIR\ferry-win_x64.exe" "" "$INSTDIR\ferry-win_x64.exe" 0
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Ferry.lnk"
  RMDir /r "$SMPROGRAMS\Ferry"
  Delete "$INSTDIR\ferry-win_x64.exe"
  Delete "$INSTDIR\resources.neu"
  Delete "$INSTDIR\neutralinojs.log"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR\extensions"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Ferry"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ferry"
SectionEnd
