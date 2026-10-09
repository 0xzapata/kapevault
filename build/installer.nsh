; electron-builder includes this file by name (templates/nsis: customUnInit runs inside un.onInit,
; customInstall inside the install section).
;
; Two things outlive an uninstall on purpose, and the uninstaller cannot remove either:
;  - Air Wall's firewall rule was added with admin rights; this per-user uninstaller has none.
;  - The Windows Hello key lives in Windows' own store, and hello.json (next to the vault) keeps the
;    vault key wrapped by it.
; So a hand-run uninstall says so first. Not shown in a silent run, nor when an update replaces the app.
!macro customUnInit
  ${IfNot} ${Silent}
  ${AndIfNot} ${isUpdated}
    StrCpy $R8 ""
    nsExec::Exec `"$SYSDIR\netsh.exe" advfirewall firewall show rule name="KAPEVault Air Wall"`
    Pop $R9
    ${If} $R9 == 0
      StrCpy $R8 "$R8$\r$\n$\r$\n- Air Wall's firewall rule stays. Switch off Keep KAPEVault offline in Settings > Security first, or remove the rule in Windows Defender Firewall."
    ${EndIf}
    ${If} ${FileExists} "$APPDATA\KAPEVault\hello.json"
      StrCpy $R8 "$R8$\r$\n$\r$\n- Windows Hello stays set up for KAPEVault. Switch it off in Settings > Security first."
    ${EndIf}
    ${If} $R8 != ""
      MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Your vault stays in $APPDATA\KAPEVault.$R8$\r$\n$\r$\nUninstall anyway?" IDOK +2
      Abort
    ${EndIf}
  ${EndIf}
!macroend

; A custom install folder (D:\Kapevault) inherits its parent's rights, and a drive root grants
; "Authenticated Users: Modify", so any local account could replace KAPEVault.exe with its own program
; that then runs as the owner of the vault. The default folder under %LOCALAPPDATA% is already
; private to the user and is left alone. Anywhere else the folder is cut off from the parent's
; rights: the installing user, SYSTEM and Administrators get full control, Users read and execute.
; Well-known groups go in by SID so this works on any Windows language. icacls changes nothing when
; it fails (an account that does not resolve), so the worst case is the old behaviour. Runs after the
; files are written (templates/nsis/installSection.nsh), and the user keeps full control, so an
; update installed over it still works.
!macro customInstall
  Push $R0
  Push $R1
  Push $R2
  StrCpy $R2 $INSTDIR
  StrCpy $R0 $R2 1 -1
  ${If} $R0 == "\"
    StrCpy $R2 $R2 -1
  ${EndIf}
  StrLen $R0 "$LOCALAPPDATA\"
  StrCpy $R1 $R2 $R0
  StrLen $R0 $R2
  ${If} $R1 != "$LOCALAPPDATA\"
  ${AndIf} $R0 > 3
    ReadEnvStr $R0 "USERDOMAIN"
    ReadEnvStr $R1 "USERNAME"
    nsExec::Exec `"$SYSDIR\icacls.exe" "$R2" /inheritance:r /grant:r "$R0\$R1:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX"`
    Pop $R0
    ${If} $R0 != 0
    ${AndIfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "KAPEVault could not restrict who can change files in $R2.$\r$\n$\r$\nOther accounts on this PC may be able to replace KAPEVault.exe. Reinstall to the default folder, or set the folder's permissions yourself."
    ${EndIf}
  ${EndIf}
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
