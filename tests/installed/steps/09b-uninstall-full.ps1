# Scenario 9, complete: with login launch registered AND a foreign orbit:// handler planted,
# the uninstaller must remove only the login value, leave the foreign handler alone, and keep
# every data file. Restores a clean Orbit install at the end.
if (@(Get-Process Orbit -ErrorAction SilentlyContinue).Count -ne 0) { 'Quit Orbit from the tray first'; exit 1 }
$evidence = 'C:\OrbitHarness\evidence'
$data = Join-Path $env:APPDATA 'app.orbit.desktop\data'
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$exe = Join-Path $env:LOCALAPPDATA 'Orbit\orbit.exe'
$command = 'HKCU:\Software\Classes\orbit\shell\open\command'

# Arrange: login launch as the toggle writes it, and a foreign handler.
Set-ItemProperty -Path $run -Name Orbit -Value "$exe --background"
& 'C:\OrbitHarness\checks.ps1' -Action foreign-handler | Out-Null
"before: login launch = $((Get-ItemProperty -Path $run -Name Orbit).Orbit)"
"before: orbit://     = $((Get-Item $command).GetValue(''))"
$before = (Get-ChildItem $data -Recurse -File | Measure-Object).Count

# Act.
Start-Process (Join-Path $env:LOCALAPPDATA 'Orbit\uninstall.exe') -ArgumentList '/S' -Wait
Start-Sleep -Seconds 3
& 'C:\OrbitHarness\checks.ps1' -Action uninstall-snapshot | Out-Null
$after = Get-Content (Join-Path $evidence 'after-uninstall.json') | ConvertFrom-Json
Copy-Item (Join-Path $evidence 'after-uninstall.json') (Join-Path $evidence '09b-after-uninstall.json') -Force
$filesAfter = (Get-ChildItem $data -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
$foreignKept = $after.protocolCommand -match 'notepad'

# Assert.
''
"executable gone:              $(-not $after.executableExists)   (want True)"
"login launch removed:         $(-not $after.autostartCommand)   (want True)"
"foreign handler left alone:   $foreignKept   -> $($after.protocolCommand)   (want True)"
"data files before / after:    $before / $filesAfter   (want equal)"
$ok = (-not $after.executableExists) -and (-not $after.autostartCommand) -and $foreignKept -and ($before -eq $filesAfter)
if ($ok) { 'SCENARIO 9: PASS' } else { 'SCENARIO 9: FAIL (see above)' }

# Restore a clean install for anything else.
Remove-Item -Path 'HKCU:\Software\Classes\orbit' -Recurse -Force -ErrorAction SilentlyContinue
Start-Process 'C:\OrbitInstallers\Orbit_0.1.0-alpha.2_x64-setup.exe' -ArgumentList '/S' -Wait
& 'C:\OrbitHarness\checks.ps1' -Action snapshot | Out-Null
"reinstalled; orbit:// = $((Get-Item $command).GetValue(''))"
