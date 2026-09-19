# Scenario 9: uninstall removes only Orbit's own protocol and login registrations and keeps
# the data folder, backups and exports.
if (@(Get-Process Orbit -ErrorAction SilentlyContinue).Count -ne 0) { 'Quit Orbit from the tray first'; exit 1 }
$evidence = 'C:\OrbitHarness\evidence'
$data = Join-Path $env:APPDATA 'app.orbit.desktop\data'
$before = (Get-ChildItem $data -Recurse -File | Measure-Object).Count
$runBefore = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name Orbit -ErrorAction SilentlyContinue).Orbit
"login launch before uninstall: $(if ($runBefore) { $runBefore } else { '(not set)' })"
$uninstaller = Join-Path $env:LOCALAPPDATA 'Orbit\uninstall.exe'
Start-Process $uninstaller -ArgumentList '/S' -Wait
Start-Sleep -Seconds 3
& 'C:\OrbitHarness\checks.ps1' -Action uninstall-snapshot
$after = Get-Content (Join-Path $evidence 'after-uninstall.json') | ConvertFrom-Json
$filesAfter = (Get-ChildItem $data -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
''
"executable still present:  $($after.executableExists)   (want False)"
"data files before / after: $before / $filesAfter   (want equal)"
"login launch after:        $(if ($after.autostartCommand) { $after.autostartCommand } else { '(removed)' })   (want removed)"
"orbit:// after:            $(if ($after.protocolCommand) { $after.protocolCommand } else { '(removed)' })   (want removed)"
$ok = (-not $after.executableExists) -and ($before -eq $filesAfter) -and (-not $after.autostartCommand) -and (-not $after.protocolCommand)
if ($ok) { 'PASS' } else { 'FAIL: see the lines above' }
