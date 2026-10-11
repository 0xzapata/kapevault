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
;
; Why not before the files are written (audit run-1 leads 8 and 9): electron-builder 26.15.3 has no
; hook between the folder being chosen and installApplicationFiles. customInit runs in .onInit, before
; the folder is picked; customCheckAppRunning and customUnInstallCheck would REPLACE the app-running
; check and the old-version check, which cannot be copied safely. So the lock below also (1) drops every
; explicit entry another account put on the folder (icacls /reset, folder only: a folder made ahead of
; time with an entry for itself loses it), (2) adds OWNER RIGHTS read and execute, which cancels the
; rights the folder's owner has just by owning it (change permissions) when that owner is another
; account, and (3) grants the installing user by SID, as whoami prints it, not by name. /setowner is not
; used: a standard user lacks the right to set an owner (icacls says Access is denied, even for self).
; The window between extraction and this macro remains; the in-app Security check names an owner who is
; not the signed-in user (install-folder.cjs).
!macro customInstall
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
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
    ; The installing user's SID: whoami /user /fo csv /nh prints "DOMAIN\user","S-1-5-21-..." and a line
    ; break. Drop the line break and the closing quote, keep what follows the last quote. A SID that does
    ; not start with S-1- (whoami missing or changed) falls back to DOMAIN\user, the old behaviour.
    StrCpy $R3 ""
    nsExec::ExecToStack `"$SYSDIR\whoami.exe" /user /fo csv /nh`
    Pop $R0
    Pop $R4
    ${If} $R0 == 0
      ${Do}
        StrCpy $R5 $R4 1 -1
        ${If} $R5 == "$\r"
        ${OrIf} $R5 == "$\n"
        ${OrIf} $R5 == `"`
          StrCpy $R4 $R4 -1
        ${Else}
          ${ExitDo}
        ${EndIf}
      ${Loop}
      StrLen $R6 $R4
      ${DoWhile} $R6 > 0
        IntOp $R6 $R6 - 1
        StrCpy $R5 $R4 1 $R6
        ${If} $R5 == `"`
          IntOp $R6 $R6 + 1
          ${ExitDo}
        ${EndIf}
      ${Loop}
      StrCpy $R3 $R4 "" $R6
      StrCpy $R5 $R3 4
      ${If} $R5 == "S-1-"
        StrCpy $R3 "*$R3"
      ${Else}
        StrCpy $R3 ""
      ${EndIf}
    ${EndIf}
    ${If} $R3 == ""
      ReadEnvStr $R0 "USERDOMAIN"
      ReadEnvStr $R1 "USERNAME"
      StrCpy $R3 "$R0\$R1"
    ${EndIf}
    ; Two steps, each judged on its own exit code; the folder only, never its files. First the entries
    ; another account added are removed (/reset puts back the inherited ones, which the next step cuts).
    nsExec::Exec `"$SYSDIR\icacls.exe" "$R2" /reset`
    Pop $R4
    nsExec::Exec `"$SYSDIR\icacls.exe" "$R2" /inheritance:r /grant:r "$R3:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX" "*S-1-3-4:(OI)(CI)RX"`
    Pop $R0
    ${If} $R4 != 0
      StrCpy $R0 1
    ${EndIf}
    ${If} $R0 != 0
    ${AndIfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "KAPEVault could not restrict who can change files in $R2.$\r$\n$\r$\nOther accounts on this PC may be able to replace KAPEVault.exe. Reinstall to the default folder, or set the folder's permissions yourself."
    ${EndIf}
  ${EndIf}
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
