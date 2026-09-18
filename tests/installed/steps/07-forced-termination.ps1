# Scenario 7: kill Orbit hard, relaunch it, and capture the unclean-run report it writes.
# Afterwards check Settings -> Data (diagnostics) in Orbit: it must say the previous run ended
# uncleanly, once, and the app must be usable.
$exe = Join-Path $env:LOCALAPPDATA 'Orbit\orbit.exe'
$logs = Join-Path $env:APPDATA 'app.orbit.desktop\logs'
if (@(Get-Process Orbit -ErrorAction SilentlyContinue).Count -eq 0) { Start-Process $exe; Start-Sleep -Seconds 5 }
Stop-Process -Name Orbit -Force
Start-Sleep -Seconds 2
"after kill: $(@(Get-Process Orbit -ErrorAction SilentlyContinue).Count) Orbit processes"
Start-Process $exe
Start-Sleep -Seconds 6
"after relaunch: $(@(Get-Process Orbit -ErrorAction SilentlyContinue).Count) Orbit processes"
Copy-Item (Join-Path $logs 'last-run.json') 'C:\OrbitHarness\evidence\07-last-run.json' -Force
Get-Content 'C:\OrbitHarness\evidence\07-last-run.json'

"`nNEXT: in Orbit open Settings -> Data and tell Claude the previous-run wording; then scenario 8 (quit Orbit from the tray first):`n  C:\OrbitHarness\steps\08-upgrade.ps1"
