# Scenario 5: with Orbit fully quit (tray menu -> Quit), an orbit:// link must start exactly
# one process and open the exact record after first run is already done.
param([Parameter(Mandatory = $true)][string] $TaskId)
if (@(Get-Process Orbit -ErrorAction SilentlyContinue).Count -ne 0) { 'Orbit is still running; quit it from the tray menu first'; exit 1 }
& 'C:\OrbitHarness\checks.ps1' -Action protocol -ExpectedRecordUri "orbit://task/$TaskId"
Copy-Item 'C:\OrbitHarness\evidence\protocol-dispatch.json' 'C:\OrbitHarness\evidence\05-cold-activation.json' -Force
Get-Content 'C:\OrbitHarness\evidence\05-cold-activation.json'
$logs = Join-Path $env:APPDATA 'app.orbit.desktop\logs'
Get-ChildItem $logs -Filter '*.log' | Sort-Object LastWriteTime | Select-Object -Last 1 | Copy-Item -Destination 'C:\OrbitHarness\evidence\05-shell.log' -Force

"`nNEXT (scenario 6): leave Orbit running and run:`n  C:\OrbitHarness\steps\06-duplicate-launch.ps1"
