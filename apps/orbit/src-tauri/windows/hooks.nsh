; Orbit NSIS installer hooks (week 11). NSIS only; the MSI channel has its own,
; separate release gate (docs/RESIDENT-BEHAVIOUR.md).
;
; The login launch is a per-user registry value written by tauri-plugin-autostart:
;   HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Orbit = "<exe> --background"
; These hooks touch exactly that value and only when it points at this
; installation. They never remove the whole Run key, the data folder, exports,
; backups, or the desktop preferences file.
;
; An upgrade runs the previous version's uninstaller in place
; ($EXEPATH == $INSTDIR\uninstall.exe, from Tauri's `_?=$INSTDIR`), whereas a
; user-initiated uninstall runs from a temporary copy. The uninstall hook keeps
; the value during an upgrade so the opt-in survives; the install hook then
; refreshes the target so it points at the executable that was just installed.

!include "StrFunc.nsh"
${StrStr}
${UnStrStr}

!define ORBIT_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define ORBIT_RUN_VALUE "Orbit"
!define ORBIT_BACKGROUND_ARG "--background"

!macro NSIS_HOOK_POSTINSTALL
  ; Refresh an existing opt-in so it launches the executable installed here.
  ReadRegStr $0 HKCU "${ORBIT_RUN_KEY}" "${ORBIT_RUN_VALUE}"
  StrCmp $0 "" orbit_postinstall_done
  ${StrStr} $1 $0 "${MAINBINARYNAME}.exe"
  StrCmp $1 "" orbit_postinstall_done
  WriteRegStr HKCU "${ORBIT_RUN_KEY}" "${ORBIT_RUN_VALUE}" "$INSTDIR\${MAINBINARYNAME}.exe ${ORBIT_BACKGROUND_ARG}"
  orbit_postinstall_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; An upgrade runs this uninstaller in place: keep the opt-in for the new version.
  StrCmp $EXEPATH "$INSTDIR\uninstall.exe" orbit_postuninstall_done
  ReadRegStr $0 HKCU "${ORBIT_RUN_KEY}" "${ORBIT_RUN_VALUE}"
  StrCmp $0 "" orbit_postuninstall_done
  ; Only a value that points at this installation is Orbit's to remove.
  ${UnStrStr} $1 $0 "$INSTDIR\${MAINBINARYNAME}.exe"
  StrCmp $1 "" orbit_postuninstall_done
  DeleteRegValue HKCU "${ORBIT_RUN_KEY}" "${ORBIT_RUN_VALUE}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${ORBIT_RUN_VALUE}"
  orbit_postuninstall_done:
!macroend
