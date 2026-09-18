# Scenario 8: candidate A -> B upgrade keeps data, protocol ownership, login opt-in, and
# refreshes the executable targets. A = the older alpha.1 installer, B = alpha.2 again.
$installers = 'C:\OrbitInstallers'
$evidence = 'C:\OrbitHarness\evidence'
if (@(Get-Process Orbit -ErrorAction SilentlyContinue).Count -ne 0) { 'Quit Orbit from the tray first'; exit 1 }
# Turn login launch on before the upgrade so the hook has something to refresh.
'--- before: registry ---'
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
(Get-ItemProperty -Path $run -Name Orbit -ErrorAction SilentlyContinue).Orbit
(Get-Item 'HKCU:\Software\Classes\orbit\shell\open\command').GetValue('')
$a = Get-ChildItem $installers -Filter 'Orbit_0.1.0-alpha.1_*-setup.exe' | Select-Object -First 1
$b = Get-ChildItem $installers -Filter 'Orbit_0.1.0-alpha.2_*-setup.exe' | Select-Object -First 1
"A: $($a.Name) $((Get-FileHash $a.FullName).Hash)"
"B: $($b.Name) $((Get-FileHash $b.FullName).Hash)"
Start-Process $a.FullName -ArgumentList '/S' -Wait
'--- after A (downgrade to alpha.1) ---'
(Get-Item 'HKCU:\Software\Classes\orbit\shell\open\command').GetValue('')
Start-Process $b.FullName -ArgumentList '/S' -Wait
'--- after B (upgrade back to alpha.2) ---'
(Get-ItemProperty -Path $run -Name Orbit -ErrorAction SilentlyContinue).Orbit
(Get-Item 'HKCU:\Software\Classes\orbit\shell\open\command').GetValue('')
& 'C:\OrbitHarness\checks.ps1' -Action snapshot
Copy-Item (Join-Path $evidence 'installed-state.json') (Join-Path $evidence '08-after-upgrade.json') -Force
$data = Join-Path $env:APPDATA 'app.orbit.desktop\data'
"data folder still present: $(Test-Path $data); files: $((Get-ChildItem $data -File | Measure-Object).Count)"
"`nNEXT: launch Orbit and confirm test1 is still there and Settings -> Desktop shows your login-launch choice unchanged; then scenario 9:`n  C:\OrbitHarness\steps\09-uninstall.ps1"
