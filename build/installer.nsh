; electron-builder includes this file by name (templates/nsis: customUnInit runs inside un.onInit).
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
