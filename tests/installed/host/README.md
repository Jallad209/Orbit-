# Host-account steps (scenarios 12–14)

Windows Sandbox cannot restart or sleep, so the three login-launch and sleep scenarios run
under a disposable local account on the developer machine. The NSIS `currentUser` install
(`%LOCALAPPDATA%\Orbit`, `HKCU` protocol and Run keys, `%APPDATA%\app.orbit.desktop`) stays
inside that profile, and the account is deleted afterwards.

## Before (from your own admin PowerShell, once)

    net user OrbitTest * /add

It asks for a password twice; any password you will remember for an hour. Then sign out
(or switch user) and sign in as **OrbitTest**. The first sign-in runs the Windows welcome
screens; decline everything.

## Under OrbitTest

Open PowerShell (Start → type `powershell`) and run the same command each time:

    powershell -ExecutionPolicy Bypass -File C:\Orbit\tests\installed\host\next.ps1

It runs one step, tells you what to do by hand, and what to run next. Steps:

| Step     | What it does                                                                                                                                                          | Your part                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `setup`  | Installs the newest `Orbit_*_x64-setup.exe` from the build folder, records its hash, starts Orbit                                                                     | First run; add a Reminder rule "bill due within **0** days"; turn login launch ON |
| `12`     | Checks the Run value, asks for a bill due in 8 minutes, records the queued reminder                                                                                   | Add the bill; Quit from the tray; `shutdown /r /t 0`; sign in; open PowerShell    |
| `12v`    | Reads boot time, process/window state, the launch mode and readiness from the shell log; waits for the delivery and screenshots the toast and the notification centre | Do not click the toast                                                            |
| `13`     | Asks you to turn login launch OFF, checks the Run value is gone                                                                                                       | Quit from the tray; `shutdown /r /t 0`; sign in; open PowerShell                  |
| `13v`    | A minute after logon: no Run value, no process, no launch logged                                                                                                      | Nothing                                                                           |
| `14`     | Asks for a bill due in 5 minutes, records the reminder, puts the machine to sleep                                                                                     | Leave it asleep past the time it prints; wake it; sign in; run again at once      |
| `14v`    | Sleep/resume times from the System log; waits for the one delivery; screenshots                                                                                       | Do not click the toast                                                            |
| `finish` | Silent uninstall, records what is left                                                                                                                                | Quit from the tray first                                                          |

`next.ps1 -Redo` repeats the last step, `-Step 12` jumps to a step, `-Reset` starts over. A
step that fails is repeated on the next run. Evidence lands in `tests\installed\evidence`
(`12-*.json/png`, `13-*.json`, `14-*.json/png`, `*-shell.log`, `host-*.json`), readable from
the developer account.

Each restart ends the Claude Code session; after signing back in as yourself, reopen the
conversation and report what the step printed.

## Afterwards (from your own admin PowerShell)

Sign out of OrbitTest first, then:

    Get-CimInstance Win32_UserProfile | Where-Object LocalPath -like '*\OrbitTest' | Remove-CimInstance
    net user OrbitTest /delete

The first line removes the profile folder and registry hive; the second removes the account.
