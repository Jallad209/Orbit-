; Orbit NSIS installer hooks (weeks 11–12). NSIS only; the MSI channel has its
; own, separate release gate (docs/RESIDENT-BEHAVIOUR.md, docs/DEEP-LINKS.md).
;
; Two per-user registrations are touched, and only when they point at this
; installation. Nothing here removes a whole key that another program could own,
; the data folder, exports, backups, or the desktop preferences file.
;
; 1. Login launch (week 11), written by tauri-plugin-autostart:
;      HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Orbit = "<exe> --background"
; 2. The orbit:// protocol (week 12), used by notification clicks:
;      HKCU\Software\Classes\orbit\shell\open\command = "<exe>" "%1"
;
; An upgrade runs the previous version's uninstaller in place
; ($EXEPATH == $INSTDIR\uninstall.exe, from Tauri's `_?=$INSTDIR`), whereas a
; user-initiated uninstall runs from a temporary copy. The uninstall hook keeps
; both registrations during an upgrade; the install hook then refreshes the
; executable targets so they point at what was just installed.

!include "StrFunc.nsh"
${StrStr}
${UnStrStr}

!define ORBIT_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define ORBIT_RUN_VALUE "Orbit"
!define ORBIT_BACKGROUND_ARG "--background"
!define ORBIT_PROTOCOL_KEY "Software\Classes\orbit"

!macro NSIS_HOOK_POSTINSTALL
  ; Refresh an existing login-launch opt-in so it launches the executable installed here.
  ReadRegStr $0 HKCU "${ORBIT_RUN_KEY}" "${ORBIT_RUN_VALUE}"
  StrCmp $0 "" orbit_run_done
  ${StrStr} $1 $0 "${MAINBINARYNAME}.exe"
  StrCmp $1 "" orbit_run_done
  WriteRegStr HKCU "${ORBIT_RUN_KEY}" "${ORBIT_RUN_VALUE}" "$INSTDIR\${MAINBINARYNAME}.exe ${ORBIT_BACKGROUND_ARG}"
  orbit_run_done:

  ; Register orbit:// for this user. If another program owns the scheme (a command that
  ; does not name Orbit.exe), leave it alone: the app reports the missing handler instead.
  ReadRegStr $0 HKCU "${ORBIT_PROTOCOL_KEY}\shell\open\command" ""
  StrCmp $0 "" orbit_protocol_write
  ${StrStr} $1 $0 "${MAINBINARYNAME}.exe"
  StrCmp $1 "" orbit_protocol_done
  orbit_protocol_write:
  WriteRegStr HKCU "${ORBIT_PROTOCOL_KEY}" "" "URL:Orbit"
  WriteRegStr HKCU "${ORBIT_PROTOCOL_KEY}" "URL Protocol" ""
  WriteRegStr HKCU "${ORBIT_PROTOCOL_KEY}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "${ORBIT_PROTOCOL_KEY}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  orbit_protocol_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; An upgrade runs this uninstaller in place: keep both registrations for the new version.
  StrCmp $EXEPATH "$INSTDIR\uninstall.exe" orbit_postuninstall_done

  ReadRegStr $0 HKCU "${ORBIT_RUN_KEY}" "${ORBIT_RUN_VALUE}"
  StrCmp $0 "" orbit_unrun_done
  ; Only a value that points at this installation is Orbit's to remove.
  ${UnStrStr} $1 $0 "$INSTDIR\${MAINBINARYNAME}.exe"
  StrCmp $1 "" orbit_unrun_done
  DeleteRegValue HKCU "${ORBIT_RUN_KEY}" "${ORBIT_RUN_VALUE}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${ORBIT_RUN_VALUE}"
  orbit_unrun_done:

  ; The protocol handler goes only when it is this installation's executable.
  ReadRegStr $0 HKCU "${ORBIT_PROTOCOL_KEY}\shell\open\command" ""
  StrCmp $0 "" orbit_postuninstall_done
  ${UnStrStr} $1 $0 "$INSTDIR\${MAINBINARYNAME}.exe"
  StrCmp $1 "" orbit_postuninstall_done
  DeleteRegKey HKCU "${ORBIT_PROTOCOL_KEY}"
  orbit_postuninstall_done:
!macroend
