# Scenario 9: uninstall removes only Orbit's own protocol and login registrations and keeps
# the data folder, backups and exports. Plant a foreign handler first so we can prove the
# uninstaller leaves someone else's registration alone.
if (@(Get-Process Orbit -ErrorAction SilentlyContinue).Count -ne 0) { 'Quit Orbit from the tray first'; exit 1 }
$evidence = 'C:\OrbitHarness\evidence'
$data = Join-Path $env:APPDATA 'app.orbit.desktop\data'
$before = (Get-ChildItem $data -Recurse -File | Measure-Object).Count
$uninstaller = Join-Path $env:LOCALAPPDATA 'Orbit\uninstall.exe'
Start-Process $uninstaller -ArgumentList '/S' -Wait
Start-Sleep -Seconds 3
& 'C:\OrbitHarness\checks.ps1' -Action uninstall-snapshot
Get-Content (Join-Path $evidence 'after-uninstall.json')
"data files before: $before, after: $((Get-ChildItem $data -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count) (must be equal)"
"`nNEXT: reinstall for scenarios 10-11:`n  C:\OrbitHarness\steps\O3.ps1`nthen in Orbit create a bill due in a few minutes with a reminder and watch for the toast (name + icon); turn on Focus Assist and check Settings -> Desktop describes suppression honestly."
