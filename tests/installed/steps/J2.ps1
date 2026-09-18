# Scenario 2a: a foreign orbit:// handler must survive a reinstall.
# Run after `checks.ps1 -Action foreign-handler` planted Notepad as the handler.
Start-Process 'C:\OrbitInstallers\Orbit_0.1.0-alpha.2_x64-setup.exe' -ArgumentList '/S' -Wait
$command = (Get-Item 'HKCU:\Software\Classes\orbit\shell\open\command').GetValue('')
"handler after reinstall: $command"
if ($command -match 'notepad') { 'PASS: the installer left the foreign handler alone' } else { 'FAIL: the installer replaced the foreign handler' }
$command | Set-Content 'C:\OrbitHarness\evidence\foreign-handler-after-reinstall.txt'
