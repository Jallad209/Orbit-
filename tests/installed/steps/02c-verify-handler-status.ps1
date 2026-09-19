# Scenario 2b re-verification on the candidate that reports the handler owner.
# Plants Notepad as the orbit:// owner, reinstalls (the installer must leave it alone), then
# asks you to read Settings -> Desktop; afterwards restores Orbit's ownership and asks again.
if (@(Get-Process Orbit -ErrorAction SilentlyContinue).Count -ne 0) { 'Quit Orbit from the tray first'; exit 1 }
& 'C:\OrbitHarness\checks.ps1' -Action foreign-handler | Out-Null
Start-Process 'C:\OrbitInstallers\Orbit_0.1.0-alpha.2_x64-setup.exe' -ArgumentList '/S' -Wait
"orbit:// now = $((Get-Item 'HKCU:\Software\Classes\orbit\shell\open\command').GetValue(''))"
Start-Process (Join-Path $env:LOCALAPPDATA 'Orbit\orbit.exe')
''
'CHECK 1: in Orbit open Settings -> Desktop -> Notification clicks. Expected, in gold:'
'  "Another program owns orbit:// links for your account (C:\Windows\System32\notepad.exe). ..."'
'  Snip it as C:\OrbitHarness\evidence\02c-foreign-owner.png'
$null = Read-Host 'Press Enter when done (leave Orbit open)'
Stop-Process -Name Orbit -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Remove-Item -Path 'HKCU:\Software\Classes\orbit' -Recurse -Force -ErrorAction SilentlyContinue
Start-Process 'C:\OrbitInstallers\Orbit_0.1.0-alpha.2_x64-setup.exe' -ArgumentList '/S' -Wait
"orbit:// now = $((Get-Item 'HKCU:\Software\Classes\orbit\shell\open\command').GetValue(''))"
Start-Process (Join-Path $env:LOCALAPPDATA 'Orbit\orbit.exe')
''
'CHECK 2: same place. Expected, in grey: "orbit:// links are registered to this installation."'
'  Snip it as C:\OrbitHarness\evidence\02c-owned.png, then tell Claude.'
