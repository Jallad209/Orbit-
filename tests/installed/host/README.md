# Host-account steps (scenarios 12–14)

Windows Sandbox cannot restart or sleep, so the three login-launch and sleep scenarios run on a
real Windows account. Orbit installs per user — the NSIS `currentUser` install lands in
`%LOCALAPPDATA%\Orbit`, the protocol and Run keys in `HKCU`, the data in
`%APPDATA%\app.orbit.desktop` — so the whole pass must run in **one** account.

Any account will do, including your own; a separate throwaway account only adds isolation.
The first step asks which account the pass is for and saves the answer in
`evidence\host-account.txt`; every later step checks you are still signed in as that account
and stops if you are not. `next.ps1 -Reset` starts over and asks again.

On your own account, note what the pass leaves behind: Orbit installed (unless you run the
optional `finish` step), and in your data folder one reminder rule and two bills named
"reboot test" and "sleep test", which you can delete in the app.

## Running it

Open PowerShell (Start → type `powershell`) and run the same command each time:

    powershell -ExecutionPolicy Bypass -File C:\Orbit\tests\installed\host\next.ps1

It runs one step, tells you what to do by hand, and what to run next. Steps:

| Step     | What it does                                                                                                                                                          | Your part                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `setup`  | Asks which account the pass is for; installs the newest `Orbit_*_x64-setup.exe` from the build folder, records its hash, starts Orbit                                 | First run; add a Reminder rule "bill due within **0** days"; turn login launch ON |
| `12`     | Checks the Run value, asks for a bill due in 8 minutes, records the queued reminder                                                                                   | Add the bill; Quit from the tray; `shutdown /r /t 0`; sign in; open PowerShell    |
| `12v`    | Reads boot time, process/window state, the launch mode and readiness from the shell log; waits for the delivery and screenshots the toast and the notification centre | Do not click the toast                                                            |
| `13`     | Asks you to turn login launch OFF, checks the Run value is gone                                                                                                       | Quit from the tray; `shutdown /r /t 0`; sign in; open PowerShell                  |
| `13v`    | A minute after logon: no Run value, no process, no launch logged                                                                                                      | Nothing                                                                           |
| `14`     | Asks for a bill due in 5 minutes, records the reminder, puts the machine to sleep                                                                                     | Leave it asleep past the time it prints; wake it; sign in; run again at once      |
| `14v`    | Sleep/resume times from the System log; waits for the one delivery; screenshots                                                                                       | Do not click the toast                                                            |
| `finish` | Optional. Silent uninstall, records what is left                                                                                                                      | Quit from the tray first; skip this step to keep Orbit installed                  |

`next.ps1 -Redo` repeats the last step, `-Step 12` jumps to a step, `-Reset` starts over. A
step that fails is repeated on the next run. Evidence lands in `tests\installed\evidence`
(`12-*.json/png`, `13-*.json`, `14-*.json/png`, `*-shell.log`, `host-*.json`).

Each restart ends the Claude Code session; after signing back in, reopen the conversation and
report what the step printed.

## If you chose a separate account

Create it first from an admin PowerShell with `net user <name> * /add`, sign in to it, and name
it when setup asks. Afterwards, signed out of it, remove its profile and the account:

    Get-CimInstance Win32_UserProfile | Where-Object LocalPath -like '*\<name>' | Remove-CimInstance
    net user <name> /delete
